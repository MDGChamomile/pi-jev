// Offline comparison only: no provider, authentication, fetch, session, or extension runner.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRequest } from '../../extensions/pi-jev-tools/core.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireThat = (condition, code) => { if (!condition) throw new Error(code); };
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
const phases = ['preparationMs', 'reviewApprovalMs', 'requestMs', 'readingAnswerMs'];
const numericFields = [...phases, 'sourceReads', 'inputTokens', 'outputTokens', 'costUsd'];

export function validateFixtures(fixtures) {
  requireThat(Array.isArray(fixtures) && fixtures.length > 0, 'invalid_fixtures');
  const seen = new Set();
  for (const fixture of fixtures) {
    requireThat(object(fixture) && typeof fixture.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(fixture.id) && !seen.has(fixture.id), 'invalid_fixture_id');
    seen.add(fixture.id);
    requireThat(typeof fixture.provenance === 'string' && fixture.provenance.trim() && typeof fixture.rationale === 'string' && fixture.rationale.trim(), 'missing_fixture_context');
    const { originalOrder } = buildRequest(fixture.input);
    requireThat(object(fixture.relevance) && sameSet(Object.keys(fixture.relevance), originalOrder), 'invalid_relevance_ids');
    requireThat(Object.values(fixture.relevance).every(value => Number.isInteger(value) && value >= 0 && value <= 3), 'invalid_relevance_grade');
    requireThat(Array.isArray(fixture.criticalIds) && new Set(fixture.criticalIds).size === fixture.criticalIds.length && fixture.criticalIds.every(id => originalOrder.includes(id) && fixture.relevance[id] > 0), 'invalid_critical_ids');
  }
}

export function rankingMetrics(order, fixture) {
  const ids = fixture.input.candidates.map(candidate => candidate.id);
  requireThat(sameSet(order, ids), 'invalid_ranking');
  const k = Math.min(3, order.length);
  const dcg = ranking => ranking.slice(0, k).reduce((sum, id, index) => sum + (2 ** fixture.relevance[id] - 1) / Math.log2(index + 2), 0);
  const ideal = dcg([...ids].sort((a, b) => fixture.relevance[b] - fixture.relevance[a]));
  const direct = ids.filter(id => fixture.relevance[id] === 3);
  const first = order.findIndex(id => fixture.relevance[id] === 3);
  return {
    k,
    ndcgAtK: ideal === 0 ? null : dcg(order) / ideal,
    firstDirectRank: first === -1 ? null : first + 1,
    directCoverageAtK: direct.length === 0 ? null : order.slice(0, k).filter(id => direct.includes(id)).length / direct.length,
    criticalMissesAtK: fixture.criticalIds.filter(id => !order.slice(0, k).includes(id)),
  };
}

function measurements(value) {
  if (value === undefined || value === null) value = {};
  requireThat(object(value) && Object.keys(value).every(key => [...numericFields, 'answerCorrect'].includes(key)), 'invalid_measurement_fields');
  for (const field of numericFields) {
    const n = value[field];
    requireThat(n === undefined || n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && (!['sourceReads', 'inputTokens', 'outputTokens'].includes(field) || Number.isSafeInteger(n))), 'invalid_measurement');
  }
  requireThat(value.answerCorrect === undefined || value.answerCorrect === null || typeof value.answerCorrect === 'boolean', 'invalid_answer_correctness');
  const totalMs = phases.every(field => typeof value[field] === 'number') ? phases.reduce((sum, field) => sum + value[field], 0) : null;
  requireThat(totalMs === null || Number.isFinite(totalMs), 'invalid_total_time');
  return {
    ...Object.fromEntries(numericFields.map(field => [field, value[field] ?? null])),
    totalMs,
    answerCorrect: value.answerCorrect ?? null,
  };
}

