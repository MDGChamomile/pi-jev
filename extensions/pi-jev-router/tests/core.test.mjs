import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, createRunner, ENDPOINT, isJevWorkflowSkill, parseResponse, runDecision, LIMITS } from '../core.mjs';

const input = () => ({ task: 'Determine whether this request requires both web and local investigation.', constraints: 'Read-only investigation; do not modify files.' });
const catalog = () => ({
  tools: [
    { name: 'read', description: 'Read local files.' },
    { name: 'web_search', description: 'Search public web sources.' },
  ],
  skills: [
    { name: 'pi-subagent', description: 'Run one bounded local or web investigation.' },
    { name: 'security-audit', description: 'Review source defensively.' },
  ],
});
const choice = (selected, options, confidence = 1) => ({
  type: 'choice', choice: selected, confidence,
  probabilities: Object.fromEntries(options.map(option => [option, Number(option === selected)])),
});
const response = () => ({
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    route: choice('web_subagent', ['direct', 'local_subagent', 'web_subagent', 'browser_interaction', 'specialist_skill', 'clarify_with_user', 'no_match']),
    subagent_preset: choice('analysis_standard', ['lookup_standard', 'analysis_standard', 'review_standard', 'not_applicable']),
    primary_tool: choice('tool_1', ['none', 'tool_0', 'tool_1']),
    specialist_skill: choice('skill_0', ['none', 'skill_0', 'skill_1']),
    parallel_investigation: { type: 'noul', noul: 0.72 },
  },
  usage: { input_tokens: 120, output_tokens: 30 },
});
const ctx = (confirm = true) => ({ hasUI: true, ui: { editor: async (_title, value) => value, confirm: async () => confirm } });
const options = run => ({ resolveApiKey: async () => 'FAKE_TEST_KEY', run });

test('shared and legacy Jev workflow skills are excluded from routing candidates', () => {
  for (const name of ['pi-jev', 'pi-jev:2', 'pi-jev-router', 'pi-jev-router:2']) {
    assert.equal(isJevWorkflowSkill(name), true, name);
  }
  for (const name of ['pi-subagent', 'pi-jev-tools', 'pi-jev-router-extra']) {
    assert.equal(isJevWorkflowSkill(name), false, name);
  }
});

test('request preserves the English task and builds fixed plus runtime-bounded questions', () => {
  const built = buildRequest(input(), catalog());
  assert.equal(built.request.state.task, input().task);
  assert.equal(built.request.model, 'typesafe/jev-1.13');
  assert.deepEqual(built.request.provider, { allow_fallbacks: false, only: ['typesafe'], max_price: { prompt: 0.042, completion: 0 } });
  assert.equal(built.request.questions.route.type, 'choice');
  assert.deepEqual(Object.keys(built.request.questions.primary_tool.criteria), ['none', 'tool_0', 'tool_1']);
  assert.equal(built.request.questions.primary_tool.criteria.tool_1.name, 'web_search');
  assert.equal(built.request.questions.parallel_investigation.type, 'noul');
  assert.doesNotMatch(JSON.stringify(built.request.questions), /[가-힣]/, 'all generated Jev instructions and criteria stay in English');
  assert.deepEqual(JSON.parse(built.serialized), built.request);
});

test('omitted constraints become an explicit neutral state value', () => {
  const built = buildRequest({ task: 'Route this task.' }, { tools: [], skills: [] });
  assert.equal(built.request.state.constraints, 'No additional constraints were supplied.');
  assert.deepEqual(Object.keys(built.request.questions.primary_tool.criteria), ['none']);
  assert.deepEqual(Object.keys(built.request.questions.specialist_skill.criteria), ['none']);
});

