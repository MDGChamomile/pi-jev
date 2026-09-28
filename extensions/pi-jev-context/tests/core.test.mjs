import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LIMITS, findCandidates, prepareRanking, rankCandidates, renderContext } from '../core.mjs';

async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jev-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, name, text) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
const scan = (root, paths, allowedPaths = ['src']) => findCandidates({ root, paths, allowedPaths, goal: '완료 소각 cancellation', });
const candidate = (id='a', text='소각 완료했다.') => ({ id, path:'src/a.ts', startLine:1, endLine:1, text });
const validResponse = (ids, provider='openrouter') => ({
  model: provider === 'openrouter' ? 'typesafe/jev-1.2' : 'jev-1.2',
  answers: Object.fromEntries(ids.map((_,i)=>[`candidate_${i}`, { type:'score', score:i ? 3 : 1, confidence:.9, probabilities:{0:0,1:i?0:1,2:0,3:i?1:0} }])),
  usage:{ input_tokens:10, output_tokens:2, cost:0.0001 },
});

test('finds Korean goal matches, returns contiguous original windows and merges adjacent matches', async t => {
  const root = await project(t);
  await put(root, 'src/a.ts', '첫째\n계획은 소각\n중간\n소각 완료\n마지막');
  const result = await scan(root, ['src']);
  assert.equal(result.status, 'found');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].startLine, 1);
  assert.equal(result.candidates[0].endLine, 5);
  assert.equal(result.candidates[0].text, '첫째\n계획은 소각\n중간\n소각 완료\n마지막');
});

test('rejects traversal, absolute paths and requested paths outside allowlist', async t => {
  const root = await project(t);
  for (const bad of ['../elsewhere', '/tmp/private', 'src/../secret', 'src\\secret']) {
    await assert.rejects(findCandidates({ root, paths:[bad], allowedPaths:['src'], goal:'x' }), { code:'invalid_path' });
  }
  await assert.rejects(findCandidates({ root, paths:['other'], allowedPaths:['src'], goal:'x' }), { code:'path_not_allowed' });
});

test('never follows file or parent symlinks, including a symlink pointing back inside root', async t => {
  const root = await project(t);
  await put(root, 'src/real.ts', '소각 완료');
  await symlink('real.ts', path.join(root, 'src/link.ts'));
  await symlink(path.join(root, 'src'), path.join(root, 'alias'));
  const result = await findCandidates({ root, paths:['src','alias','alias/real.ts'], allowedPaths:['src','alias'], goal:'소각 완료' });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].path, 'src/real.ts');
  assert.ok(result.coverage.skipped >= 1);
});

test('skips protected/generated files and known secret-bearing source without returning their content', async t => {
  const root = await project(t);
  await put(root, 'src/.env', '소각 API_KEY=PRIVATE_123456789');
  await put(root, 'src/key.pem', '-----BEGIN PRIVATE KEY-----\nPRIVATE');
  await put(root, 'src/token.ts', 'const api_key = "PRIVATE_123456789"; // 소각 완료');
  await put(root, 'src/json-secret.ts', '{"api_key":"synthetic-value-123","password":"another-synthetic-value"}');
  await put(root, 'src/yaml-secret.ts', "'access_token': 'synthetic-access-token-123'\nsecret: synthetic-secret-value-123");
  await put(root, 'src/ghp.ts', 'ghp_abcdefghijklmnopqrstuvwxyz123456');
  await put(root, 'src/gho.ts', 'gho_abcdefghijklmnopqrstuvwxyz123456');
  await put(root, 'src/github-pat.ts', 'github_pat_abcdefghijklmnopqrstuvwxyz123456');
  await put(root, 'src/xoxb.ts', 'xoxb-synthetic-token-value-123456');
  await put(root, 'src/node_modules/pkg/a.ts', '소각 완료');
  await put(root, 'src/ordinary.ts', '소각 완료');
  const result = await scan(root, ['src']);
  assert.deepEqual(result.candidates.map(c=>c.path), ['src/ordinary.ts']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|PRIVATE KEY/);
  assert.ok(result.coverage.skipped >= 9);
});

