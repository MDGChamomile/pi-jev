// Offline TypeScript and Pi-load smoke for the independently installable extension.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
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
const dependencyRoot = name => piRequire.resolve.paths(name).map(base => resolve(base, name)).find(base => existsSync(resolve(base, 'dist/index.d.ts')));
async function waitFor(predicate, label, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}
const aiRoot = dependencyRoot('@earendil-works/pi-ai');
assert.ok(aiRoot);
const nodeRoot = dirname(piRequire.resolve('@types/node/package.json'));
const program = ts.createProgram([resolve(root, 'index.ts')], {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, strict: true,
  allowJs: true, checkJs: false, skipLibCheck: true,
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
  const bundle = resolve(piRoot, 'dist/bundle/index.js');
  const { DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(
    existsSync(bundle) ? bundle : resolve(piRoot, 'dist/index.js'),
  ).href);
  const temporary = await mkdtemp(resolve(tmpdir(), 'pi-jev-context-check-'));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const oldProvider = process.env.PI_JEV_PROVIDER;
  try {
    const project = resolve(temporary, 'project');
    await mkdir(project);
    await writeFile(resolve(project, 'private.ts'), 'const marker = "MUST_NOT_READ_WITHOUT_GRANT";\n');
    await writeFile(resolve(project, 'other.ts'), 'const marker = "second marker evidence";\n');
    await writeFile(resolve(project, 'outside.ts'), 'const marker = "OUTSIDE_SYMLINK_SENTINEL";\n');
    await mkdir(resolve(project, 'src'));
    await writeFile(resolve(project, 'src', 'existing.ts'), 'const marker = "find marker in existing source";\n');
    await symlink(resolve(project, 'outside.ts'), resolve(project, 'src', 'escape.ts'));
    await symlink(resolve(project, 'private.ts'), resolve(project, 'private-alias.ts'));
    const agentDir = resolve(temporary, 'agent');
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_JEV_PROVIDER = 'openrouter';
    const loader = new DefaultResourceLoader({
      cwd: project, agentDir, settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [resolve(root, 'index.ts')], noExtensions: true,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
    assert.equal(loaded.extensions.length, 1);
    const extension = loaded.extensions[0];
    assert.deepEqual([...extension.tools.keys()], ['find_context']);
    assert.ok(extension.commands.has('jev-context'));
    const tool = extension.tools.get('find_context').definition;
    assert.deepEqual([...tool.parameters.required].sort(), ['goal', 'paths']);
    assert.equal(tool.parameters.additionalProperties, false);
    let sessionId = 'session-a';
    const context = {
      cwd: project, hasUI: false,
      sessionManager: { getSessionId: () => sessionId },
      modelRegistry: { getProviderAuth: async () => { authCalls++; return authFactory(); } },
    };
    let authCalls = 0, fetchCalls = 0, lastWireBody;
    let resolveAuth;
    let authFactory = async () => ({ auth: { apiKey: 'SYNTHETIC_TEST_KEY' } });
    context.modelRegistry.getProviderAuth = async () => { authCalls++; return authFactory(); };
    await extension.handlers.get('session_start')[0]({ type: 'session_start', reason: 'startup' }, context);
    const result = await tool.execute('offline', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(result.details.status, 'not_enabled');
    assert.equal(authCalls, 0);
    assert.doesNotMatch(JSON.stringify(result), /MUST_NOT_READ_WITHOUT_GRANT/);
    const commandContext = { ...context, hasUI: true, ui: { confirm: async () => true, notify() {} } };
    await extension.commands.get('jev-context').handler('local private.ts', commandContext);
    const localResult = await tool.execute('local', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(localResult.details.status, 'found');
    assert.equal(localResult.details.mode, 'original');
    assert.match(JSON.stringify(localResult), /MUST_NOT_READ_WITHOUT_GRANT/);
    assert.equal(authCalls, 0);
    const command = extension.commands.get('jev-context').handler;
    let consentMessage = '';
    const externalCommand = { ...commandContext, ui: { confirm: async (_title, message) => { consentMessage = message; return true; }, notify() {} } };
    await command('enable private.ts other.ts', externalCommand);
    assert.match(consentMessage, /https:\/\/openrouter\.ai\/api\/alpha\/decisions/);
    assert.match(consentMessage, /~typesafe\/jev-latest/);
    assert.match(consentMessage, /5-second request timeout/);
    assert.match(consentMessage, /\$0\.042 per million tokens/);
    assert.match(consentMessage, /No hard total-cost cap/);
    assert.match(consentMessage, /only for this Pi session/);
    assert.match(consentMessage, /reloads.*discard this grant/);
    assert.match(consentMessage, /\/tree navigation within this session preserves them/);
    const beforeOracleChecks = authCalls;
    const outsideExisting = await tool.execute('outside-existing', { paths: ['outside.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    const outsideMissing = await tool.execute('outside-missing', { paths: ['missing.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    const symlinkAlias = await tool.execute('symlink-alias', { paths: ['private-alias.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(JSON.stringify(outsideExisting.details), JSON.stringify(outsideMissing.details));
    assert.equal(JSON.stringify(outsideExisting.details), JSON.stringify(symlinkAlias.details));
    assert.equal(authCalls, beforeOracleChecks);
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      fetchCalls++;
      assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
      assert.equal(init.headers.Authorization, 'Bearer SYNTHETIC_TEST_KEY');
      lastWireBody = init.body;
      const request = JSON.parse(init.body);
      const answers = Object.fromEntries(request.state.candidates.map((_, index) => [`candidate_${index}`, {
        type: 'score', score: index === 0 ? 1.99 : 2, confidence: 0.9, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 },
      }]));
      return new Response(JSON.stringify({ model: 'typesafe/jev-1.2', answers, usage: { input_tokens: 50, output_tokens: 4, cost: null } }));
    };
    try {
      const ranked = await tool.execute('mocked-provider', { paths: ['private.ts', 'other.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
      assert.equal(ranked.details.status, 'found');
      assert.equal(ranked.details.mode, 'ranked');
      assert.equal(ranked.details.snippets[0].path, 'other.ts');
      assert.deepEqual(ranked.details.usage, { input_tokens: 50, output_tokens: 4 });
      assert.equal(ranked.details.actualCost, 'unknown');
      assert.doesNotMatch(ranked.content[0].text, /\"usage\"/);
      assert.equal(fetchCalls, 1);

      // Parameters mutated during async authentication cannot change the reserved payload.
      await command('enable private.ts other.ts', externalCommand);
      authFactory = () => new Promise(resolve => { resolveAuth = resolve; });
      resolveAuth = undefined;
      const mutableInput = { paths: ['private.ts', 'other.ts'], goal: 'find marker' };
      const mutationPending = tool.execute('mutated-input', mutableInput, new AbortController().signal, undefined, context);
      await waitFor(() => resolveAuth, 'mutation auth resolver');
      mutableInput.goal = 'MUTATED_GOAL_MUST_NOT_BE_SENT';
      mutableInput.paths.splice(0, mutableInput.paths.length, 'other.ts');
      resolveAuth({ auth: { apiKey: 'SYNTHETIC_TEST_KEY' } });
      await mutationPending;
      const wireRequest = JSON.parse(lastWireBody);
      assert.equal(wireRequest.state.goal, 'find marker');
      assert.deepEqual([...new Set(wireRequest.state.candidates.map(candidate => candidate.path))].sort(), ['other.ts', 'private.ts']);
      assert.doesNotMatch(lastWireBody, /MUTATED_GOAL_MUST_NOT_BE_SENT/);
      let quotaStatus = '';
      await command('status', { ...commandContext, ui: { notify: message => { quotaStatus = message; } } });
      const reportedBytes = Number(quotaStatus.match(/requests and (\d+)\/\d+ input bytes/u)?.[1]);
      assert.equal(reportedBytes, Buffer.byteLength(lastWireBody, 'utf8'));
      assert.equal(Number(quotaStatus.match(/(\d+)\/\d+ requests/u)?.[1]), 1);

      authFactory = async () => { throw Object.assign(new Error('PRIVATE_EXCEPTION_TEXT'), { code: 'SYNTHETIC_SECRET_CODE' }); };
      const failedAuth = await tool.execute('unknown-error', { paths: ['private.ts', 'other.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
      assert.match(failedAuth.details.notice, /internal_error/);
      assert.doesNotMatch(JSON.stringify(failedAuth), /SYNTHETIC_SECRET_CODE|PRIVATE_EXCEPTION_TEXT/);

      // Missing siblings do not discard present evidence; an authorized lexical symlink escape is never followed.
      await command('enable src', externalCommand);
      const beforeMissingPathAuth = authCalls;
      const partialScan = await tool.execute('partial-missing', { paths: ['src/existing.ts', 'src/missing.ts', 'src/escape.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
      assert.equal(partialScan.details.status, 'found');
      assert.equal(partialScan.details.mode, 'original');
      assert.equal(partialScan.details.coverage.filesRead, 1);
      assert.equal(partialScan.details.coverage.limited, true);
      assert.deepEqual(partialScan.details.snippets.map(snippet => snippet.path), ['src/existing.ts']);
      assert.doesNotMatch(JSON.stringify(partialScan), /OUTSIDE_SYMLINK_SENTINEL/);
      assert.equal(authCalls, beforeMissingPathAuth);

      // Revocation while authentication is pending aborts the invocation and ignores late credentials.
      await command('enable private.ts other.ts', externalCommand);
      authFactory = () => new Promise(resolve => { resolveAuth = resolve; });
      resolveAuth = undefined;
      const beforeRevokeFetch = fetchCalls;
      const revokedPending = tool.execute('revoke-pending', { paths: ['private.ts', 'other.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
      await waitFor(() => resolveAuth, 'revoke auth resolver');
      await command('disable', commandContext);
      const revokedResult = await revokedPending;
      assert.equal(revokedResult.details.status, 'cancelled');
      assert.deepEqual(revokedResult.details.snippets, []);
      resolveAuth({ auth: { apiKey: 'LATE_KEY_MUST_NOT_BE_USED' } });
      assert.equal(fetchCalls, beforeRevokeFetch);

      await command('enable private.ts other.ts', externalCommand);
      authFactory = () => new Promise(resolve => { resolveAuth = resolve; });
      resolveAuth = undefined;
      const startedAt = Date.now();
      const timeoutPending = tool.execute('auth-timeout', { paths: ['private.ts', 'other.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
      const timeoutResult = await timeoutPending;
      assert.equal(timeoutResult.details.status, 'found');
      assert.equal(timeoutResult.details.mode, 'original');
      assert.match(timeoutResult.details.notice, /Local-only fallback \(timeout\)/);
      assert.ok(Date.now() - startedAt < 6500);
      assert.ok(timeoutResult.details.snippets.length > 0);
    } finally { globalThis.fetch = oldFetch; }
    const authCallsBeforeSessionLifecycle = authCalls;
    const projectAlias = resolve(temporary, 'project-alias');
    await symlink(project, projectAlias);
    const notifications = [];
    const aliasCommandContext = { ...commandContext, cwd: projectAlias, ui: { ...commandContext.ui, notify: message => notifications.push(message) } };
    await command('status', aliasCommandContext);
    assert.match(notifications.at(-1), /enabled for this session/);

    // A late positive confirmation from the old session cannot install a grant in its replacement.
    let resolveLateConfirm;
    const pendingEnable = command('enable private.ts', { ...commandContext, ui: { confirm: () => new Promise(resolve => { resolveLateConfirm = resolve; }), notify() {} } });
    await waitFor(() => resolveLateConfirm, 'consent confirmation');
    await extension.handlers.get('session_before_switch')[0]({ type: 'session_before_switch', reason: 'resume' }, context);
    sessionId = 'session-b';
    await extension.handlers.get('session_start')[0]({ type: 'session_start', reason: 'resume' }, context);
    resolveLateConfirm(true);
    await pendingEnable;
    const afterSwitch = await tool.execute('new-session', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(afterSwitch.details.status, 'not_enabled');
    assert.equal(authCalls, authCallsBeforeSessionLifecycle);

    // Fork invalidates approvals; successful startup of another session begins empty.
    await command('local private.ts', commandContext);
    const localAfterSwitch = await tool.execute('local-new-session', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(localAfterSwitch.details.status, 'found');
    await extension.handlers.get('session_before_fork')[0]({ type: 'session_before_fork', entryId: 'entry-id', position: 'at' }, context);
    const afterForkGate = await tool.execute('after-fork-gate', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(afterForkGate.details.status, 'not_enabled');
    sessionId = 'session-c';
    await extension.handlers.get('session_start')[0]({ type: 'session_start', reason: 'fork', previousSessionFile: '/synthetic/old-session.jsonl' }, context);
    const forked = await tool.execute('forked-session', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(forked.details.status, 'not_enabled');

    await command('enable private.ts other.ts', externalCommand);
    authFactory = () => new Promise(resolve => { resolveAuth = resolve; });
    resolveAuth = undefined;
    const beforeShutdownFetch = fetchCalls;
    const beforeShutdownAuth = authCalls;
    const shutdownPending = tool.execute('shutdown-pending', { paths: ['private.ts', 'other.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    await waitFor(() => resolveAuth, 'shutdown auth resolver');
    await extension.handlers.get('session_shutdown')[0]({ type: 'session_shutdown', reason: 'quit' }, context);
    const shutdown = await shutdownPending;
    assert.equal(shutdown.details.status, 'cancelled');
    assert.deepEqual(shutdown.details.snippets, []);
    resolveAuth({ auth: { apiKey: 'LATE_SHUTDOWN_KEY' } });
    assert.equal(fetchCalls, beforeShutdownFetch);
    const staleAfterShutdown = await tool.execute('shutdown-session', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, context);
    assert.equal(staleAfterShutdown.details.status, 'not_enabled');
    assert.equal(authCalls, beforeShutdownAuth + 1);

    // A freshly loaded extension instance has an empty runtime store, even for the same project/session id.
    const secondLoader = new DefaultResourceLoader({
      cwd: project, agentDir, settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [resolve(root, 'index.ts')], noExtensions: true,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await secondLoader.reload();
    const replacement = secondLoader.getExtensions().extensions[0];
    const replacementContext = { ...context, sessionManager: { getSessionId: () => 'session-c' } };
    await replacement.handlers.get('session_start')[0]({ type: 'session_start', reason: 'startup' }, replacementContext);
    const replacementTool = replacement.tools.get('find_context').definition;
    const restarted = await replacementTool.execute('restart', { paths: ['private.ts'], goal: 'find marker' }, new AbortController().signal, undefined, replacementContext);
    assert.equal(restarted.details.status, 'not_enabled');
    const version = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(piRoot, 'package.json'), 'utf8')).version;
    console.log(`Typecheck and offline Pi ${version} context extension-load smoke passed.`);
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    if (oldProvider === undefined) delete process.env.PI_JEV_PROVIDER;
    else process.env.PI_JEV_PROVIDER = oldProvider;
    await rm(temporary, { recursive: true, force: true });
  }
}