test('input and runtime catalog limits fail closed without truncation', () => {
  const cases = [
    [() => ({ ...input(), task: 'x'.repeat(LIMITS.taskChars + 1) }), catalog],
    [() => ({ ...input(), extra: 'unexpected' }), catalog],
    [input, () => ({ ...catalog(), tools: Array.from({ length: LIMITS.candidatesPerKind + 1 }, (_, i) => ({ name: `t${i}`, description: 'x' })) })],
    [input, () => ({ tools: [{ name: 'same', description: 'a' }, { name: 'same', description: 'b' }], skills: [] })],
    [input, () => ({ tools: [{ name: 'bad\u001b', description: 'x' }], skills: [] })],
  ];
  for (const [makeInput, makeCatalog] of cases) assert.throws(() => buildRequest(makeInput(), makeCatalog()));
  const huge = catalog();
  huge.tools = Array.from({ length: LIMITS.candidatesPerKind }, (_, i) => ({ name: `tool_${i}`, description: '가'.repeat(1000) }));
  assert.throws(() => buildRequest(input(), huge), /input_too_large/);
  assert.equal(huge.tools[0].description.length, 1000);
});

test('response maps opaque options back to runtime names and retains distributions', () => {
  const prepared = buildRequest(input(), catalog());
  const result = parseResponse(JSON.stringify(response()), prepared);
  assert.equal(result.route.choice, 'web_subagent');
  assert.equal(result.subagentPreset.name, 'analysis-standard');
  assert.equal(result.primaryTool.name, 'web_search');
  assert.equal(result.specialistSkill.name, 'pi-subagent');
  assert.equal(result.parallelInvestigationProbability, 0.72);
  assert.equal(result.primaryTool.probabilities.find(item => item.name === 'read').probability, 0);
});

test('malformed, inconsistent, partial, or extra responses fail closed', () => {
  const prepared = buildRequest(input(), catalog());
  const changes = [
    r => delete r.answers.route,
    r => { r.answers.extra = { type: 'noul', noul: 0 }; },
    r => { r.answers.route.choice = 'unknown'; },
    r => { r.answers.route.confidence = 2; },
    r => { r.answers.route.probabilities.direct = 0.6; },
    r => { r.answers.route.choice = 'direct'; },
    r => { r.answers.parallel_investigation.noul = NaN; },
    r => { r.usage.input_tokens = -1; },
    r => { r.model = 'RAW_OR_SECRET'; },
    r => { r.model = 'typesafe/jev-2.0'; },
  ];
  for (const change of changes) {
    const value = response(); change(value);
    assert.throws(() => parseResponse(JSON.stringify(value), prepared), /invalid_response/);
  }
  assert.throws(() => parseResponse('private raw body', prepared), /invalid_response/);
});

test('full immutable review and confirmation permit exactly one invocation', async () => {
  let calls = 0;
  const runner = createRunner(options(async ({ serialized }) => {
    calls++;
    assert.deepEqual(JSON.parse(serialized), buildRequest(input(), catalog()).request);
    return JSON.stringify(response());
  }));
  const result = await runner.execute(input(), catalog(), undefined, ctx());
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
});

test('approval UI discloses payload categories, provider, cost boundary, and limitations', async () => {
  const context = ctx();
  const prompts = [];
  context.ui.editor = async (title, preview) => {
    assert.equal(title, 'Review Jev routing payload. Submit unchanged to continue.');
    assert.deepEqual(JSON.parse(preview), buildRequest(input(), catalog()).request);
    prompts.push('review');
    return preview;
  };
  context.ui.confirm = async (title, message) => {
    assert.equal(title, 'Send task routing data to TypeSafe Jev through OpenRouter?');
    for (const disclosure of [
      'reviewed task, constraints', '2 tool / 2 skill metadata entries', ENDPOINT,
      'OpenRouter / typesafe/jev-1.13', 'one paid request', 'US$0.001344', 'no automatic retries', '30-second timeout',
      'secrets, credentials, session history, private file contents, authenticated-page content',
      'cannot authorize actions', 'cannot undo a request or charges already incurred',
    ]) assert.ok(message.includes(disclosure), disclosure);
    prompts.push('approval');
    return true;
  };
  const runner = createRunner(options(async () => {
    assert.deepEqual(prompts, ['review', 'approval']);
    return JSON.stringify(response());
  }));
  assert.equal((await runner.execute(input(), catalog(), undefined, context)).status, 'ok');
});

