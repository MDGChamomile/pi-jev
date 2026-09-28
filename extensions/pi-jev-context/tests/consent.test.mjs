import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConsentStore, parsePaths } from '../consent.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'jev-context-consent-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, 'project');
  const sessionToken = {};
  const store = createConsentStore({ sessionToken });
  store.activate('session-a');
  return { home, root, sessionToken, store };
}

test('session grant and cumulative quota are shared by store facades; explicit renewal alone resets quota', async t => {
  const f = await fixture(t);
  const grant = f.store.set({ root: f.root, paths: ['src'], provider: 'openrouter', maxRequests: 2, maxInputBytes: 100 });
  const sameSession = createConsentStore({ sessionToken: f.sessionToken });
  assert.equal(sameSession.status({ root: f.root }).id, grant.id);
  sameSession.reserve({ root: f.root, id: grant.id, bytes: 40 });
  assert.equal(f.store.status({ root: f.root }).requestsUsed, 1);
  assert.equal(f.store.status({ root: f.root }).bytesUsed, 40);
  assert.throws(() => f.store.reserve({ root: f.root, id: grant.id, bytes: 61 }), { code: 'budget_exhausted' });
  const renewed = sameSession.set({ root: f.root, paths: ['docs'], provider: 'typesafe', maxRequests: 1, maxInputBytes: 50 });
  assert.notEqual(renewed.id, grant.id);
  assert.equal(f.store.status({ root: f.root }).provider, 'typesafe');
  assert.equal(f.store.status({ root: f.root }).requestsUsed, 0);
});

test('separate runtime, session transition, revoke, and shutdown cannot reuse a grant', async t => {
  const f = await fixture(t);
  const grant = f.store.set({ root: f.root, paths: ['src'], provider: 'typesafe' });
  const newRuntime = createConsentStore({ sessionToken: {} });
  newRuntime.activate('session-a');
  assert.equal(newRuntime.status({ root: f.root }), null);

  f.store.clear(); // before-switch/fork invalidation; the same session can explicitly grant again.
  assert.equal(f.store.status({ root: f.root }), null);
  const afterTransition = f.store.set({ root: f.root, paths: ['src'], provider: 'local', mode: 'local' });
  assert.notEqual(afterTransition.id, grant.id);
  assert.equal(f.store.revoke({ root: f.root }), true);
  assert.equal(newRuntime.status({ root: f.root }), null);

  const endingRuntime = createConsentStore({ sessionToken: {} });
  endingRuntime.activate('session-b');
  endingRuntime.set({ root: f.root, paths: ['src'], provider: 'openrouter' });
  endingRuntime.invalidate();
  assert.equal(endingRuntime.status({ root: f.root }), null);
  assert.throws(() => endingRuntime.set({ root: f.root, paths: ['src'], provider: 'openrouter' }), { code: 'session_unavailable' });
});

test('session grants are isolated by canonical project root and never touch legacy files', async t => {
  const f = await fixture(t);
  const legacyDir = join(f.home, '.pi', 'agent', 'jev-context', 'old-project');
  const legacyPath = join(legacyDir, 'grant.json');
  await (await import('node:fs/promises')).mkdir(legacyDir, { recursive: true });
  const legacyContent = JSON.stringify({ version: 1, id: 'OLD_PERSISTED_GRANT', deadline: Date.now() + 7 * 86400000 });
  await writeFile(legacyPath, legacyContent);

  f.store.set({ root: f.root, paths: ['src'], provider: 'openrouter' });
  assert.equal(f.store.status({ root: join(f.root, '..', 'other-project') }), null);
  const anotherRuntime = createConsentStore({ sessionToken: {} });
  anotherRuntime.activate('new-session');
  assert.equal(anotherRuntime.status({ root: f.root }), null);
  assert.equal(await readFile(legacyPath, 'utf8'), legacyContent);
});

test('synchronous reserve cannot exceed budget across same-session facades', async t => {
  const f = await fixture(t);
  const grant = f.store.set({ root: f.root, paths: ['src'], provider: 'openrouter', maxRequests: 1, maxInputBytes: 100 });
  const otherFacade = createConsentStore({ sessionToken: f.sessionToken });
  const results = [
    () => f.store.reserve({ root: f.root, id: grant.id, bytes: 30 }),
    () => otherFacade.reserve({ root: f.root, id: grant.id, bytes: 30 }),
  ].map(reserve => {
    try { reserve(); return 'reserved'; } catch (error) { return error.code; }
  });
  assert.deepEqual(results, ['reserved', 'budget_exhausted']);
  assert.equal(f.store.status({ root: f.root }).requestsUsed, 1);
});

test('dispatch rejects a revoked identity without invoking fetch and releases synchronously after start', async t => {
  const f = await fixture(t);
  const grant = f.store.set({ root: f.root, paths: ['src'], provider: 'openrouter' });
  const peer = createConsentStore({ sessionToken: f.sessionToken });
  peer.revoke({ root: f.root });
  let postCalls = 0;
  assert.throws(() => f.store.dispatch({ root: f.root, id: grant.id }, () => { postCalls++; return Promise.resolve(); }), { code: 'grant_changed' });
  assert.equal(postCalls, 0);

  const live = f.store.set({ root: f.root, paths: ['src'], provider: 'openrouter' });
  let resolveResponse;
  const responsePending = new Promise(resolve => { resolveResponse = resolve; });
  const dispatched = f.store.dispatch({ root: f.root, id: live.id }, () => { postCalls++; return responsePending; });
  assert.equal(postCalls, 1);
  // In-memory check/start has no await gap; revoke succeeds while the mocked HTTP response is pending.
  assert.equal(peer.revoke({ root: f.root }), true);
  assert.equal(await Promise.race([dispatched.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('pending'), 20))]), 'pending');
  resolveResponse('mock-response');
  assert.equal(await dispatched, 'mock-response');
});

test('local grants never reserve or dispatch external requests', async t => {
  const f = await fixture(t);
  const grant = f.store.set({ root: f.root, paths: ['src'], provider: 'local', mode: 'local' });
  assert.throws(() => f.store.reserve({ root: f.root, id: grant.id, bytes: 1 }), { code: 'budget_exhausted' });
  let postCalls = 0;
  assert.throws(() => f.store.dispatch({ root: f.root, id: grant.id }, () => { postCalls++; }), { code: 'grant_changed' });
  assert.equal(postCalls, 0);
});

test('whitespace-separated path parser rejects unsupported values', () => {
  assert.deepEqual(parsePaths('src docs/api'), ['src', 'docs/api']);
  assert.throws(() => parsePaths(''), { code: 'paths_required' });
  assert.throws(() => parsePaths('-bad'), { code: 'invalid_paths' });
});
