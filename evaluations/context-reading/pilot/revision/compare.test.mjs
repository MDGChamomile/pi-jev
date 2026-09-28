import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from './compare.mjs';

function fixture() {
  const rows = [];
  for (const split of ['development', 'heldout']) for (const query of ['ko', 'en-literal']) for (const implementation of ['baseline', 'revised']) for (let repetition = 0; repetition < 3; repetition++) {
    rows.push({ split, query, implementation, repetition, taskId: 'fixture', candidateGroups: [true, false], returnedGroups: [false, false],
      candidateRecall: 0.5, returnedRecall: 0, oracleReturnedRecall: 0.5, allCandidateGroups: false, allReturnedGroups: false,
      rankingPayload: { eligible: true }, localPipelineMs: repetition + 1, coverage: { limited: true }, candidates: [{ id: 'a' }] });
  }
  return rows;
}
test('aggregate does not count repeated runs as independent tasks or mix development and heldout', () => {
  const summaries = aggregate(fixture());
  assert.equal(summaries.length, 8);
  for (const s of summaries) {
    assert.equal(s.tasks, 1); assert.equal(s.requiredGroups, 2);
    assert.equal(s.candidateGroupHits, 1); assert.equal(s.returnedGroupHits, 0);
    assert.equal(s.meanCandidateRecall, 0.5); assert.equal(s.localPipelineMedianMs, 2); assert.equal(s.stable, true);
  }
});
test('aggregate reports instability rather than silently presenting a repeated score as stable', () => {
  const rows = fixture(); rows[1].candidateGroups = [false, false];
  assert.equal(aggregate(rows)[0].stable, false);
});
