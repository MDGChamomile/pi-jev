import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { evaluate, piBashReturn, validateFixtures, PI_MAX_BYTES, PI_MAX_LINES } from './evaluate.mjs';
import { truncateTail } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/truncate.js';
import { fixtures } from './fixtures.mjs';

const fixture = (overrides = {}) => ({ id: 'unit', kind: 'unknown', command: 'synthetic', exitCode: 0, text: 'first\nsecond', mustKeep: [], notes: 'unit fixture', ...overrides });

test('fixtures validate and gold labels are scored only after transformation', () => {
  assert.doesNotThrow(() => validateFixtures(fixtures));
  assert.throws(() => validateFixtures([fixture({ mustKeep: ['only in the generated truncation wrapper'] })]), /must_keep_not_in_source/);
  const report = evaluate(fixtures);
  assert.equal(report.cases.length, fixtures.length);
  assert.equal(report.cases.find(row => row.fixtureId === 'unknown-diff-output').localFallback, true);
  assert.equal(report.cases.find(row => row.fixtureId === 'unknown-diff-output').local.mustKeep.missing.length, 0);
  const passing = report.cases.find(row => row.fixtureId === 'passing-test-summary');
  assert.equal(passing.localFallback, false);
  assert.equal(passing.local.mustKeep.missing.length, 0);
  const failure = report.cases.find(row => row.fixtureId === 'test-failure-stack-and-aggregate');
  assert.equal(failure.local.mustKeep.missing.length, 0);
  const error = report.cases.find(row => row.fixtureId === 'early-cause-before-noisy-tail');
  assert.deepEqual(error.baseline.mustKeep.missing, [fixtures.find(row => row.id === error.fixtureId).mustKeep[0]]);
  assert.deepEqual(error.local.mustKeep.missing, error.baseline.mustKeep.missing);
  const middle = report.cases.find(row => row.fixtureId === 'failure-cause-midstream');
  assert.equal(middle.localFallback, true, 'unrecognized synthetic tail falls back rather than pretending to recover discarded lines');
  assert.deepEqual(middle.local.mustKeep.missing, middle.baseline.mustKeep.missing);
  assert.equal(report.cases.every(row => row.selection.status === 'not_measured' && row.selection.jevLatencyMs === null && row.selection.jevCostUsd === null), true);
});

test('Pi 0.85.0 tail keeps the last 2000 lines and makes omitted source refs visible', () => {
  const text = Array.from({ length: PI_MAX_LINES + 1 }, (_, i) => `line-${i + 1}`).join('\n');
  const out = piBashReturn(fixture({ text }));
  assert.equal(out.truncation.truncatedBy, 'lines');
  const expected = truncateTail(text);
  assert.equal(out.truncation.truncatedBy, expected.truncatedBy);
  assert.equal(out.truncation.totalLines, expected.totalLines);
  assert.equal(out.truncation.totalBytes, expected.totalBytes);
  assert.equal(out.truncation.outputLines, expected.outputLines);
  assert.equal(out.truncation.outputBytes, expected.outputBytes);
  assert.ok(out.visibleLines.map(row => row.text).join('\n') === expected.content, 'tail content matches pinned Pi truncateTail');
  assert.equal(out.truncation.outputLines, PI_MAX_LINES);
  assert.equal(out.visibleLines[0].line, 2);
  assert.equal(out.visibleLines.at(-1).line, PI_MAX_LINES + 1);
  assert.match(out.text, new RegExp(`Showing lines 2-${PI_MAX_LINES + 1} of ${PI_MAX_LINES + 1}`));
  assert.match(out.text, /omitted source lines 1-1/);
  assert.ok(bytes(out.text) > out.truncation.outputBytes, 'returned wrapper is additional to truncated content');
});

