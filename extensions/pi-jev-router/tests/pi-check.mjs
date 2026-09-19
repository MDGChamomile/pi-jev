// Offline typecheck and Pi extension-load smoke. Reuse existing dependencies; install nothing.
// node tests/pi-check.mjs <pi-coding-agent-package-directory> <typescript-package-directory>
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [piArg, tsArg] = process.argv.slice(2);
if (!piArg || !tsArg) throw new Error('Provide existing pi-coding-agent and typescript package directories.');
const piRoot = resolve(piArg), tsRoot = resolve(tsArg);
const root = fileURLToPath(new URL('../', import.meta.url));
const piRequire = createRequire(resolve(piRoot, 'package.json'));
const ts = (await import(pathToFileURL(resolve(tsRoot, 'lib/typescript.js')).href)).default;
const dependencyRoot = packageName => piRequire.resolve.paths(packageName)
  .map(base => resolve(base, packageName))
  .find(base => existsSync(resolve(base, 'dist/index.d.ts')));
const aiRoot = dependencyRoot('@earendil-works/pi-ai');
const tuiRoot = dependencyRoot('@earendil-works/pi-tui');
assert.ok(aiRoot, 'Existing pi-ai types must be available to Pi.');
assert.ok(tuiRoot, 'Existing pi-tui types must be available to Pi.');
const nodeRoot = dirname(piRequire.resolve('@types/node/package.json'));
const program = ts.createProgram([resolve(root, 'index.ts')], {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  strict: true,
  allowJs: true,
  checkJs: false,
  skipLibCheck: true,
  typeRoots: [dirname(nodeRoot)],
  types: ['node'],
  paths: {
    '@earendil-works/pi-coding-agent': [resolve(piRoot, 'dist/index.d.ts')],
    '@earendil-works/pi-ai': [resolve(aiRoot, 'dist/index.d.ts')],
    '@earendil-works/pi-tui': [resolve(tuiRoot, 'dist/index.d.ts')],
  },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: value => value,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else {
  const bundle = resolve(piRoot, 'dist/bundle/index.js');
  const { DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(
    existsSync(bundle) ? bundle : resolve(piRoot, 'dist/index.js'),
  ).href);
  const temporary = await mkdtemp(resolve(tmpdir(), 'pi-jev-router-check-'));
  try {
    const loader = new DefaultResourceLoader({
      cwd: temporary,
      agentDir: resolve(temporary, 'agent'),
      settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [resolve(root, 'index.ts')],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
    assert.equal(loaded.extensions.length, 1);
    const extension = loaded.extensions[0];
    assert.deepEqual([...extension.tools.keys()], ['jev_route_task']);
    const tool = extension.tools.get('jev_route_task').definition;
    assert.equal(tool.parameters.properties.task.maxLength, 8000);
    const result = await tool.execute('offline-test', {
      task: 'Choose the best route for a bounded public web investigation.',
      constraints: 'Read-only.',
    }, undefined, undefined, { hasUI: false });
    assert.equal(result.details.code, 'confirmation_unavailable');
    const version = JSON.parse(readFileSync(resolve(piRoot, 'package.json'), 'utf8')).version;
    console.log(`Typecheck and offline Pi ${version} extension-load smoke passed.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
