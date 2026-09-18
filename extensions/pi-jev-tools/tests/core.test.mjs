import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildRequest, createRunner, parseResponse, runAdapter, LIMITS } from '../core.mjs';

const input = () => ({ question: 'Was the cancellation completed?', criteria: 'Distinguish approval from completed execution.', candidates: [
  { id: 'a', url: 'https://example.com/a', title: 'Plan', excerpt: '다음 달 소각하기로 결의했다.' },
  { id: 'b', url: 'https://example.org/b', title: 'Execution', excerpt: '소각을 완료했다.' },
] });
const answer = (level) => ({ type: 'score', score: level, confidence: 1, probabilities: Object.fromEntries([0,1,2,3].map(i => [String(i), Number(i === level)])) });
const response = () => ({ status: 'ok', model: 'jev-1.13.0', answers: { candidate_0: answer(1), candidate_1: answer(3) }, usage: { input_tokens: 100, output_tokens: 20 } });
const ctx = (confirm = true) => ({ hasUI: true, ui: { editor: async (_, value) => value, confirm: async () => confirm } });
const options = (run) => ({ python: '/existing/python', adapter: '/adapter.py', env: { TYPESAFE_API_KEY: 'FAKE_TEST_KEY' }, run });

test('request preserves Korean text; uses shared concrete English levels and explicit candidate paths', () => {
  const built = buildRequest(input());
  assert.equal(built.request.state.candidates[0].excerpt, input().candidates[0].excerpt);
  assert.equal(built.request.model, 'jev-latest');
  assert.match(built.request.questions.candidate_1.instructions, /candidates\[1\]/);
  assert.deepEqual(built.request.questions.candidate_0.criteria, built.request.questions.candidate_1.criteria);
  assert.deepEqual(JSON.parse(built.serialized), built.request);
});

test('input limits, IDs and source URLs are validated without echoing input', () => {
  const cases = [
    x => x.candidates.push(x.candidates[0]),
    x => x.candidates = Array.from({ length: 11 }, (_, i) => ({ ...x.candidates[0], id: `id${i}` })),
    x => x.candidates[0].excerpt = '가'.repeat(4001),
    x => x.question = '\ud800',
    x => x.criteria = '\u001b[2J',
    x => x.secret = 'PRIVATE',
    x => x.candidates[0].path = '/private/file',
    x => x.candidates[0].url = 'file:///private/file',
    x => x.candidates[0].url = 'https://user:password@example.com',
    x => x.candidates[0].url = 'https://127.0.0.1',
    x => x.candidates[0].url = 'https://host.internal/',
  ];
  for (const change of cases) {
    const x = input(); change(x);
    assert.throws(() => buildRequest(x), { name: 'Error' });
  }
  const x = input();
  x.candidates = Array.from({ length: 10 }, (_, i) => ({ ...x.candidates[0], id: `id${i}`, excerpt: '가'.repeat(4000) }));
  assert.throws(() => buildRequest(x), /input_too_large/);
  // Unicode character count is not JS UTF-16 code-unit count.
  x.candidates = [{ ...x.candidates[0], excerpt: '😀'.repeat(4000) }];
  assert.doesNotThrow(() => buildRequest(x));
});

test('generated instructions count toward 64KiB; nothing is silently shortened', () => {
  const x = input();
  x.candidates = Array.from({ length: 10 }, (_, i) => ({ ...x.candidates[0], id: `id${i}`, excerpt: '가'.repeat(2000) }));
  assert.ok(Buffer.byteLength(JSON.stringify(x)) < LIMITS.bytes);
  assert.throws(() => buildRequest(x), /input_too_large/);
  assert.equal(x.candidates[0].excerpt.length, 2000);
});

test('stable ranking retains all candidates and strips unrelated response text', () => {
  const r = response(); r.secret = 'DO_NOT_RETURN';
  assert.deepEqual(parseResponse(JSON.stringify(r), ['a','b']).rankedIds, ['b','a']);
  r.answers.candidate_0 = answer(3);
  const result = parseResponse(JSON.stringify(r), ['a','b']);
  assert.deepEqual(result.rankedIds, ['a','b']);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETURN/);
});

test('malformed or partial responses fail closed', () => {
  for (const change of [
    r => delete r.answers.candidate_1,
    r => r.answers.extra = answer(2),
    r => r.answers.candidate_0.confidence = 2,
    r => r.answers.candidate_0.score = null,
    r => r.answers.candidate_0.probabilities['2'] = .5,
    r => r.answers.candidate_0.score = 2,
    r => r.usage.input_tokens = -1,
    r => r.model = 'SECRET_OR_RAW_RESPONSE',
  ]) {
    const r = response(); change(r);
    assert.throws(() => parseResponse(JSON.stringify(r), ['a','b']), /invalid_response/);
  }
  assert.throws(() => parseResponse('raw private error', ['a','b']), /invalid_response/);
});

test('approval binds the reviewed request and triggers exactly one invocation', async () => {
  let calls = 0;
  const runner = createRunner(options(async ({ serialized }) => {
    calls++;
    assert.deepEqual(JSON.parse(serialized), buildRequest(input()).request);
    return JSON.stringify(response());
  }));
  const r = await runner.execute(input(), undefined, ctx());
  assert.equal(calls, 1);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.rankedIds, ['b','a']);
});

