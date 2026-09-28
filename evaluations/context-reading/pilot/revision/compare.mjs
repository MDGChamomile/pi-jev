// Matched offline comparison; no provider, child session, or active extension installation.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, mkdtemp, rm, opendir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as revised from '../../../../extensions/pi-jev-context/core.mjs';
import { sha256, containedPath, score, oracleBest, validateGold } from '../evaluate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), PILOT = path.dirname(HERE);
const json = async p => JSON.parse(await readFile(p, 'utf8'));
async function inventory(root, rel = '') {
  const files = [];
  for (const d of await readdir(path.join(root, rel), { withFileTypes: true })) {
    assert.ok(!d.isSymbolicLink());
    const name = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) files.push(...await inventory(root, name));
    else { assert.ok(d.isFile()); files.push(name); }
  }
  return files.sort();
}
async function traversal(root, rel) {
  const out = [];
  for await (const d of await opendir(containedPath(root, rel))) {
    const name = `${rel}/${d.name}`; out.push(name);
    if (d.isDirectory()) out.push(...await traversal(root, name));
  }
  return out;
}
export function aggregate(rows) {
  const result = [];
  for (const split of ['development', 'heldout']) for (const query of ['ko', 'en-literal']) for (const implementation of ['baseline', 'revised']) {
    const all = rows.filter(r => r.split === split && r.query === query && r.implementation === implementation);
    const first = all.filter(r => r.repetition === 0), n = first.length;
    const mean = key => first.reduce((sum, r) => sum + r[key], 0) / n;
    const times = all.map(r => r.localPipelineMs).sort((a, b) => a - b);
    result.push({ split, query, implementation, tasks: n, requiredGroups: first.reduce((s, r) => s + r.candidateGroups.length, 0),
      candidateGroupHits: first.reduce((s, r) => s + r.candidateGroups.filter(Boolean).length, 0),
      returnedGroupHits: first.reduce((s, r) => s + r.returnedGroups.filter(Boolean).length, 0),
      meanCandidateRecall: mean('candidateRecall'), meanReturnedRecall: mean('returnedRecall'), meanOracleRecall: mean('oracleReturnedRecall'),
      allCandidateTasks: first.filter(r => r.allCandidateGroups).length, allReturnedTasks: first.filter(r => r.allReturnedGroups).length,
      rankPayloadEligibleTasks: first.filter(r => r.rankingPayload.eligible).length,
      localPipelineMedianMs: times[Math.floor(times.length / 2)],
      stable: first.every(r => new Set(all.filter(x => x.taskId === r.taskId).map(x => JSON.stringify([x.candidates, x.candidateGroups, x.returnedGroups, x.coverage]))).size === 1),
    });
  }
  return result;
}
async function main(corpusRoot, baselineSource) {
  const freeze = await json(path.join(HERE, 'comparison-freeze.json'));
  assert.equal(sha256(await readFile(fileURLToPath(import.meta.url))), freeze.comparisonSha256);
  const heldoutFreeze = await json(path.join(HERE, 'heldout-freeze.json'));
  const originalFreeze = await json(path.join(PILOT, 'freeze.json'));
  for (const [name, hash] of Object.entries(heldoutFreeze.sha256)) assert.equal(sha256(await readFile(path.join(HERE, name))), hash);
  for (const [name, hash] of Object.entries(originalFreeze.sha256)) assert.equal(sha256(await readFile(path.join(PILOT, name))), hash);
  assert.equal(sha256(await readFile(path.join(PILOT, 'evaluate.mjs'))), originalFreeze.evaluatorSha256);
  const baselineBytes = await readFile(baselineSource);
  assert.equal(sha256(baselineBytes), originalFreeze.readerCoreSha256);
  assert.equal(sha256(baselineBytes), heldoutFreeze.baselineCoreSha256);
  const revisedBytes = await readFile(new URL('../../../../extensions/pi-jev-context/core.mjs', import.meta.url));
  assert.equal(sha256(revisedBytes), freeze.revisedCoreSha256);
  // The known redaction-placeholder false positive stays visible; do not relax privacy to improve scores.
  assert.equal(revisedBytes.toString().match(/^const SECRET_TEXT = .*$/m)[0], baselineBytes.toString().match(/^const SECRET_TEXT = .*$/m)[0]);
  const development = await json(path.join(PILOT, 'tasks.json')), devGold = await json(path.join(PILOT, 'gold.json'));
  const heldout = await json(path.join(HERE, 'heldout-tasks.json')), heldoutGold = await json(path.join(HERE, 'heldout-gold.json'));
  const repositories = { ...development.repositories, ask: heldout.repository };
  const tasks = { repositories, tasks: [...development.tasks.map(t => ({ ...t, split: 'development' })),
    ...heldout.tasks.map(t => ({ ...t, repo: 'ask', retrievalAppropriate: true, split: 'heldout' }))] };
  const gold = { items: [...devGold.items, ...heldoutGold.items] };
  const manifest = await json(path.join(PILOT, 'corpus-manifest.json'));
  manifest.repositories.ask = await json(path.join(HERE, 'heldout-manifest.json'));
  const filesByRepo = {};
  for (const repo of Object.keys(repositories)) {
    const root = containedPath(corpusRoot, repo), expected = manifest.repositories[repo].files;
    assert.deepEqual(await inventory(root), expected.map(f => f.path).sort());
    filesByRepo[repo] = new Map();
    for (const f of expected) {
      const data = await readFile(containedPath(root, f.path));
      assert.equal(data.length, f.bytes); assert.equal(sha256(data), f.sha256);
      filesByRepo[repo].set(f.path, data);
    }
  }
  await validateGold(tasks, gold, filesByRepo);
  const cases = tasks.tasks.filter(t => t.retrievalAppropriate && !gold.items.find(g => g.id === t.id).unresolved);
  const temporary = await mkdtemp(path.join(tmpdir(), 'jev-candidate-comparison-'));
  const rows = [], nativeTraversal = {}, cache = new Map(), oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('offline_comparison_no_network'); };
  try {
    const baselinePath = path.join(temporary, 'baseline-core.mjs');
    await writeFile(baselinePath, baselineBytes, { flag: 'wx', mode: 0o600 });
    const baseline = await import(pathToFileURL(baselinePath).href);
    assert.deepEqual(baseline.LIMITS, revised.LIMITS);
    assert.equal(baseline.renderContext.toString(), revised.renderContext.toString());
    for (const [repo, files] of Object.entries(filesByRepo)) {
      const root = path.join(temporary, repo);
      for (const [name, data] of files) {
        const target = containedPath(root, name); await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data, { flag: 'wx' });
      }
      // Directory enumeration is recorded where the primary scanner recursively discovers files.
      nativeTraversal[repo] = repo === 'ask' ? repositories[repo].paths : await traversal(root, repositories[repo].paths[0]);
    }
    for (let repetition = 0; repetition < 3; repetition++) {
      const order = repetition % 2 ? [...cases].reverse() : cases;
      for (const task of order) for (const query of (repetition % 2 ? ['en-literal', 'ko'] : ['ko', 'en-literal'])) {
        const groups = gold.items.find(g => g.id === task.id).groups;
        for (const implementation of (repetition % 2 ? ['revised', 'baseline'] : ['baseline', 'revised'])) {
          const core = implementation === 'baseline' ? baseline : revised;
          const goal = query === 'ko' ? task.question : task.englishGoal;
          const paths = repositories[task.repo].paths;
          const begin = performance.now();
          const scan = await core.findCandidates({ root: path.join(temporary, task.repo), paths, allowedPaths: paths, goal });
          const rendered = core.renderContext({ scan, rankedIds: [], mode: 'original' });
          const localPipelineMs = performance.now() - begin;
          for (const c of scan.candidates) assert.equal(c.text, filesByRepo[task.repo].get(c.path).toString('utf8').split(/\r?\n/u).slice(c.startLine - 1, c.endLine).join('\n'));
          const key = JSON.stringify([implementation, task.id, scan.candidates]);
          if (!cache.has(key)) cache.set(key, oracleBest(groups, scan));
          const oracle = cache.get(key);
          let rankingPayload = { eligible: false, reason: 'fewer_than_two_candidates', bytes: null };
          if (scan.candidates.length >= 2) {
            try { rankingPayload = { eligible: true, reason: null, bytes: Buffer.byteLength(core.prepareRanking({ goal, candidates: scan.candidates, provider: 'openrouter' }).serialized) }; }
            catch (e) { rankingPayload = { eligible: false, reason: e.code ?? 'validation_error', bytes: null }; }
          }
          rows.push({ taskId: task.id, split: task.split, query, implementation, repetition, ...score(groups, scan, rendered),
            oracleReturnedRecall: oracle.recall, oracleGroups: oracle.groups, coverage: scan.coverage,
            localPipelineMs, outputBytes: Buffer.byteLength(JSON.stringify(rendered)), rankingPayload,
            candidates: scan.candidates.map(({ text, ...c }) => ({ ...c, bytes: Buffer.byteLength(text) })),
            returned: rendered.snippets.map(({ text, ...c }) => ({ ...c, bytes: Buffer.byteLength(text) })),
          });
        }
      }
    }
  } finally { globalThis.fetch = oldFetch; await rm(temporary, { recursive: true, force: true }); }
  return { kind: 'matched-offline-local-selector-comparison', generatedAt: new Date().toISOString(), node: process.version,
    freeze, heldoutFreeze, originalFreeze, repositories, limits: revised.LIMITS, nativeTraversal, summary: aggregate(rows), rows,
    excluded: ['b2: ambiguous executable context', 'b5: native-backend behavior unadjudicated', 's7/b7: natural-selection controls not executed'],
    measurements: { jevRequests: 0, jevMeasured: null, taskSuccess: null, taskTimeMs: null, taskCost: null, naturalToolSelection: null },
    limitations: ['Forced broad scope and prewritten Korean/literal-English queries; not observed parent queries.',
      'Implementation gold can undercount unlisted equivalent evidence. Development set informed the change; heldout is only four questions from one additional related repository.',
      'Oracle order is gold-aware, not Jev. Local timing is warm-cache scan/render only; no task speedup is established.',
      'Baseline and revised use identical source copies and limits. Three repetitions are not independent tasks. First repetitions determine summary recall; stability is reported.',
      'No parameter tuning or code changes based on heldout results are part of this comparison.'],
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node compare.mjs <verified-corpus-root> <pinned-baseline-core>');
  console.log(JSON.stringify(await main(path.resolve(process.argv[2]), process.argv[3]), null, 2));
}
