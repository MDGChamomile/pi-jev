import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, rankingMetrics, validateFixtures } from './evaluate.mjs';

const fixtures = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8'));
const mock = JSON.parse(await readFile(new URL('./mock-results.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);

test('bundled Korean fixtures preserve semantics and validate against the real input contract', () => {
  assert.doesNotThrow(() => validateFixtures(fixtures));
  assert.match(fixtures[1].input.candidates[3].excerpt, /아직 종결되지 않았다/);
  assert.match(fixtures[2].input.candidates[0].excerpt, /확정되지 않았다/);
  assert.match(fixtures[0].input.candidates[3].excerpt, /20만 주/);
  for (const fixture of fixtures) assert.match(fixture.provenance, /Synthetic/);
});

test('mock report shows improvements, deliberate harm, fallback, ties, and unknown measurements', () => {
  const before = copy(mock);
  const report = evaluate(fixtures, mock);
  assert.deepEqual(mock, before);
  assert.equal(report.kind, 'mock');
  assert.match(report.evidence, /not Jev performance/);
  assert.deepEqual(report.summary, { cases: 5, fallbacks: 1, criticalDemotionCases: 1, completeTimingPairs: 0 });
  const [completion, correction, asOf, empty, equal] = report.cases;
  assert.equal(completion.baseline.firstDirectRank, 4);
  assert.equal(completion.assisted.firstDirectRank, 1);
  assert.ok(completion.ndcgDelta > 0);
  assert.ok(correction.ndcgDelta > 0);
  assert.ok(asOf.ndcgDelta < 0);
  assert.deepEqual(asOf.criticalDemotions, ['as-of']);
  assert.deepEqual(asOf.assisted.criticalMissesAtK, ['as-of']);
  assert.equal(empty.assisted.ndcgAtK, null);
  assert.equal(empty.assisted.directCoverageAtK, null);
  assert.equal(empty.assisted.firstDirectRank, null);
  assert.equal(equal.ndcgDelta, 0);
  assert.equal(completion.measurements.assisted.costUsd, null);
  assert.equal(completion.totalTimeDeltaMs, null);
});

test('all IDs are retained; omitted, duplicate, or foreign candidates and changed fallback fail', () => {
  for (const rankedIds of [['completion'], ['plan', 'plan', 'background', 'completion'], ['foreign', 'approval', 'background', 'completion']]) {
    const result = copy(mock);
    result.cases[0].rankedIds = rankedIds;
    assert.throws(() => evaluate(fixtures, result), /invalid_result_order/);
  }
  const result = copy(mock);
  result.cases[3].rankedIds.reverse();
  assert.throws(() => evaluate(fixtures, result), /fallback_must_preserve_order/);
});

test('all cases must be present once, preventing accidental exclusion of failures', () => {
  for (const cases of [mock.cases.slice(1), [...mock.cases, mock.cases[0]], [null, ...mock.cases.slice(1)]]) {
    assert.throws(() => evaluate(fixtures, { kind: 'mock', cases }), /incomplete_or_duplicate_cases/);
  }
});

test('observed success needs an explicit returned model; mock never silently becomes observed', () => {
  const result = copy(mock);
  result.kind = 'observed';
  assert.throws(() => evaluate(fixtures, result), /observed_success_requires_model/);
  for (const row of result.cases) if (row.status === 'ok') row.returnedModel = 'typesafe/jev-synthetic-test';
  assert.match(evaluate(fixtures, result).evidence, /not verified/);
  result.kind = 'live-verified';
  assert.throws(() => evaluate(fixtures, result), /invalid_results/);
});

test('whole-task timing includes preparation, approval, request, and reading/answering', () => {
  const result = copy(mock);
  result.cases[0].baseline = { preparationMs: 100, reviewApprovalMs: 0, requestMs: 0, readingAnswerMs: 500, sourceReads: 4, answerCorrect: true, costUsd: 0 };
  result.cases[0].assisted = { preparationMs: 300, reviewApprovalMs: 400, requestMs: 10, readingAnswerMs: 200, sourceReads: 1, answerCorrect: false };
  const report = evaluate(fixtures, result);
  assert.equal(report.summary.completeTimingPairs, 1);
  assert.equal(report.cases[0].totalTimeDeltaMs, 310);
  assert.equal(report.cases[0].measurements.baseline.costUsd, 0);
  assert.equal(report.cases[0].measurements.assisted.costUsd, null);
  assert.equal(report.cases[0].measurements.assisted.answerCorrect, false);
  delete result.cases[0].assisted.reviewApprovalMs;
  assert.equal(evaluate(fixtures, result).cases[0].totalTimeDeltaMs, null);
});

test('invalid measurements and overflow fail instead of producing misleading zero costs or times', () => {
  for (const observation of [{ costUsd: -1 }, { requestMs: Infinity }, { sourceReads: 1.5 }, { answerCorrect: 'yes' }, { elapsedMs: 1 }, { preparationMs: Number.MAX_VALUE, reviewApprovalMs: Number.MAX_VALUE, requestMs: 0, readingAnswerMs: 0 }]) {
    const result = copy(mock);
    result.cases[0].assisted = observation;
    assert.throws(() => evaluate(fixtures, result), /invalid_/);
  }
});

test('supplied parent baseline is distinguished from original-order control and validated', () => {
  const result = copy(mock);
  result.cases[0].baselineIds = [...result.cases[0].rankedIds];
  assert.equal(evaluate(fixtures, result).cases[0].baselineKind, 'supplied_parent_order');
  assert.equal(evaluate(fixtures, result).cases[0].ndcgDelta, 0);
  for (const baselineIds of [[], null, ['unknown']]) {
    result.cases[0].baselineIds = baselineIds;
    assert.throws(() => evaluate(fixtures, result), /invalid_baseline_order/);
  }
});

test('equal relevance has equal gain without enforcing a unique gold order', () => {
  const fixture = fixtures[4];
  assert.equal(rankingMetrics(['report', 'notice', 'history'], fixture).ndcgAtK, 1);
  assert.equal(rankingMetrics(['notice', 'report', 'history'], fixture).ndcgAtK, 1);
});

test('malformed gold labels and duplicate fixture IDs are rejected', () => {
  for (const mutate of [
    list => { list.push(copy(list[0])); },
    list => { list[0].relevance.plan = 4; },
    list => { delete list[0].relevance.approval; },
    list => { list[0].criticalIds = ['unknown']; },
    list => { list[0].input.candidates[0].url = 'file:///synthetic'; },
  ]) {
    const list = copy(fixtures);
    mutate(list);
    assert.throws(() => validateFixtures(list));
  }
});

test('mock CLI is repeatable and has no network path', () => {
  const entry = new URL('./evaluate.mjs', import.meta.url);
  const script = `globalThis.fetch = () => { throw new Error('network forbidden'); }; process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(entry))}, '--mock']; await import(${JSON.stringify(entry.href)});`;
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: {}, timeout: 10000 });
  const first = run(), second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(JSON.parse(first.stdout).summary.cases, 5);
  const invalid = spawnSync(process.execPath, [fileURLToPath(entry)], { encoding: 'utf8', env: {}, timeout: 10000 });
  assert.equal(invalid.status, 1);
});