test('decline, edited preview, no UI, missing key, and pre-abort never invoke provider', async () => {
  let calls = 0;
  const runner = createRunner(options(async () => { calls++; throw new Error('must not run'); }));
  assert.equal((await runner.execute(input(), catalog(), undefined, ctx(false))).code, 'declined');
  const changed = ctx(); changed.ui.editor = async () => 'changed';
  assert.equal((await runner.execute(input(), catalog(), undefined, changed)).code, 'preview_changed');
  const cancelled = ctx(); cancelled.ui.editor = async () => undefined;
  assert.equal((await runner.execute(input(), catalog(), undefined, cancelled)).code, 'declined');
  assert.equal((await runner.execute(input(), catalog(), undefined, { hasUI: false })).code, 'confirmation_unavailable');
  assert.equal((await runner.execute(input(), catalog(), AbortSignal.abort(), ctx())).code, 'cancelled');
  const noKey = createRunner({ ...options(() => { calls++; }), resolveApiKey: async () => undefined });
  assert.equal((await noKey.execute(input(), catalog(), undefined, ctx())).code, 'missing_key');
  const authFailure = createRunner({ ...options(() => { calls++; }), resolveApiKey: async () => { throw new Error('PRIVATE'); } });
  assert.equal((await authFailure.execute(input(), catalog(), undefined, ctx())).code, 'authentication_failed');
  assert.equal(calls, 0);
});

test('parallel calls are rejected and shutdown cancels pending approval', async () => {
  let release;
  const context = ctx(); context.ui.editor = () => new Promise(resolve => { release = resolve; });
  let calls = 0;
  const runner = createRunner(options(async () => { calls++; }));
  const first = runner.execute(input(), catalog(), undefined, context);
  assert.equal((await runner.execute(input(), catalog(), undefined, ctx())).code, 'busy');
  runner.shutdown(); release('unchanged');
  assert.equal((await first).code, 'cancelled');
  assert.equal(calls, 0);
});

test('mutating inputs after review cannot change the approved request', async () => {
  const task = input(), candidates = catalog();
  const context = ctx();
  context.ui.editor = async (_title, preview) => {
    task.task = 'MUTATED';
    candidates.tools[0].description = 'MUTATED';
    return preview;
  };
  const runner = createRunner(options(async ({ serialized }) => {
    assert.doesNotMatch(serialized, /MUTATED/);
    return JSON.stringify(response());
  }));
  assert.equal((await runner.execute(task, candidates, undefined, context)).status, 'ok');
});

test('review escapes invisible format controls while preserving the exact approved text', async () => {
  const task = input();
  task.task = 'route\u202ethis';
  const context = ctx();
  context.ui.editor = async (_title, preview) => {
    assert.ok(preview.includes('route\\u202ethis'));
    assert.equal(JSON.parse(preview).state.task, task.task);
    return preview;
  };
  const runner = createRunner(options(async ({ serialized }) => {
    assert.equal(JSON.parse(serialized).state.task, task.task);
    return JSON.stringify(response());
  }));
  assert.equal((await runner.execute(task, catalog(), undefined, context)).status, 'ok');
});

test('provider failure is sanitized, not retried, and does not produce a route', async () => {
  let calls = 0;
  const runner = createRunner(options(async () => { calls++; throw new Error('PRIVATE'); }));
  const result = await runner.execute(input(), catalog(), undefined, ctx());
  assert.equal(result.status, 'not_routed');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
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
    apiKey: 'FAKE_TEST_KEY', serialized: buildRequest(input(), catalog()).serialized,
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
