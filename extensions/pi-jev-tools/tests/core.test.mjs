import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, createRunner, ENDPOINT, parseResponse, runDecision, LIMITS } from '../core.mjs';

const input = () => ({ question: 'Was the cancellation completed?', criteria: 'Distinguish approval from completed execution.', candidates: [
  { id: 'a', url: 'https://example.com/a', title: 'Plan', excerpt: '다음 달 소각하기로 결의했다.' },
  { id: 'b', url: 'https://example.org/b', title: 'Execution', excerpt: '소각을 완료했다.' },
] });
const answer = (level) => ({ type: 'score', score: level, confidence: 1, probabilities: Object.fromEntries([0,1,2,3].map(i => [String(i), Number(i === level)])) });
const response = () => ({ model: 'typesafe/jev-1.13-20260917', answers: { candidate_0: answer(1), candidate_1: answer(3) }, usage: { input_tokens: 100, output_tokens: 20, cost: 0.0000042 } });
const ctx = (confirm = true) => ({ hasUI: true, ui: { editor: async (_, value) => value, confirm: async () => confirm } });
const options = (run) => ({ resolveApiKey: async () => 'FAKE_TEST_KEY', run });

test('request preserves Korean text; uses shared concrete English levels and explicit candidate paths', () => {
  const built = buildRequest(input());
  assert.equal(built.request.state.candidates[0].excerpt, input().candidates[0].excerpt);
  assert.equal(built.request.model, 'typesafe/jev-1.13');
  assert.deepEqual(built.request.provider, { allow_fallbacks: false, only: ['typesafe'], max_price: { prompt: 0.042, completion: 0 } });
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
    r => r.model = 'typesafe/jev-2.0',
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

test('English review and approval UI retain disclosure and safety boundaries', async () => {
  const context = ctx();
  const prompts = [];
  context.ui.editor = async (title, preview) => {
    assert.equal(title, 'Review Jev payload — public sources only. Submit unchanged to continue.');
    prompts.push('review');
    return preview;
  };
  context.ui.confirm = async (title, message) => {
    assert.equal(title, 'Send to TypeSafe Jev through OpenRouter?');
    for (const disclosure of [
      'reviewed question, criteria, and 2 candidates', ENDPOINT,
      'OpenRouter / typesafe/jev-1.13', 'one paid request', 'US$0.001344',
      'no automatic retries', '30-second timeout', 'Public web sources only',
      'sessions, internal data, authenticated pages, or secrets',
      'Cancelling cannot undo a request or charges already incurred',
    ]) assert.ok(message.includes(disclosure), disclosure);
    assert.doesNotMatch(title + message, /[가-힣]/);
    prompts.push('approval');
    return true;
  };
  const runner = createRunner(options(async () => {
    assert.deepEqual(prompts, ['review', 'approval']);
    return JSON.stringify(response());
  }));
  assert.equal((await runner.execute(input(), undefined, context)).status, 'ok');
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
  const noKey = createRunner({ ...options(() => { calls++; }), resolveApiKey: async () => undefined });
  assert.equal((await noKey.execute(input(), undefined, ctx())).code, 'missing_key');
  const authFailure = createRunner({ ...options(() => { calls++; }), resolveApiKey: async () => { throw new Error('PRIVATE'); } });
  assert.equal((await authFailure.execute(input(), undefined, ctx())).code, 'authentication_failed');
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

test('review escapes invisible format controls while preserving the exact approved text', async () => {
  const x = input();
  x.candidates[0].excerpt = 'public\u202etext';
  const context = ctx();
  context.ui.editor = async (_title, preview) => {
    assert.ok(preview.includes('public\\u202etext'));
    assert.equal(JSON.parse(preview).state.candidates[0].excerpt, x.candidates[0].excerpt);
    return preview;
  };
  const runner = createRunner(options(async ({ serialized }) => {
    assert.equal(JSON.parse(serialized).state.candidates[0].excerpt, x.candidates[0].excerpt);
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

test('parent abort and shutdown reach the provider call and release the invocation lock', async () => {
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

const fetchResponse = (body, status = 200) => async (url, init) => {
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer FAKE_TEST_KEY');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.redirect, 'error');
  return new Response(body, { status });
};

test('OpenRouter transport sends one bounded authenticated request', async () => {
  let calls = 0;
  const raw = await runDecision({
    apiKey: 'FAKE_TEST_KEY', serialized: buildRequest(input()).serialized,
    fetchImpl: async (...args) => { calls++; return fetchResponse(JSON.stringify(response()))(...args); },
  });
  assert.equal(calls, 1);
  assert.equal(JSON.parse(raw).model, response().model);
  await assert.rejects(runDecision({
    apiKey: 'FAKE_TEST_KEY', serialized: '{}', fetchImpl: fetchResponse('x'.repeat(LIMITS.outputBytes + 1)),
  }), /output_too_large/);
});

test('OpenRouter transport maps status, timeout, cancellation, and network failures', async () => {
  for (const [status, code] of [[401, 'authentication_failed'], [429, 'rate_limited'], [400, 'invalid_request'], [500, 'provider_error']]) {
    await assert.rejects(runDecision({ apiKey: 'FAKE_TEST_KEY', serialized: '{}', fetchImpl: fetchResponse('PRIVATE', status) }), new RegExp(code));
  }
  const hanging = async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('PRIVATE')), { once: true }));
  await assert.rejects(runDecision({ apiKey: 'FAKE_TEST_KEY', serialized: '{}', timeoutMs: 10, fetchImpl: hanging }), /timeout/);
  const controller = new AbortController();
  const pending = runDecision({ apiKey: 'FAKE_TEST_KEY', serialized: '{}', signal: controller.signal, fetchImpl: hanging });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(runDecision({ apiKey: 'FAKE_TEST_KEY', serialized: '{}', fetchImpl: async () => { throw new Error('PRIVATE'); } }), /provider_error/);
});