test('keeps a matching line when shrinking an oversized window around its anchor', async t => {
  const root = await project(t);
  await put(root, 'src/leading.ts', `${'x'.repeat(9 * 1024)}\n\n${'y'.repeat(9 * 1024)}\nneedle found`);
  const result = await findCandidates({ root, paths:['src/leading.ts'], allowedPaths:['src'], goal:'needle' });
  assert.equal(result.status, 'found');
  assert.match(result.candidates[0].text, /needle found/);
  assert.equal(result.candidates[0].startLine, 4);
  assert.ok(Buffer.byteLength(result.candidates[0].text) <= LIMITS.excerptBytes);
});

test('clips a dense merged match window with bounded output and incomplete coverage', async t => {
  const root = await project(t);
  await put(root, 'src/dense.ts', `${'needle\n'.repeat(13_500)}`);
  const result = await findCandidates({ root, paths:['src/dense.ts'], allowedPaths:['src'], goal:'needle' });
  assert.equal(result.status, 'found');
  assert.equal(result.coverage.limited, true);
  assert.match(result.candidates[0].text, /needle/);
  assert.ok(Buffer.byteLength(result.candidates[0].text) <= LIMITS.excerptBytes);
});

test('omits oversized matching lines and marks merged-window match loss incomplete', async t => {
  const root = await project(t);
  await put(root, 'src/huge-line.ts', `needle ${'x'.repeat(LIMITS.excerptBytes + 1)}`);
  const oversized = await findCandidates({ root, paths:['src/huge-line.ts'], allowedPaths:['src'], goal:'needle' });
  assert.equal(oversized.candidates.length, 0);
  assert.equal(oversized.status, 'limit_reached');
  assert.equal(oversized.coverage.limited, true);

  await put(root, 'src/merged.ts', `firstneedle\n${'z'.repeat(9 * 1024)}\nsecondneedle`);
  const merged = await findCandidates({ root, paths:['src/merged.ts'], allowedPaths:['src'], goal:'needle' });
  assert.equal(merged.status, 'found');
  assert.ok(merged.coverage.limited);
  assert.match(merged.candidates[0].text, /firstneedle/);
  assert.doesNotMatch(merged.candidates[0].text, /secondneedle/);
});

test('filename-only matches remain available', async t => {
  const root = await project(t);
  await put(root, 'src/needle.ts', 'ordinary text');
  const result = await findCandidates({ root, paths:['src/needle.ts'], allowedPaths:['src'], goal:'needle' });
  assert.equal(result.status, 'found');
  assert.equal(result.candidates[0].text, 'ordinary text');
});

test('missing and inaccessible in-scope paths report incomplete coverage', async t => {
  const root = await project(t);
  await mkdir(path.join(root, 'src'), { recursive:true });
  for (const requested of ['src/missing.ts', 'src/not-a-directory/child.ts']) {
    const result = await findCandidates({ root, paths:[requested], allowedPaths:['src'], goal:'needle' });
    assert.equal(result.status, 'limit_reached');
    assert.equal(result.coverage.limited, true);
  }
});

test('intentional hidden and unsupported-file exclusions do not mark coverage incomplete', async t => {
  const root = await project(t);
  await put(root, 'src/.hidden.ts', 'needle');
  await put(root, 'src/archive.lock', 'needle');
  const result = await findCandidates({ root, paths:['src'], allowedPaths:['src'], goal:'needle' });
  assert.equal(result.status, 'not_found');
  assert.equal(result.coverage.limited, false);
});

test('excludes hidden and lock files, rejects invalid UTF-8, and deduplicates overlapping paths', async t => {
  const root = await project(t);
  await put(root, 'src/.hidden/a.ts', '소각 완료');
  await put(root, 'src/package-lock.json', '소각 완료');
  await put(root, 'src/ordinary.ts', '소각 완료');
  await writeFile(path.join(root, 'src/invalid.ts'), Buffer.from([0xff, 0xfe]));
  const result = await findCandidates({ root, paths:['src','src/ordinary.ts'], allowedPaths:['src'], goal:'소각 완료' });
  assert.deepEqual(result.candidates.map(c=>c.path), ['src/ordinary.ts']);
  assert.equal(result.coverage.filesRead, 1);
  assert.ok(result.coverage.skipped >= 3);
});

