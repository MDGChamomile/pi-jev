// Verify the root Pi manifest without installing into the active agent environment.
// Launched by check-pi.mjs with isolated HOME and PI_OFFLINE=1; no provider calls.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.PI_OFFLINE, '1');
const root = fileURLToPath(new URL('../', import.meta.url));
const sdkEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
const bundle = new URL('./bundle/index.js', sdkEntry);
const { DefaultResourceLoader, SettingsManager } = await import(
  existsSync(bundle) ? bundle.href : sdkEntry
);
const cases = [
  [root, ['jev_rerank', 'jev_task_router'], 1],
  [{ source: root, extensions: ['extensions/pi-jev-router/index.ts'] }, ['jev_task_router'], 1],
  [{ source: root, extensions: ['extensions/pi-jev-tools/index.ts'] }, ['jev_rerank'], 1],
  [{ source: root, extensions: [] }, [], 1],
  [{ source: root, skills: [] }, ['jev_rerank', 'jev_task_router'], 0],
];
for (const [source, expectedTools, expectedSkills] of cases) {
  const temporary = await mkdtemp(join(tmpdir(), 'pi-jev-package-'));
  try {
    const loader = new DefaultResourceLoader({
      cwd: temporary,
      agentDir: join(temporary, 'agent'),
      settingsManager: SettingsManager.inMemory({ packages: [source] }),
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, expectedTools.length);
    assert.deepEqual(loaded.extensions.flatMap(extension => [...extension.tools.keys()]).sort(), expectedTools);
    const { skills, diagnostics } = loader.getSkills();
    assert.deepEqual(diagnostics, []);
    assert.equal(skills.length, expectedSkills);
    if (expectedSkills) {
      assert.equal(skills[0].name, 'pi-jev');
      assert.equal(resolve(skills[0].filePath), join(root, 'skills/pi-jev/SKILL.md'));
    }
    console.log(`Package discovery verified: ${expectedTools.join(' + ') || 'skill only'}; skills=${expectedSkills}.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