export function evaluate(fixtures, results) {
  validateFixtures(fixtures);
  requireThat(object(results) && ['mock', 'observed'].includes(results.kind) && Array.isArray(results.cases), 'invalid_results');
  requireThat(results.cases.every(row => object(row)) && sameSet(results.cases.map(row => row.caseId), fixtures.map(fixture => fixture.id)), 'incomplete_or_duplicate_cases');
  const rows = fixtures.map(fixture => {
    const row = results.cases.find(item => item.caseId === fixture.id);
    const originalOrder = fixture.input.candidates.map(candidate => candidate.id);
    requireThat(['ok', 'not_ranked'].includes(row.status) && sameSet(row.rankedIds, originalOrder), 'invalid_result_order');
    requireThat(row.status !== 'not_ranked' || row.rankedIds.every((id, i) => id === originalOrder[i]), 'fallback_must_preserve_order');
    requireThat(row.returnedModel === null || (typeof row.returnedModel === 'string' && /^typesafe\/jev-[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(row.returnedModel)), 'invalid_returned_model');
    requireThat(results.kind !== 'observed' || row.status !== 'ok' || row.returnedModel !== null, 'observed_success_requires_model');
    const baselineIds = row.baselineIds === undefined ? originalOrder : row.baselineIds;
    requireThat(sameSet(baselineIds, originalOrder), 'invalid_baseline_order');
    const baseline = rankingMetrics(baselineIds, fixture);
    const assisted = rankingMetrics(row.rankedIds, fixture);
    const baselineMeasurements = measurements(row.baseline);
    const assistedMeasurements = measurements(row.assisted);
    return {
      caseId: fixture.id, status: row.status, returnedModel: row.returnedModel,
      baselineKind: row.baselineIds === undefined ? 'original_order_only' : 'supplied_parent_order',
      originalOrder, baselineIds: [...baselineIds], rankedIds: [...row.rankedIds],
      baseline, assisted,
      ndcgDelta: baseline.ndcgAtK === null ? null : assisted.ndcgAtK - baseline.ndcgAtK,
      criticalDemotions: fixture.criticalIds.filter(id => row.rankedIds.indexOf(id) > baselineIds.indexOf(id)),
      measurements: { baseline: baselineMeasurements, assisted: assistedMeasurements },
      totalTimeDeltaMs: baselineMeasurements.totalMs === null || assistedMeasurements.totalMs === null ? null : assistedMeasurements.totalMs - baselineMeasurements.totalMs,
    };
  });
  return {
    kind: results.kind,
    evidence: results.kind === 'mock' ? 'Handwritten mock orders; not Jev performance or live compatibility evidence.' : 'User-supplied observations; provenance and correctness are not verified by this evaluator.',
    limitations: 'Small fixtures and ranking metrics do not establish net benefit. Original order is not ordinary parent reasoning. Missing measurements remain unknown; first-direct rank is not measured source reads. Retain every candidate, including contradictory evidence.',
    summary: {
      cases: rows.length,
      fallbacks: rows.filter(row => row.status === 'not_ranked').length,
      criticalDemotionCases: rows.filter(row => row.criticalDemotions.length > 0).length,
      completeTimingPairs: rows.filter(row => row.totalTimeDeltaMs !== null).length,
    },
    cases: rows,
  };
}

async function readJson(path) {
  const text = await readFile(path, 'utf8');
  requireThat(Buffer.byteLength(text, 'utf8') <= 1024 * 1024, 'evaluation_file_too_large');
  return JSON.parse(text);
}

async function main(args) {
  requireThat(args.length === 1 || args.length === 2, 'usage: node evaluations/reranker/evaluate.mjs --mock | RESULTS.json [FIXTURES.json]');
  requireThat(args[0] !== '--mock' || args.length === 1, 'mock_uses_bundled_fixtures');
  const fixtures = await readJson(args[1] ?? new URL('./fixtures.json', import.meta.url));
  const results = await readJson(args[0] === '--mock' ? new URL('./mock-results.json', import.meta.url) : args[0]);
  console.log(JSON.stringify(evaluate(fixtures, results), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    // Do not echo arbitrary supplied file contents, paths, or parse errors.
    console.error('Evaluation failed: check arguments, JSON schemas, complete case coverage, and candidate IDs. See evaluations/reranker/README.md.');
    process.exitCode = 1;
  });
}
