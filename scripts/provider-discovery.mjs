// Isolated Pi integration for credential selection; fake HTTP and synthetic keys only.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.PI_OFFLINE, '1');
assert.equal(process.env.TYPESAFE_API_KEY, undefined);
assert.equal(process.env.OPENROUTER_API_KEY, undefined);
const root = fileURLToPath(new URL('../', import.meta.url));
const entry = import.meta.resolve('@earendil-works/pi-coding-agent');
const bundle = new URL('./bundle/index.js', entry);
const { DefaultResourceLoader, SettingsManager } = await import(existsSync(bundle) ? bundle.href : entry);
const temporary = await mkdtemp(join(tmpdir(), 'pi-jev-provider-'));
let requests = 0;
globalThis.fetch = async (url, options) => {
  requests++;
  const direct = url === 'https://api.typesafe.ai/v1/systemone';
  assert.ok(direct || url === 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(options.headers.Authorization, direct ? 'Bearer FAKE_TYPESAFE_KEY' : 'Bearer FAKE_OPENROUTER_KEY');
  const payload = JSON.parse(options.body);
  assert.equal(payload.model, direct ? 'jev-latest' : '~typesafe/jev-latest');
  assert.equal(Object.hasOwn(payload, 'provider'), !direct);
  const answers = Object.fromEntries(Object.entries(payload.questions).map(([id, q]) => {
    if (q.type === 'choice') {
      const choice = id === 'route' ? 'direct' : 'none';
      return [id, { type: 'choice', choice, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, Number(key === choice)])) }];
    }
    if (q.type === 'noul') return [id, { type: 'noul', noul: 0 }];
    return [id, { type: 'score', score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } }];
  }));
  return new Response(JSON.stringify({ model: direct ? 'jev-1.13.0' : 'typesafe/jev-1.13.0', answers,
    usage: { input_tokens: 100, output_tokens: 20 } }));
};
try {
  const loader = new DefaultResourceLoader({ cwd: temporary, agentDir: join(temporary, 'agent'),
    settingsManager: SettingsManager.inMemory({ packages: [root] }),
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getActiveTools = () => [];
  loaded.runtime.getAllTools = () => [];
  loaded.runtime.getCommands = () => [];
  for (const extension of loaded.extensions) {
    const tool = [...extension.tools.values()][0].definition;
    const input = tool.name === 'jev_task_router' ? { task: 'Synthetic public routing example.' } : {
      question: 'Synthetic public ranking example?', candidates: [{ id: 'a', url: 'https://example.com', title: 'Example', excerpt: 'Synthetic.' }] };
    for (const provider of ['openrouter', 'typesafe']) {
      if (provider === 'openrouter') delete process.env.PI_JEV_PROVIDER;
      else process.env.PI_JEV_PROVIDER = provider;
      delete process.env.TYPESAFE_API_KEY;
      let confirmations = 0, authCalls = 0;
      const ctx = { hasUI: true, mode: 'rpc', ui: { confirm: async () => {
        confirmations++;
        // Supply the synthetic direct key only at final approval, not at load time.
        if (confirmations === 2) process.env.TYPESAFE_API_KEY = 'FAKE_TYPESAFE_KEY';
        return true;
      } }, modelRegistry: { getProviderAuth: async name => {
        authCalls++; assert.equal(provider, 'openrouter'); assert.equal(name, 'openrouter'); assert.equal(confirmations, 2);
        return { auth: { apiKey: 'FAKE_OPENROUTER_KEY' } };
      } } };
      const result = (await tool.execute('provider-test', input, undefined, undefined, ctx)).details;
      assert.equal(result.status, 'ok'); assert.equal(result.provider, provider);
      assert.equal(confirmations, 2); assert.equal(authCalls, provider === 'openrouter' ? 1 : 0);
    }
    process.env.PI_JEV_PROVIDER = 'typesafe';
    delete process.env.TYPESAFE_API_KEY;
    const noKeyContext = { hasUI: true, mode: 'rpc', ui: { confirm: async () => true },
      modelRegistry: { getProviderAuth: () => assert.fail('no fallback to OpenRouter auth') } };
    const before = requests;
    assert.equal((await tool.execute('missing-direct-key', input, undefined, undefined, noKeyContext)).details.code, 'missing_key');
    assert.equal(requests, before);
    process.env.PI_JEV_PROVIDER = 'SYNTHETIC_INVALID_SELECTION';
    assert.equal((await tool.execute('invalid-selection', input, undefined, undefined, noKeyContext)).details.code, 'invalid_provider');
    assert.equal(requests, before);
    let status;
    await [...extension.commands.values()][0].handler('', { ...noKeyContext, ui: { notify: value => { status = value; } } });
    assert.match(status, /invalid configuration/); assert.doesNotMatch(status, /SYNTHETIC_INVALID_SELECTION/);
  }
  assert.equal(requests, 4);
  console.log('Provider integration verified: default OpenRouter and explicit TypeSafe, both extensions, fake HTTP only.');
} finally {
  delete process.env.PI_JEV_PROVIDER;
  delete process.env.TYPESAFE_API_KEY;
  await rm(temporary, { recursive: true, force: true });
}