test('decline, edited preview, no UI, missing key, pre-abort: no invocation', async () => {
  let calls = 0;
  const runner = createRunner(options(async () => { calls++; throw Error('must not run'); }));
  assert.equal((await runner.execute(input(), undefined, ctx(false))).code, 'declined');
  const changed = ctx(); changed.ui.editor = async () => 'changed';
  assert.equal((await runner.execute(input(), undefined, changed)).code, 'preview_changed');
  const cancelledPreview = ctx(); cancelledPreview.ui.editor = async () => undefined;
  assert.equal((await runner.execute(input(), undefined, cancelledPreview)).code, 'declined');
  assert.equal((await runner.execute(input(), undefined, { hasUI: false })).code, 'confirmation_unavailable');
  assert.equal((await runner.execute(input(), AbortSignal.abort(), ctx())).code, 'cancelled');
  const noKey = createRunner({ ...options(() => { calls++; }), env: {} });
  assert.equal((await noKey.execute(input(), undefined, ctx())).code, 'missing_key');
  assert.equal(calls, 0);
});

test('parallel invocation is rejected; shutdown cancels pending approval', async () => {
  let release;
  const context = ctx(); context.ui.editor = () => new Promise(resolve => { release = resolve; });
  let calls = 0;
  const runner = createRunner(options(async () => { calls++; }));
  const first = runner.execute(input(), undefined, context);
  assert.equal((await runner.execute(input(), undefined, ctx())).code, 'busy');
  runner.shutdown(); release('anything');
  assert.equal((await first).code, 'cancelled');
  assert.equal(calls, 0);
});

test('input mutation after preview cannot change the approved request', async () => {
  const x = input();
  const context = ctx();
  context.ui.editor = async (_, preview) => {
    x.candidates[0].excerpt = 'MUTATED';
    return preview;
  };
  const runner = createRunner(options(async ({ serialized }) => {
    assert.doesNotMatch(serialized, /MUTATED/);
    return JSON.stringify(response());
  }));
  assert.equal((await runner.execute(x, undefined, context)).status, 'ok');
});

test('abort during an approved call discards the ranking', async () => {
  const controller = new AbortController();
  const runner = createRunner(options(async () => {
    controller.abort();
    return JSON.stringify(response());
  }));
  const result = await runner.execute(input(), controller.signal, ctx());
  assert.equal(result.code, 'cancelled');
  assert.deepEqual(result.rankedIds, ['a','b']);
});

test('parent abort and shutdown reach the adapter and release the invocation lock', async () => {
  for (const cause of ['parent', 'shutdown']) {
    const controller = new AbortController();
    let started, calls = 0;
    const ready = new Promise(resolve => { started = resolve; });
    const runner = createRunner(options(async ({ signal }) => {
      if (++calls > 1) return JSON.stringify(response());
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        started();
      });
    }));
    const pending = runner.execute(input(), controller.signal, ctx());
    await ready;
    if (cause === 'parent') controller.abort(); else runner.shutdown();
    assert.equal((await pending).code, 'cancelled');
    assert.equal((await runner.execute(input(), undefined, ctx())).status, 'ok');
    assert.equal(calls, 2);
  }
});

test('provider failure preserves order, does not retry or echo exception', async () => {
  let calls = 0;
  const runner = createRunner(options(async () => { calls++; throw Error('SECRET'); }));
  const r = await runner.execute(input(), undefined, ctx());
  assert.equal(r.status, 'not_ranked');
  assert.deepEqual(r.rankedIds, ['a','b']);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(r), /SECRET/);
});

// Real subprocess tests with an offline fixture; no SDK, credentials or network.
const fixture = fileURLToPath(new URL('./fixture.py', import.meta.url));
const python = process.env.JEV_TEST_PYTHON || '/usr/bin/python3';
const invoke = (mode, extra = {}) => runAdapter({ python, adapter: fixture, serialized: JSON.stringify({ mode }), env: { TYPESAFE_API_KEY: 'FAKE_TEST_KEY', UNRELATED_SECRET: 'must_not_inherit' }, ...extra });

test('stdin transport and child environment isolation', async () => {
  const result = JSON.parse(await invoke('inspect'));
  assert.equal(result.stdin_mode, 'inspect');
  assert.equal(result.has_unrelated_secret, false);
  assert.equal(result.has_key, true);
  assert.equal(result.args_contain_key, false);
});

test('timeout and cancellation kill and settle the subprocess', async () => {
  await assert.rejects(invoke('sleep', { timeoutMs: 100 }), /timeout/);
  const controller = new AbortController();
  const pending = invoke('sleep', { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /cancelled/);
});

test('stdout limit, bad executable and exit failure are sanitized', async () => {
  await assert.rejects(invoke('overflow'), /output_too_large/);
  await assert.rejects(invoke('exit'), /adapter_failed/);
  await assert.rejects(invoke('inspect', { python: '/does/not/exist' }), /adapter_failed/);
  assert.equal(LIMITS.timeoutMs, 30000);
});
