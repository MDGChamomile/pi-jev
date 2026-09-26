// Exercise source-copy installations, not an npm/Git package installation.
// Launched by check-pi.mjs with an isolated HOME and PI_OFFLINE=1.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.PI_OFFLINE, '1');
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('offline_network_forbidden'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const sdkEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
const bundle = new URL('./bundle/index.js', sdkEntry);
const { DefaultResourceLoader, SettingsManager } = await import(
  existsSync(bundle) ? bundle.href : sdkEntry
);
const cases = [
  [['pi-jev-router'], ['jev_task_router']],
  [['pi-jev-tools'], ['jev_rerank']],
  [['pi-jev-router', 'pi-jev-tools'], ['jev_rerank', 'jev_task_router']],
];
for (const [extensions, expectedTools] of cases) {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-jev-copy-'));
  try {
    const agentDir = join(temporary, 'agent');
    for (const extension of extensions) {
      await cp(join(root, 'extensions', extension), join(agentDir, 'extensions', extension), { recursive: true });
    }
    const skillDirectory = join(agentDir, 'skills/pi-jev');
    await cp(join(root, 'skills/pi-jev'), skillDirectory, { recursive: true });
    const readme = await readFile(join(skillDirectory, 'README.md'), 'utf8');
    assert.equal(existsSync(join(agentDir, 'MIGRATION.md')), false);
    assert.match(readme, /\[migration guide\]\(https:\/\/github\.com\/MDGChamomile\/pi-jev\/blob\/main\/MIGRATION\.md\)/,
      'copied README must link to migration guidance outside the source checkout');
    const loader = new DefaultResourceLoader({
      cwd: temporary,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      // Discover exactly the copied global layout under this isolated agent directory.
      noExtensions: false,
      noSkills: false,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, extensions.length);
    assert.deepEqual(loaded.extensions.flatMap(extension => [...extension.tools.keys()]).sort(), expectedTools);
    // Commands are independent, non-model tools and must not collide when both load.
    const expectedCommands = extensions.map(name => name === 'pi-jev-router' ? 'jev-router-status' : 'jev-rerank-status').sort();
    assert.deepEqual(loaded.extensions.flatMap(extension => [...extension.commands.keys()]).sort(), expectedCommands);
    let activeTools = expectedTools;
    loaded.runtime.getActiveTools = () => activeTools;
    for (const extension of loaded.extensions) {
      const command = [...extension.commands.values()][0];
      let message;
      const context = { hasUI: true, ui: { notify: text => { message = text; } },
        modelRegistry: { getProviderAuth: () => assert.fail('status must not resolve authentication') },
      };
      await command.handler('', { hasUI: false });
      await command.handler('', context);
      assert.match(message, /tool active/);
      assert.match(message, /Calls since session start\/reload: 0/);
      assert.match(message, /no \(unverified\)/);
      const tool = [...extension.tools.values()][0].definition;
      await tool.execute('offline-status-test', {}, undefined, undefined, { hasUI: false });
      await command.handler('', context);
      assert.match(message, /Calls since session start\/reload: 1/);
      assert.match(message, /Approved request attempts: 0/);
      assert.match(message, /last completed result: invalid_input/);
      activeTools = [];
      await command.handler('', context);
      assert.match(message, /tool inactive/);
      activeTools = expectedTools;
      for (const reason of ['new', 'resume', 'fork', 'reload']) {
        for (const handler of extension.handlers.get('session_start') ?? []) await handler({ type: 'session_start', reason }, context);
        await command.handler('', context);
        assert.match(message, /Calls since session start\/reload: 0/);
        assert.match(message, /last completed result: none/);
      }
      // A late authentication result from an abandoned session cannot update new counters or send.
      loaded.runtime.getAllTools = () => [];
      loaded.runtime.getCommands = () => [];
      let authStarted, resolveAuth;
      const started = new Promise(resolve => { authStarted = resolve; });
      const pendingContext = { hasUI: true, mode: 'rpc', ui: { confirm: async () => true },
        modelRegistry: { getProviderAuth: () => { authStarted(); return new Promise(resolve => { resolveAuth = resolve; }); } },
      };
      const params = tool.name === 'jev_task_router' ? { task: 'Synthetic status test.' } : {
        question: 'Synthetic status test?',
        candidates: [{ id: 'a', title: 'Synthetic', url: 'https://example.com', excerpt: 'Synthetic example.' }],
      };
      const pending = tool.execute('offline-pending-test', params, undefined, undefined, pendingContext);
      await started;
      for (const handler of extension.handlers.get('session_start') ?? []) await handler({ type: 'session_start', reason: 'new' }, context);
      assert.equal((await pending).details.code, 'cancelled');
      resolveAuth({ auth: { apiKey: 'FAKE_TEST_KEY' } });
      await new Promise(resolve => setImmediate(resolve));
      await command.handler('', context);
      assert.match(message, /Calls since session start\/reload: 0/);
      assert.match(message, /Approved request attempts: 0/);
      assert.match(message, /last completed result: none/);
      assert.equal(networkAttempts, 0);
    }
    const { skills, diagnostics } = loader.getSkills();
    assert.deepEqual(diagnostics, []);
    assert.equal(skills.length, 1, 'expected exactly one shared skill');
    assert.equal(skills[0].name, 'pi-jev');
    assert.equal(resolve(skills[0].filePath), join(skillDirectory, 'SKILL.md'));
    console.log(`Copied installation verified: ${extensions.join(' + ')} and one shared skill.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
