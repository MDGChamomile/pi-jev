import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, replay } from './evaluate.mjs';

const fixtures = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8'));
test('local evaluation includes miss and null non-retrieval measurements', async () => {
  const report = await evaluate(fixtures);
  assert.equal(report.cases.length, 6);
  assert.ok(report.cases.filter(c => c.id !== 'lexical-mismatch').every(c => c.candidateRecall === 1));
  const lexical = report.cases.find(c => c.id === 'lexical-mismatch');
  assert.equal(lexical.candidateRecall, 0);
  assert.equal(lexical.returnedRecall, 0);
  assert.equal(report.measurements.baselineCost, null);
  assert.equal(report.measurements.jevMeasured, null);
  assert.match(report.evidence, /Not Jev/);
});
test('replay applies actual top-three renderer to current fixture scan', async () => {
  const f = fixtures.find(x => x.id === 'top-three-effect');
  const ids = Object.keys(f.files).map((name, i) => `c${i}_${Buffer.from(name).toString('hex')}_1`);
  const unranked = await replay([f], [{ caseId: f.id, rankedIds: ids }]);
  assert.deepEqual([unranked.cases[0].candidateRecall, unranked.cases[0].returnedRecall], [1, 0]);
  const ranked = await replay([f], [{ caseId: f.id, rankedIds: [ids[3], ...ids.slice(0, 3)] }]);
  assert.deepEqual([ranked.cases[0].candidateRecall, ranked.cases[0].returnedRecall], [1, 1]);
  const missing = await replay([f], []);
  assert.deepEqual([missing.cases[0].candidateRecall, missing.cases[0].returnedRecall], [null, null]);
  assert.equal(ranked.source, 'unverified-user-supplied-ranking-records');
});
test('fixture validation rejects traversal, absolute paths, missing gold, duplicate IDs, and oversize input', async () => {
  for (const mutate of [
    x => { x[0].files['../escape.txt'] = 'unsafe'; },
    x => { x[0].files['/tmp/escape.txt'] = 'unsafe'; },
    x => { x[0].gold[0].text = 'not present'; },
    x => { x[1].id = x[0].id; },
    x => { x[0].files['huge.ts'] = 'x'.repeat(17000); },
  ]) {
    const input = structuredClone(fixtures); mutate(input);
    await assert.rejects(evaluate(input));
  }
});
test('replay rejects incomplete/duplicate permutations and unknown CLI options', async () => {
  const f = fixtures[0], id = `c0_${Buffer.from(Object.keys(f.files)[0]).toString('hex')}_1`;
  await assert.rejects(replay([f], [{ caseId: f.id, rankedIds: [] }]));
  await assert.rejects(replay([f], [{ caseId: f.id, rankedIds: [id, id] }]));
  const script = fileURLToPath(new URL('./evaluate.mjs', import.meta.url));
  for (const args of [['--replay'], ['--bad'], ['--replay', 'x', 'extra']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(result.status, 1);
  }
});
