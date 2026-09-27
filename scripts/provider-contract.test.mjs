// Shared offline contract tests; runtime copies remain independently installable.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as router from '../extensions/pi-jev-router/core.mjs';
import * as reranker from '../extensions/pi-jev-tools/core.mjs';

const catalog = { tools: [], skills: [] };
const routingInput = { task: 'Answer a synthetic public question directly.' };
const rankingInput = { question: 'What does this synthetic public source say?', candidates: [
  { id: 'a', title: 'Example', url: 'https://example.com/a', excerpt: 'A synthetic public example.' },
] };
function reply(prepared) {
  const answers = Object.fromEntries(Object.entries(prepared.request.questions).map(([id, q]) => {
    if (q.type === 'choice') {
      const choice = id === 'route' ? 'direct' : 'none';
      return [id, { type: 'choice', choice, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, Number(key === choice)])) }];
    }
    if (q.type === 'noul') return [id, { type: 'noul', noul: 0 }];
    return [id, { type: 'score', score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } }];
  }));
  return { model: prepared.provider === 'typesafe' ? 'jev-1.13.0' : 'typesafe/jev-1.13.0',
    answers, usage: { input_tokens: 100, output_tokens: 20 } };
}
const context = (confirm = true) => ({ hasUI: true, ui: { confirm: async () => confirm } });