test('bounded read stays within file and total-byte limits while a source grows', async t => {
  const root = await project(t);
  await put(root, 'src/growing.ts', `소각 ${'x'.repeat(LIMITS.fileBytes - 32)}`);
  const growing = findCandidates({ root, paths:['src/growing.ts'], allowedPaths:['src'], goal:'소각' });
  const writing = (async () => {
    for (let i=0; i<8; i++) await appendFile(path.join(root, 'src/growing.ts'), 'y'.repeat(32 * 1024));
  })();
  const [result] = await Promise.all([growing, writing]);
  assert.ok(result.coverage.bytesRead <= LIMITS.fileBytes + 1);
  assert.ok(result.coverage.bytesRead <= LIMITS.totalBytes);
});

test('candidate cap marks scan incomplete instead of silently truncating', async t => {
  const root = await project(t);
  for (let i=0; i<LIMITS.candidates + 2; i++) await put(root, `src/${i}.ts`, `unique_${i} 소각`);
  const result = await findCandidates({ root, paths:['src'], allowedPaths:['src'], goal:'소각' });
  assert.equal(result.candidates.length, LIMITS.candidates);
  assert.equal(result.coverage.limited, true);
});

test('bounded traversal distinguishes no match from incomplete limit and no-term goals terminate', async t => {
  const root = await project(t);
  await put(root, 'src/a.ts', 'unrelated ordinary content');
  assert.equal((await findCandidates({ root, paths:['src/a.ts'], allowedPaths:['src'], goal:'!!!' })).status, 'not_found');
  const many = Array.from({length: LIMITS.entries + 2}, (_,i)=>`src/f${i}.txt`);
  for (const f of many.slice(0, LIMITS.entries + 2)) await put(root, f, 'nothing');
  const result = await findCandidates({ root, paths:['src'], allowedPaths:['src'], goal:'소각' });
  assert.equal(result.coverage.limited, true);
  assert.equal(result.status, 'limit_reached');
  assert.ok(result.coverage.filesConsidered <= LIMITS.files);
});

test('cancellation is respected before filesystem access, including no-term goals', async t => {
  const root = await project(t);
  const controller = new AbortController(); controller.abort();
  for (const goal of ['abc', '!!!']) {
    await assert.rejects(findCandidates({ root, paths:['src'], allowedPaths:['src'], goal, signal:controller.signal }), { code:'cancelled' });
  }
});

test('ranking preparation retains only goal and bounded original candidates for both providers', () => {
  const cs = [candidate(), candidate('b','계획 중이다.')];
  for (const provider of ['openrouter','typesafe']) {
    const prepared = prepareRanking({ goal:'완료 여부를 확인합니다.', candidates:cs, provider });
    assert.deepEqual(Object.keys(prepared.request.state).sort(), ['candidates','goal']);
    assert.deepEqual(prepared.request.state.candidates, cs);
    assert.ok(Buffer.byteLength(prepared.serialized) <= LIMITS.requestBytes);
    assert.equal(JSON.parse(prepared.serialized).provider?.allow_fallbacks, provider === 'openrouter' ? false : undefined);
  }
  for (const provider of ['bad', null, undefined]) assert.throws(() => prepareRanking({ goal:'x', candidates:[candidate()], provider }), { code:'invalid_provider' });
  assert.throws(() => prepareRanking({ goal:'x', candidates:[{...candidate(), text:'x'.repeat(LIMITS.excerptBytes + 1)}], provider:'typesafe' }), { code:'invalid_input' });
  for (const goal of ['send with Bearer abcdefghijklmnopqrstuvwxyz', 'my api_key=sk-abcdefghijklmnopqrstuvwxyz']) {
    assert.throws(() => prepareRanking({ goal, candidates:[candidate()], provider:'typesafe' }), { code:'sensitive_input' });
  }
  const knownCredentials = [
    '{"api_key":"synthetic-value-123"}',
    "'password': 'synthetic-password-value'",
    'access_token: synthetic-access-token-123',
    'secret="synthetic-secret-value"',
    'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'gho_abcdefghijklmnopqrstuvwxyz123456',
    'github_pat_abcdefghijklmnopqrstuvwxyz123456',
    'xoxb-synthetic-token-value-123456',
  ];
  for (const value of knownCredentials) {
    assert.throws(() => prepareRanking({ goal:'x', candidates:[candidate('a',value)], provider:'typesafe' }), { code:'sensitive_input' });
    assert.throws(() => prepareRanking({ goal:value, candidates:[candidate()], provider:'typesafe' }), { code:'sensitive_input' });
  }
});