test('Pi byte truncation and single overlong UTF-8 line follow tail behavior', () => {
  const first = 'a'.repeat(30000), last = 'b'.repeat(30000);
  const out = piBashReturn(fixture({ text: `${first}\n${last}` }));
  assert.equal(out.truncation.truncatedBy, 'bytes');
  const expected = truncateTail(`${first}\n${last}`);
  assert.equal(out.truncation.truncatedBy, expected.truncatedBy);
  assert.equal(out.truncation.totalLines, expected.totalLines);
  assert.equal(out.truncation.totalBytes, expected.totalBytes);
  assert.equal(out.truncation.outputBytes, expected.outputBytes);
  assert.ok(out.visibleLines.map(row => row.text).join('\n') === expected.content, 'tail content matches pinned Pi truncateTail');
  assert.ok(out.truncation.outputBytes <= PI_MAX_BYTES);
  assert.equal(out.visibleLines.at(-1).line, 2);
  assert.match(out.text, /50\.0KB limit/);

  const unicode = `시작${'한'.repeat(20000)}끝`;
  const partial = piBashReturn(fixture({ text: unicode }));
  assert.equal(partial.truncation.lastLinePartial, true);
  assert.ok(partial.truncation.outputBytes <= PI_MAX_BYTES);
  assert.match(partial.text, /Showing last .* of line 1/);
  assert.equal(Buffer.from(partial.visibleLines[0].text).toString('utf8'), partial.visibleLines[0].text);
  const expectedUnicode = truncateTail(unicode);
  assert.equal(partial.truncation.outputBytes, expectedUnicode.outputBytes);
  assert.ok(partial.visibleLines[0].text === expectedUnicode.content, 'UTF-8 partial tail matches pinned Pi truncateTail');
});

test('local unknown/ambiguous text is byte-for-byte baseline fallback; known output can compact', () => {
  const ambiguous = fixture({ kind: 'test', text: 'ok 1 - known\ncustom output cannot be parsed' });
  const report = evaluate([ambiguous]).cases[0];
  assert.equal(report.localFallback, true);
  assert.equal(report.local.returnedBytes, report.baseline.returnedBytes);
  const known = fixtures.find(row => row.id === 'passing-test-summary');
  const compact = evaluate([known]).cases[0];
  assert.equal(compact.localFallback, false);
  assert.ok(compact.local.returnedBytes < compact.baseline.returnedBytes);
});

test('local build filtering removes only success progress and retains a long dependency warning', () => {
  const warning = 'Circular dependency: src/a -> src/b -> src/a';
  const text = ['tsc --noEmit', warning, ...Array.from({ length: 100 }, (_, i) => `compiled module-${i + 1}.mjs`), 'build complete in 311ms'].join('\n');
  const input = fixture({ id: 'long-warning-build', kind: 'build', command: 'npm run build', text, mustKeep: ['tsc --noEmit', warning, 'build complete in 311ms'] });
  const row = evaluate([input]).cases[0];
  assert.equal(row.localFallback, false);
  for (const required of input.mustKeep) assert.ok(row.local.returnedText.includes(required), `lost mustKeep: ${required}`);
  assert.equal(row.local.mustKeep.missing.length, 0);
  assert.ok(row.local.returnedByteDeltaVsBaseline < 0);
  assert.doesNotMatch(row.local.returnedText, /compiled module-\d+\.mjs/);
});

test('failed long AssertionError output uses baseline fallback without losing diagnostics', () => {
  const cause = '  AssertionError [ERR_ASSERTION]: expected 4, received 3';
  const location = '    at TestContext.<anonymous> (src/limit.test.mjs:27:10)';
  const text = ['TAP version 13', ...Array.from({ length: 150 }, (_, i) => `ok ${i + 1} - passing check`), 'not ok 151 - preserves the requested limit', cause, location, '# tests 151', '# pass 150', '# fail 1'].join('\n');
  const input = fixture({ id: 'long-assertion-failure', kind: 'test', command: 'node --test', exitCode: 1, text, mustKeep: [cause, location, '# fail 1'] });
  const row = evaluate([input]).cases[0];
  assert.equal(row.localFallback, true);
  assert.equal(row.local.returnedText, row.baseline.returnedText);
  assert.equal(row.local.mustKeep.missing.length, 0);
});

