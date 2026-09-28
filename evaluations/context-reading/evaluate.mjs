// Offline synthetic fixture evaluator. No provider, network, or extension runner.
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCandidates, renderContext } from '../../extensions/pi-jev-context/core.mjs';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = () => { throw new Error('invalid_evaluation_input'); };
function validateFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length < 1 || fixtures.length > 6) fail();
  const ids = new Set(); let total = 0;
  for (const f of fixtures) {
    if (!f || typeof f.id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(f.id) || ids.has(f.id) || typeof f.goal !== 'string' || !f.goal.trim() || f.goal.length > 500 || !f.files || Array.isArray(f.files) || typeof f.files !== 'object') fail();
    ids.add(f.id);
    const entries = Object.entries(f.files);
    if (!entries.length || entries.length > 12 || !Array.isArray(f.gold) || !f.gold.length || f.gold.length > 12) fail();
    const paths = new Set();
    for (const [name, text] of entries) {
      if (typeof name !== 'string' || name.length > 180 || name.startsWith('/') || name.includes('\\') || name.split('/').some(x => !x || x === '.' || x === '..') || path.posix.isAbsolute(name) || typeof text !== 'string' || !text.length || Buffer.byteLength(text) > 16 * 1024) fail();
      paths.add(name); total += Buffer.byteLength(text);
    }
    for (const g of f.gold) if (!g || !paths.has(g.path) || typeof g.text !== 'string' || !g.text.length || !f.files[g.path].includes(g.text)) fail();
    if (total > 64 * 1024) fail();
  }
}
const recall = (gold, passages) => gold.length ? gold.filter(g => passages.some(p => p.path === g.path && p.text.includes(g.text))).length / gold.length : null;
export function score(fixture, scan, rendered) {
  return { id: fixture.id, candidateRecall: recall(fixture.gold, scan.candidates), returnedRecall: recall(fixture.gold, rendered.snippets) };
}
async function scanFixtures(fixtures) {
  validateFixtures(fixtures);
  const root = await mkdtemp(path.join(os.tmpdir(), 'jev-purpose-reading-'));
  try {
    const scans = [];
    for (const f of fixtures) {
      const base = path.join(root, f.id);
      for (const [name, text] of Object.entries(f.files)) {
        const target = path.join(base, ...name.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, text, { flag: 'wx' });
      }
      const paths = Object.keys(f.files);
      scans.push(await findCandidates({ root: base, paths, allowedPaths: paths, goal: f.goal }));
    }
    return scans;
  } finally { await rm(root, { recursive: true, force: true }); }
}
export async function evaluate(fixtures) {
  const scans = await scanFixtures(fixtures);
  const cases = fixtures.map((f, i) => {
    const scan = scans[i], rendered = renderContext({ scan, rankedIds: scan.candidates.map(c => c.id), mode: 'original' });
    return { ...score(f, scan, rendered), status: scan.status, coverage: scan.coverage };
  });
  return { kind: 'local-core', source: 'synthetic-local-core', evidence: 'Not Jev output or live/user-task performance.', measurements: { baselineTaskSuccess: null, baselineTimeMs: null, baselineCost: null, taskSuccess: null, taskTimeMs: null, taskCost: null, naturalToolSelection: null, jevMeasured: null }, cases };
}
export async function replay(fixtures, records) {
  validateFixtures(fixtures);
  if (!Array.isArray(records) || records.length > fixtures.length) fail();
  const seen = new Set();
  for (const r of records) if (!r || typeof r.caseId !== 'string' || seen.has(r.caseId) || !fixtures.some(f => f.id === r.caseId) || !Array.isArray(r.rankedIds)) fail(); else seen.add(r.caseId);
  const scans = await scanFixtures(fixtures);
  return { kind: 'offline-replay', source: 'unverified-user-supplied-ranking-records', evidence: 'Records are not verified Jev output; no live Jev call was made.', measurements: { baselineTaskSuccess: null, baselineTimeMs: null, baselineCost: null, taskSuccess: null, taskTimeMs: null, taskCost: null, naturalToolSelection: null, jevMeasured: null }, cases: fixtures.map((f, i) => {
    const record = records.find(r => r.caseId === f.id), scan = scans[i];
    if (!record) return { id: f.id, candidateRecall: null, returnedRecall: null, replayed: false };
    const ids = scan.candidates.map(c => c.id);
    if (record.rankedIds.length !== ids.length || new Set(record.rankedIds).size !== ids.length || record.rankedIds.some(id => !ids.includes(id))) fail();
    const rendered = renderContext({ scan, rankedIds: record.rankedIds, mode: 'ranked' });
    return { ...score(f, scan, rendered), replayed: true, status: rendered.status, omitted: rendered.omitted };
  }) };
}
async function main(args) {
  let replayPath;
  if (args.length === 0) replayPath = null;
  else if (args.length === 2 && args[0] === '--replay' && args[1]) replayPath = args[1];
  else fail();
  const fixtures = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8'));
  const report = replayPath ? await replay(fixtures, JSON.parse(await readFile(replayPath, 'utf8'))) : await evaluate(fixtures);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => { console.error('Evaluation failed; check arguments, fixtures, and ranking IDs. See evaluations/context-reading/README.md.'); process.exitCode = 1; });
