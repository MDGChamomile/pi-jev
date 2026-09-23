// Exercise source-copy installations, not an npm/Git package installation.
// Launched by check-pi.mjs with an isolated HOME and PI_OFFLINE=1.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  [['pi-jev-router'], ['jev_route_task']],
  [['pi-jev-tools'], ['jev_rerank']],
  [['pi-jev-router', 'pi-jev-tools'], ['jev_rerank', 'jev_route_task']],
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