test('offline selection replay accepts only exact visible source references and marks absent data null', () => {
  const f = fixture({ kind: 'test', text: 'ok 1 - first\nnot ok 2 - second\nsummary' });
  const record = { kind: 'observed-selection', cases: [{ fixtureId: 'unit', lineRefs: [{ start: 2, end: 2 }], selectedText: 'not ok 2 - second', jevLatencyMs: null, jevCostUsd: null }] };
  const row = evaluate([f], record).cases[0];
  assert.equal(row.selection.status, 'replayed');
  assert.deepEqual(row.selection.selectedLineRefs, [{ start: 2, end: 2 }]);
  assert.match(row.selection.returnedText, /Omitted source lines 1-1/);
  assert.match(row.selection.returnedText, /Source line 2/);
  assert.match(row.selection.returnedText, /Omitted source lines 3-3/);
  assert.equal(row.selection.jevLatencyMs, null);
  assert.equal(row.selection.jevCostUsd, null);
  assert.throws(() => evaluate([f], { ...record, cases: [{ ...record.cases[0], selectedText: 'fabricated' }] }), /selection_text_mismatch/);
  const emptySelection = evaluate([f], { kind: 'observed-selection', cases: [{ fixtureId: 'unit', lineRefs: [], selectedText: '' }] }).cases[0].selection;
  assert.match(emptySelection.returnedText, /Omitted source lines 1-3; no selected lines/);
  assert.throws(() => evaluate([f], { ...record, cases: [{ ...record.cases[0], lineRefs: [{ start: 99, end: 99 }] }] }), /invalid_selection_line_refs/);
  assert.doesNotThrow(() => evaluate([f], { ...record, cases: [{ ...record.cases[0], lineRefs: [{ start: 1, end: 1 }], selectedText: 'ok 1 - first' }] }));
  const clipped = fixture({ text: `ROOT_CAUSE:${'한'.repeat(20000)}END`, mustKeep: ['ROOT_CAUSE:'] });
  const clippedBaseline = piBashReturn(clipped);
  const clippedRecord = { kind: 'observed-selection', cases: [{ fixtureId: 'unit', lineRefs: [{ start: 1, end: 1 }], selectedText: clippedBaseline.visibleLines[0].text }] };
  const replay = evaluate([clipped], clippedRecord).cases[0].selection;
  assert.deepEqual(replay.mustKeep.missing, ['ROOT_CAUSE:']);
  assert.match(replay.returnedText, /Showing last/);
  assert.doesNotMatch(replay.returnedText, /ROOT_CAUSE:/);
  assert.throws(() => evaluate([clipped], { ...clippedRecord, cases: [{ ...clippedRecord.cases[0], selectedText: clipped.text }] }), /selection_text_mismatch/);
});

test('reported reductions count UTF-8 bytes of complete returned wrappers, not tokens', () => {
  const row = evaluate([fixture({ text: '한글🙂' })]).cases[0];
  assert.equal(row.baseline.sourceBytes, Buffer.byteLength('한글🙂'));
  assert.equal(row.baseline.returnedBytes, Buffer.byteLength('한글🙂'));
  assert.equal(row.baseline.reductionRate, 0);
  assert.match(evaluate([fixture()]).byteMetric, /UTF-8 bytes/);
  assert.equal(row.baseline.jevLatencyMs, null);
  assert.equal(row.baseline.wholeTaskSuccess, null);
});

test('CLI accepts the default offline run and explicitly rejects a lone --selection or unknown flag', () => {
  const entry = fileURLToPath(new URL('./evaluate.mjs', import.meta.url));
  const env = {};
  const normal = spawnSync(process.execPath, [entry], { encoding: 'utf8', env, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(JSON.parse(normal.stdout).cases.length, fixtures.length);
  for (const args of [['--selection'], ['--other']]) {
    const invalid = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env, timeout: 10000 });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Evaluation failed/);
  }
});

function bytes(value) { return Buffer.byteLength(value, 'utf8'); }
