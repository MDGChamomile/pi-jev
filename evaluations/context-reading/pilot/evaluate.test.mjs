import test from 'node:test';
import assert from 'node:assert/strict';
import { containedPath, groupHits, score, oracleBest, validateGold } from './evaluate.mjs';
import { renderContext } from '../../../extensions/pi-jev-context/core.mjs';

const span = (path, startLine, endLine = startLine) => ({ path, startLine, endLine });
const group = (...alternatives) => ({ fact: 'fixture', alternatives });
const candidate = (id, path, startLine, endLine = startLine, text = 'fixture') => ({ id, path, startLine, endLine, text });
const scan = candidates => ({ candidates, status: 'found', coverage: { filesConsidered: 4, filesRead: 4, bytesRead: 24, skipped: 0, limited: false } });

test('scoring requires correct file and complete atomic span, while allowing equivalent alternatives', () => {
  const groups = [group(span('a.ts', 5, 7), span('b.ts', 20)), group(span('c.ts', 1))];
  assert.deepEqual(groupHits(groups, [candidate('a', 'wrong.ts', 1, 99)]), [false, false]);
  assert.deepEqual(groupHits(groups, [candidate('a', 'a.ts', 5, 6)]), [false, false]);
  assert.deepEqual(groupHits(groups, [candidate('a', 'b.ts', 18, 22)]), [true, false]);
});

test('candidate recall and actual top-three returned recall are separate', () => {
  const input = scan(['a', 'b', 'c', 'd'].map(id => candidate(id, `${id}.ts`, 1)));
  const groups = [group(span('d.ts', 1))];
  const rendered = renderContext({ scan: input, rankedIds: [], mode: 'original' });
  const measured = score(groups, input, rendered);
  assert.equal(measured.candidateRecall, 1);
  assert.equal(measured.returnedRecall, 0);
  const oracle = oracleBest(groups, input);
  assert.equal(oracle.recall, 1);
  assert.deepEqual([...oracle.rankedIds].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(input.candidates[0].id, 'a');
});

test('oracle cannot recover absent evidence and cannot return four distinct required blocks', () => {
  const input = scan(['a', 'b', 'c', 'd'].map(id => candidate(id, `${id}.ts`, 1)));
  assert.equal(oracleBest([group(span('missing.ts', 1))], input).recall, 0);
  assert.equal(oracleBest(['a', 'b', 'c', 'd'].map(id => group(span(`${id}.ts`, 1))), input).recall, 0.75);
});

test('oracle honors renderer byte limits rather than assuming every triple fits', () => {
  const input = scan(['a', 'b', 'c'].map(id => candidate(id, `${id}.ts`, 1, 1, 'x'.repeat(8192))));
  const groups = ['a', 'b', 'c'].map(id => group(span(`${id}.ts`, 1)));
  assert.equal(oracleBest(groups, input).recall, 2 / 3);
});

test('empty candidate set scores zero, while an empty gold rubric is rejected', () => {
  const input = scan([]), rendered = renderContext({ scan: input, rankedIds: [], mode: 'original' });
  assert.equal(score([group(span('a.ts', 1))], input, rendered).returnedRecall, 0);
  assert.equal(oracleBest([group(span('a.ts', 1))], input).recall, 0);
  assert.throws(() => score([], input, rendered));
});

test('corpus paths cannot traverse or use absolute/symlink-style alternate separators', () => {
  for (const name of ['', '../x', '/tmp/x', 'a/../x', 'a\\x', 'a//x']) assert.throws(() => containedPath('/tmp/corpus', name));
  assert.equal(containedPath('/tmp/corpus', 'src/a.ts'), '/tmp/corpus/src/a.ts');
});

test('gold validation rejects absent, blank, oversized, out-of-scope, and omitted task evidence', async () => {
  const tasks = { repositories: { r: { paths: ['src'] } }, tasks: [{ id: 'x', repo: 'r', retrievalAppropriate: true }] };
  const corpora = { r: new Map([['src/a.ts', Buffer.from('line\n\nlast\n')]]) };
  const good = { items: [{ id: 'x', groups: [group(span('src/a.ts', 1))] }] };
  await validateGold(tasks, good, corpora);
  for (const badSpan of [span('src/missing.ts', 1), span('src/a.ts', 2), span('src/a.ts', 1, 6), span('outside.ts', 1)]) {
    await assert.rejects(validateGold(tasks, { items: [{ id: 'x', groups: [group(badSpan)] }] }, corpora));
  }
  await assert.rejects(validateGold(tasks, { items: [] }, corpora));
  await validateGold(tasks, { items: [{ id: 'x', unresolved: 'not adjudicated', groups: [] }] }, corpora);
});