for (const [name, core, build, parse, execute] of [
  ['router', router, provider => router.buildRequest(routingInput, catalog, provider),
    (raw, p) => router.parseResponse(raw, p), (r, signal, ctx) => r.execute(routingInput, catalog, signal, ctx)],
  ['reranker', reranker, provider => reranker.buildRequest(rankingInput, provider),
    (raw, p) => reranker.parseResponse(raw, p.originalOrder, p.provider), (r, signal, ctx) => r.execute(rankingInput, signal, ctx)],
]) {
  test(`${name}: direct request omits OpenRouter controls but preserves semantic content`, () => {
    const original = build();
    const direct = build('typesafe');
    assert.equal(original.provider, 'openrouter');
    assert.deepEqual(Object.keys(direct.request).sort(), ['model', 'questions', 'state']);
    assert.equal(direct.request.model, 'jev-latest');
    assert.deepEqual(direct.request.state, original.request.state);
    assert.deepEqual(direct.request.questions, original.request.questions);
    assert.deepEqual(original.request.provider, { allow_fallbacks: false, only: ['typesafe'], max_price: { prompt: 0.042, completion: 0 } });
    for (const provider of ['', 'other', '__proto__', 'constructor', 'TypeSafe', null, 1]) {
      assert.throws(() => build(provider), /invalid_provider/);
    }
  });

  test(`${name}: response model validation and result identity are provider-specific`, () => {
    for (const provider of ['openrouter', 'typesafe']) {
      const prepared = build(provider);
      const raw = reply(prepared);
      const result = parse(JSON.stringify(raw), prepared);
      assert.equal(result.status, 'ok');
      assert.equal(result.provider, provider);
      assert.equal(result.requestedModel, prepared.request.model);
      assert.equal(Object.hasOwn(result.usage, 'cost'), false, 'unknown cost is not zero');
      raw.usage.cost = 0.001;
      assert.equal(Object.hasOwn(parse(JSON.stringify(raw), prepared).usage, 'cost'), provider === 'openrouter',
        'only OpenRouter documents a USD usage.cost field');
      for (const model of [provider === 'typesafe' ? 'typesafe/jev-1.13.0' : 'jev-1.13.0', 'unrelated', 'jev-secret\nvalue']) {
        assert.throws(() => parse(JSON.stringify({ ...raw, model }), prepared), /invalid_response/);
      }
    }
  });

  test(`${name}: provider choice is immutable across review, approval, auth, and transport`, async () => {
    let selected = 'typesafe', authCalls = 0, requests = 0, confirmations = 0;
    const prepared = build('typesafe');
    const runner = core.createRunner({
      getProvider: () => selected,
      review: async ({ preview }) => {
        assert.deepEqual(JSON.parse(preview), prepared.request);
        selected = 'openrouter';
        return preview;
      },
      resolveApiKey: async (_ctx, provider) => {
        assert.equal(confirmations, 1); assert.equal(provider, 'typesafe'); authCalls++;
        return 'FAKE_TYPESAFE_KEY';
      },
      run: async args => {
        requests++; assert.equal(args.provider, 'typesafe');
        assert.equal(args.serialized, prepared.serialized);
        return core.runDecision({ ...args, fetchImpl: async (url, options) => {
          assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
          assert.equal(options.headers.Authorization, 'Bearer FAKE_TYPESAFE_KEY');
          assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
          assert.equal(options.body, prepared.serialized);
          return new Response(JSON.stringify(reply(prepared)));
        } });
      },
    });
    const ctx = { hasUI: true, ui: { confirm: async (title, body) => {
      confirmations++; assert.match(title, /TypeSafe direct/);
      assert.match(body, /https:\/\/api.typesafe.ai\/v1\/systemone/);
      assert.match(body, /No enforced per-token price ceiling or hard total-cost cap/);
      assert.match(body, /one paid request/); assert.match(body, /no automatic retries or provider switching/);
      assert.doesNotMatch(body, /FAKE_TYPESAFE_KEY/);
      return true;
    } } };
    const result = await execute(runner, undefined, ctx);
    assert.equal(result.status, 'ok'); assert.equal(result.provider, 'typesafe');
    assert.equal(authCalls, 1); assert.equal(requests, 1);
    assert.doesNotMatch(JSON.stringify(result), /FAKE_TYPESAFE_KEY/);
  });

  test(`${name}: direct declines, edits, unavailable UI, and invalid selection do not resolve credentials`, async () => {
    for (const [provider, review, ctx, code] of [
      ['typesafe', async () => undefined, context(), 'declined'],
      ['typesafe', async ({ preview }) => preview + ' ', context(), 'preview_changed'],
      ['typesafe', async ({ preview }) => preview, context(false), 'declined'],
      ['typesafe', async () => assert.fail('no UI'), { hasUI: false }, 'confirmation_unavailable'],
      ['invalid', async () => assert.fail('invalid provider'), context(), 'invalid_provider'],
    ]) {
      const runner = core.createRunner({ getProvider: () => provider, review,
        resolveApiKey: async () => assert.fail('no auth before approval'), run: async () => assert.fail('no request') });
      const result = await execute(runner, undefined, ctx);
      assert.equal(result.code, code);
      if (name === 'reranker') assert.deepEqual(result.rankedIds, ['a']);
    }
  });

  test(`${name}: missing direct credentials and invalid replies never switch providers`, async () => {
    for (const [key, code] of [[undefined, 'missing_key'], ['FAKE_TYPESAFE_KEY', 'invalid_response']]) {
      let calls = 0;
      const runner = core.createRunner({ getProvider: () => 'typesafe', review: async ({ preview }) => preview,
        resolveApiKey: async (_ctx, provider) => { assert.equal(provider, 'typesafe'); return key; },
        run: async ({ provider }) => { calls++; assert.equal(provider, 'typesafe'); return 'SYNTHETIC_PRIVATE_BODY'; },
      });
      const result = await execute(runner, undefined, context());
      assert.equal(result.code, code); assert.equal(calls, key ? 1 : 0);
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_BODY|FAKE_TYPESAFE_KEY/);
    }
  });

  test(`${name}: direct authentication wait cancels and releases the invocation lock`, async () => {
    let started, resolveAuth;
    const ready = new Promise(resolve => { started = resolve; });
    const runner = core.createRunner({ getProvider: () => 'typesafe', review: async ({ preview }) => preview,
      resolveApiKey: () => { started(); return new Promise(resolve => { resolveAuth = resolve; }); },
      run: async () => assert.fail('late auth cannot send') });
    const pending = execute(runner, undefined, context());
    await ready;
    assert.equal((await execute(runner, undefined, context())).code, 'busy');
    runner.shutdown(); assert.equal((await pending).code, 'cancelled');
    resolveAuth('FAKE_TYPESAFE_KEY'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(runner.getStatus().inFlight, false); assert.equal(runner.getStatus().requestAttempts, 0);
  });

  test(`${name}: direct HTTP failures are bounded, sanitized, single-call and never retried`, async () => {
    const prepared = build('typesafe');
    for (const [status, code] of [[301, 'provider_error'], [400, 'invalid_request'], [401, 'authentication_failed'],
      [402, 'payment_required'], [403, 'request_forbidden'], [422, 'invalid_request'], [429, 'rate_limited'], [529, 'provider_error']]) {
      let calls = 0;
      await assert.rejects(core.runDecision({ provider: 'typesafe', apiKey: 'FAKE_TYPESAFE_KEY', serialized: prepared.serialized,
        fetchImpl: async url => { calls++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
          return new Response('SYNTHETIC_PRIVATE_BODY', { status }); } }), { message: code });
      assert.equal(calls, 1);
    }
    await assert.rejects(core.runDecision({ provider: 'typesafe', apiKey: 'FAKE_TYPESAFE_KEY', serialized: prepared.serialized,
      fetchImpl: async () => new Response('x'.repeat(core.LIMITS.outputBytes + 1)) }), /output_too_large/);
    for (const cancel of [false, true]) {
      const controller = new AbortController();
      await assert.rejects(core.runDecision({ provider: 'typesafe', apiKey: 'FAKE_TYPESAFE_KEY', serialized: prepared.serialized,
        signal: controller.signal, timeoutMs: 10,
        fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('SYNTHETIC_PRIVATE_BODY')), { once: true });
          if (cancel) controller.abort();
        }) }), { message: cancel ? 'cancelled' : 'timeout' });
    }
  });
}
