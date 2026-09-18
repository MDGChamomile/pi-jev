// Offline typecheck and Pi extension-load smoke. Reuse existing dependencies; install nothing.
// node tests/pi-check.mjs <pi-coding-agent-package-directory> <typescript-package-directory>
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [piArg, tsArg] = process.argv.slice(2);
if (!piArg || !tsArg) throw new Error('Provide existing pi-coding-agent and typescript package directories.');
const piRoot = resolve(piArg), tsRoot = resolve(tsArg);
const root = fileURLToPath(new URL('../', import.meta.url));
const piRequire = createRequire(resolve(piRoot, 'package.json'));
const ts = (await import(pathToFileURL(resolve(tsRoot, 'lib/typescript.js')).href)).default;
const aiRoot = piRequire.resolve.paths('@earendil-works/pi-ai')
  .map(base => resolve(base, '@earendil-works/pi-ai'))
  .find(base => existsSync(resolve(base, 'dist/index.d.ts')));
assert.ok(aiRoot, 'Existing pi-ai types must be available to Pi.');
const nodeRoot = dirname(piRequire.resolve('@types/node/package.json'));
const program = ts.createProgram([resolve(root, 'index.ts')], {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true, strict: true, allowJs: true, checkJs: false, skipLibCheck: true,
  typeRoots: [dirname(nodeRoot)], types: ['node'],
  paths: {
    '@earendil-works/pi-coding-agent': [resolve(piRoot, 'dist/index.d.ts')],
    '@earendil-works/pi-ai': [resolve(aiRoot, 'dist/index.d.ts')],
  },
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else {
  const { loadExtensions } = await import(pathToFileURL(resolve(piRoot, 'dist/core/extensions/loader.js')).href);
  const loaded = await loadExtensions([resolve(root, 'index.ts')], root);
  assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.deepEqual([...extension.tools.keys()], ['jev_rerank']);
  const tool = extension.tools.get('jev_rerank').definition;
  assert.equal(tool.parameters.properties.candidates.maxItems, 10);
  // Print/JSON contexts cannot approve: this must not start any process or API call.
  const result = await tool.execute('offline-test', {
    question: 'Which passage answers the question?', criteria: 'Direct evidence.',
    candidates: [{ id: 'a', url: 'https://example.com', title: 'Synthetic', excerpt: 'A public example.' }],
  }, undefined, undefined, { hasUI: false });
  assert.equal(result.details.code, 'confirmation_unavailable');
  const version = JSON.parse(readFileSync(resolve(piRoot, 'package.json'), 'utf8')).version;
  console.log(`Typecheck and offline Pi ${version} extension-load smoke passed.`);
}
