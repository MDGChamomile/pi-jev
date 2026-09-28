// Offline forced-retrieval pilot. Does not invoke a model, authenticate, or install an extension.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, mkdir, writeFile, mkdtemp, rm, opendir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { findCandidates, renderContext, prepareRanking, LIMITS } from '../../../extensions/pi-jev-context/core.mjs';

// This module lives one directory deeper than the original synthetic evaluator.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
export function containedPath(root, name) {
  assert.equal(typeof name, 'string');
  assert.ok(name && !path.isAbsolute(name) && !name.includes('\\') && !name.split('/').some(p => !p || p === '.' || p === '..'));
  return path.join(root, ...name.split('/'));
}
export function groupHits(groups, passages) {
  return groups.map(group => group.alternatives.some(span => passages.some(p =>
    p.path === span.path && p.startLine <= span.startLine && p.endLine >= span.endLine)));
}
const recall = hits => hits.filter(Boolean).length / hits.length;
export function score(groups, scan, rendered) {
  assert.ok(groups.length > 0);
  const candidateGroups = groupHits(groups, scan.candidates), returnedGroups = groupHits(groups, rendered.snippets);
  return { candidateGroups, returnedGroups, candidateRecall: recall(candidateGroups), returnedRecall: recall(returnedGroups),
    allCandidateGroups: candidateGroups.every(Boolean), allReturnedGroups: returnedGroups.every(Boolean) };
}
export function oracleBest(groups, scan) {
  // Gold-aware ceiling, NOT Jev. Every feasible <=3-block output set has a prefix tested here.
  // Use the real renderer, including serialized byte limits; never supply replacement source text.
  const ids = scan.candidates.map(c => c.id);
  let best = { recall: 0, groups: groups.map(() => false), rankedIds: ids };
  function visit(prefix, start) {
    const order = [...prefix, ...ids.filter(id => !prefix.includes(id))];
    const rendered = renderContext({ scan, rankedIds: order, mode: 'ranked' });
    const hits = groupHits(groups, rendered.snippets), value = recall(hits);
    if (value > best.recall) best = { recall: value, groups: hits, rankedIds: order };
    if (prefix.length < LIMITS.outputBlocks) for (let i = start; i < ids.length; i++) visit([...prefix, ids[i]], i + 1);
  }
  visit([], 0);
  return best;
}
async function listFiles(root, relative = '') {
  const found = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'corpus symlinks are not allowed');
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listFiles(root, rel));
    else { assert.ok(entry.isFile()); found.push(rel); }
  }
  return found.sort();
}
async function nativeOrder(root, relative) {
  const paths = [relative];
  const info = await lstat(containedPath(root, relative));
  if (info.isDirectory()) {
    for await (const entry of await opendir(containedPath(root, relative))) paths.push(...await nativeOrder(root, `${relative}/${entry.name}`));
  }
  return paths;
}
export async function validateGold(tasks, gold, corpora) {
  const taskMap = new Map(tasks.tasks.map(t => [t.id, t]));
  assert.equal(taskMap.size, tasks.tasks.length);
  const seen = new Set();
  for (const item of gold.items) {
    assert.ok(!seen.has(item.id) && taskMap.has(item.id)); seen.add(item.id);
    const task = taskMap.get(item.id), files = corpora[task.repo];
    if (item.unresolved) { assert.equal(item.groups.length, 0); continue; }
    assert.ok(task.retrievalAppropriate && item.groups.length > 0);
    for (const group of item.groups) {
      assert.ok(group.alternatives.length > 0);
      for (const span of group.alternatives) {
        assert.ok(tasks.repositories[task.repo].paths.some(scope => span.path === scope || span.path.startsWith(`${scope}/`)));
        assert.ok(files.has(span.path), `unknown gold path for ${item.id}`);
        const lines = files.get(span.path).toString('utf8').split(/\r?\n/u);
        assert.ok(Number.isInteger(span.startLine) && Number.isInteger(span.endLine) && span.startLine >= 1 && span.endLine >= span.startLine && span.endLine <= lines.length);
        assert.ok(span.endLine - span.startLine < 5, `non-atomic gold span for ${item.id}`);
        assert.ok(lines.slice(span.startLine - 1, span.endLine).join('\n').trim(), `empty gold span for ${item.id}`);
      }
    }
  }
  for (const task of tasks.tasks) if (task.retrievalAppropriate) assert.ok(seen.has(task.id));
}
function validatePassages(candidates, files) {
  for (const c of candidates) {
    const lines = files.get(c.path).toString('utf8').split(/\r?\n/u);
    assert.equal(c.text, lines.slice(c.startLine - 1, c.endLine).join('\n'));
  }
}
export function summarize(rows) {
  const summaries = [];
  for (const order of ['ascending', 'descending']) for (const query of ['ko', 'en-literal']) {
    const subset = rows.filter(r => r.order === order && r.query === query);
    const unique = [...new Set(subset.map(r => r.taskId))];
    const first = unique.map(id => subset.find(r => r.taskId === id));
    const mean = key => first.reduce((s, r) => s + r[key], 0) / first.length;
    const times = subset.map(r => r.localPipelineMs).sort((a, b) => a - b);
    summaries.push({ order, query, tasks: first.length, repetitions: subset.length / first.length,
      meanCandidateRecall: mean('candidateRecall'), meanReturnedRecall: mean('returnedRecall'),
      meanOracleReturnedRecall: mean('oracleReturnedRecall'),
      allCandidateTasks: first.filter(r => r.allCandidateGroups).length,
      allReturnedTasks: first.filter(r => r.allReturnedGroups).length,
      anyCandidateTasks: first.filter(r => r.candidateRecall > 0).length,
      limitedTasks: first.filter(r => r.coverage.limited).length,
      rankPayloadEligibleTasks: first.filter(r => r.rankingPayload.eligible).length,
      localPipelineMedianMs: times[Math.floor(times.length / 2)],
      localPipelineMinMs: times[0], localPipelineMaxMs: times.at(-1),
      stableAcrossRepetitions: unique.every(id => new Set(subset.filter(r => r.taskId === id).map(r =>
        JSON.stringify([r.candidates, r.candidateGroups, r.returnedGroups, r.oracleReturnedRecall, r.coverage]))).size === 1),
    });
  }
  return summaries;
}
export async function evaluate(corpusRoot) {
  const raw = {};
  for (const name of ['tasks.json', 'gold.json', 'corpus-manifest.json', 'freeze.json']) raw[name] = await readFile(path.join(HERE, name));
  const freeze = JSON.parse(raw['freeze.json']);
  for (const name of ['tasks.json', 'gold.json', 'corpus-manifest.json']) assert.equal(sha256(raw[name]), freeze.sha256[name], `${name} changed after freeze`);
  const corePath = fileURLToPath(new URL('../../../extensions/pi-jev-context/core.mjs', import.meta.url));
  assert.equal(sha256(await readFile(corePath)), freeze.readerCoreSha256, 'reader changed after freeze');
  assert.equal(sha256(await readFile(fileURLToPath(import.meta.url))), freeze.evaluatorSha256, 'evaluator changed after freeze');
  const tasks = JSON.parse(raw['tasks.json']), gold = JSON.parse(raw['gold.json']), manifest = JSON.parse(raw['corpus-manifest.json']);
  const corpora = {};
  for (const repo of Object.keys(tasks.repositories)) {
    const base = containedPath(path.resolve(corpusRoot), repo);
    assert.ok(!(await lstat(base)).isSymbolicLink());
    const inventory = manifest.repositories[repo].files;
    assert.deepEqual(await listFiles(base), inventory.map(f => f.path).sort(), 'corpus inventory differs');
    corpora[repo] = new Map();
    for (const f of inventory) {
      const data = await readFile(containedPath(base, f.path));
      assert.equal(data.length, f.bytes); assert.equal(sha256(data), f.sha256);
      corpora[repo].set(f.path, data);
    }
  }
  await validateGold(tasks, gold, corpora);
  const scored = tasks.tasks.filter(t => t.retrievalAppropriate && !gold.items.find(g => g.id === t.id).unresolved);
  const temporary = await mkdtemp(path.join(tmpdir(), 'jev-context-real-pilot-'));
  const rows = [], observedTraversal = {}, diagnosticGoldPaths = [], oracleCache = new Map();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network_disabled_in_offline_pilot'); };
  try {
    for (const order of ['ascending', 'descending']) {
      observedTraversal[order] = {};
      for (const [repo, files] of Object.entries(corpora)) {
        const base = path.join(temporary, order, repo), names = [...files.keys()].sort();
        if (order === 'descending') names.reverse();
        for (const name of names) {
          const target = containedPath(base, name);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, files.get(name), { flag: 'wx' });
        }
        observedTraversal[order][repo] = [];
        for (const scope of tasks.repositories[repo].paths) observedTraversal[order][repo].push(...await nativeOrder(base, scope));
      }
      for (let repetition = 0; repetition < freeze.repetitions; repetition++) {
        const sequence = repetition % 2 ? [...scored].reverse() : scored;
        for (const task of sequence) for (const query of (repetition % 2 ? ['en-literal', 'ko'] : ['ko', 'en-literal'])) {
          const goal = query === 'ko' ? task.question : task.englishGoal;
          const paths = tasks.repositories[task.repo].paths, groups = gold.items.find(g => g.id === task.id).groups;
          const started = performance.now();
          const scan = await findCandidates({ root: path.join(temporary, order, task.repo), paths, allowedPaths: paths, goal });
          const rendered = renderContext({ scan, rankedIds: [], mode: 'original' });
          const localPipelineMs = performance.now() - started;
          validatePassages(scan.candidates, corpora[task.repo]);
          const metrics = score(groups, scan, rendered);
          const cacheKey = JSON.stringify([task.id, scan.candidates]);
          if (!oracleCache.has(cacheKey)) oracleCache.set(cacheKey, oracleBest(groups, scan));
          const oracle = oracleCache.get(cacheKey);
          let rankingPayload = { eligible: false, reason: 'fewer_than_two_candidates', bytes: null };
          if (scan.candidates.length >= 2) {
            try {
              const p = prepareRanking({ goal, candidates: scan.candidates, provider: 'openrouter' });
              rankingPayload = { eligible: true, reason: null, bytes: Buffer.byteLength(p.serialized) };
            } catch (e) { rankingPayload = { eligible: false, reason: e.code ?? 'validation_error', bytes: null }; }
          }
          rows.push({ taskId: task.id, repo: task.repo, order, repetition, query, ...metrics,
            oracleReturnedRecall: oracle.recall, oracleGroups: oracle.groups,
            coverage: scan.coverage, status: rendered.status, localPipelineMs, outputBytes: bytes(rendered), rankingPayload,
            candidates: scan.candidates.map(({ text, ...p }) => ({ ...p, bytes: Buffer.byteLength(text) })),
            returned: rendered.snippets.map(({ text, ...p }) => ({ ...p, bytes: Buffer.byteLength(text) })),
          });
        }
      }
    }
    // Explicitly oracle-aided diagnosis AFTER all broad-scope measurements. Never included in primary scores.
    for (const task of scored) {
      const groups = gold.items.find(g => g.id === task.id).groups;
      const paths = [...new Set(groups.flatMap(g => g.alternatives.map(a => a.path)))].sort();
      const scan = await findCandidates({ root: path.join(temporary, 'ascending', task.repo), paths,
        allowedPaths: tasks.repositories[task.repo].paths, goal: task.englishGoal });
      validatePassages(scan.candidates, corpora[task.repo]);
      const rendered = renderContext({ scan, rankedIds: [], mode: 'original' });
      diagnosticGoldPaths.push({ taskId: task.id, oracleAided: true, ...score(groups, scan, rendered), coverage: scan.coverage,
        candidates: scan.candidates.map(({ text, ...p }) => p) });
    }
  } finally {
    globalThis.fetch = oldFetch;
    await rm(temporary, { recursive: true, force: true });
  }
  return { kind: 'offline-forced-real-source-pilot', generatedAt: new Date().toISOString(), node: process.version,
    freeze, limits: LIMITS, repositories: tasks.repositories, summary: summarize(rows), rows, observedTraversal, diagnosticGoldPaths,
    excluded: tasks.tasks.filter(t => !scored.includes(t)).map(t => ({ id: t.id, reason: !t.retrievalAppropriate ? 'known-location negative control; natural selection not measured' : gold.items.find(g => g.id === t.id).unresolved })),
    measurements: { baselineTaskSuccess: null, localTaskSuccess: null, jevTaskSuccess: null, taskTimeMs: null,
      taskCost: null, naturalToolSelection: null, parentTokens: null, jevRequests: 0, jevMeasured: null },
    limitations: ['Not an A/B/C task experiment or actual Pi tool execution.', 'Korean and literal English goals are controlled inputs, not observed model-generated queries.',
      'Gold-aware ordering and gold-file probes are diagnostics, not Jev results.', 'Ten scored tasks from two related ecosystem repositories are not a representative sample.',
      'Gold uses designated implementation spans; unlisted valid alternatives may be undercounted.',
      'Sources were prevalidated and copied: timings are warm-cache local pipeline only, excluding models, authentication, setup, and oracle scoring.',
      'Creation order is perturbed, not a promise of sorted filesystem traversal; actual traversal is recorded.'],
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node evaluate.mjs <verified-corpus-root>');
  console.log(JSON.stringify(await evaluate(process.argv[2]), null, 2));
}