test('mocked ranking makes exactly one wire request to each explicit provider with preserved semantic text', async () => {
  const cs = [candidate('a','결의했지만 아직 완료하지 않았다.'), candidate('b','소각 완료')];
  for (const provider of ['openrouter','typesafe']) {
    let calls = 0;
    const ranked = await rankCandidates({ goal:'완료 여부 및 부정 표현을 구분합니다.', candidates:cs, provider, apiKey:'FAKE_TEST_KEY', fetchImpl:async (url, init) => {
      calls++;
      assert.equal(url, provider === 'openrouter' ? 'https://openrouter.ai/api/alpha/decisions' : 'https://api.typesafe.ai/v1/systemone');
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer FAKE_TEST_KEY');
      const wire = JSON.parse(init.body);
      assert.equal(wire.state.candidates[0].text, cs[0].text);
      assert.equal(wire.state.goal, '완료 여부 및 부정 표현을 구분합니다.');
      if (provider === 'openrouter') assert.equal(wire.provider.allow_fallbacks, false);
      return new Response(JSON.stringify(validResponse(cs.map(c=>c.id), provider)));
    }});
    assert.equal(calls, 1);
    assert.deepEqual(ranked.rankedIds, ['b','a']);
    assert.equal(ranked.usage.input_tokens, 10);
  }
});

test('malformed responses, HTTP errors, response overflow and timeout fail with fixed codes', async () => {
  const args = { goal:'x', candidates:[candidate()], provider:'typesafe', apiKey:'FAKE_TEST_KEY' };
  await assert.rejects(rankCandidates({ ...args, fetchImpl:async()=>new Response('not json') }), { code:'invalid_response' });
  await assert.rejects(rankCandidates({ ...args, fetchImpl:async()=>new Response(JSON.stringify({...validResponse(['a'],'typesafe'), model:'secret'})) }), { code:'invalid_response' });
  await assert.rejects(rankCandidates({ ...args, fetchImpl:async()=>new Response('PRIVATE', {status:429}) }), { code:'rate_limited' });
  await assert.rejects(rankCandidates({ ...args, fetchImpl:async()=>new Response('x'.repeat(LIMITS.responseBytes + 1)) }), { code:'output_too_large' });
  await assert.rejects(rankCandidates({ ...args, fetchImpl:async()=>{ const error = Error('private'); error.code = 'PRIVATE_RAW_CODE'; throw error; } }), { code:'provider_error' });
  await assert.rejects(rankCandidates({ ...args, fetchImpl:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('private')))) }), { code:'timeout' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(rankCandidates({ ...args, signal:controller.signal, fetchImpl:async()=>assert.fail('must not fetch') }), { code:'cancelled' });
});

test('renderer validates ranking IDs, preserves source references and bounds output', () => {
  const scan = { status:'found', coverage:{ filesConsidered:2, filesRead:2, bytesRead:100, limited:false, skipped:0 }, candidates:[candidate('a'), candidate('b','계획했다.')] };
  const rendered = renderContext({ scan, rankedIds:['b','a'], mode:'ranked' });
  assert.deepEqual(rendered.snippets.map(s=>s.text), ['계획했다.','소각 완료했다.']);
  assert.equal(rendered.snippets[0].startLine, 1);
  assert.ok(rendered.notice.includes('완전'));
  for (const rankedIds of [['a'], ['a','a'], ['a','unknown']]) {
    assert.throws(() => renderContext({ scan, rankedIds, mode:'ranked' }), { code:'invalid_ranking' });
  }
  assert.ok(Buffer.byteLength(JSON.stringify(rendered)) <= LIMITS.outputBytes);
  const emptyScan = { status:'not_found',coverage:scan.coverage,candidates:[] };
  const absent = renderContext({ scan:emptyScan, rankedIds:[], mode:'original' });
  assert.equal(absent.status, 'not_found'); assert.ok(absent.notice.includes('증명'));
  assert.throws(() => renderContext({ scan:emptyScan, rankedIds:[], mode:'none' }), { code:'invalid_input' });
  const limited = renderContext({ scan:{status:'limit_reached',coverage:{...scan.coverage,limited:true},candidates:[]}, rankedIds:[], mode:'original' });
  assert.equal(limited.status, 'limit_reached');
});
