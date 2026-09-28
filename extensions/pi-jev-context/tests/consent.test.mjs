import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, rm, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConsentStore, parsePaths } from '../consent.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'jev-context-consent-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const options = { root: join(home, 'project'), agentDir: join(home, 'agent') };
  return { ...options, store: createConsentStore(options) };
}
async function waitFor(predicate, label, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test('bounded external grants persist, reserve budget cumulatively, and renew explicitly', async t => {
  const f = await fixture(t);
  const grant = await f.store.set({ paths: ['src'], provider: 'openrouter', maxRequests: 2, maxInputBytes: 100 });
  const restarted = createConsentStore({ root: f.root, agentDir: f.agentDir });
  assert.equal((await restarted.status()).id, grant.id);
  await restarted.reserve({ id: grant.id, bytes: 40 });
  const after = await f.store.status();
  assert.equal(after.requestsUsed, 1);
  assert.equal(after.bytesUsed, 40);
  await assert.rejects(() => f.store.reserve({ id: grant.id, bytes: 61 }), { code: 'budget_exhausted' });
  const renewed = await f.store.set({ paths: ['docs'], provider: 'typesafe', maxRequests: 1, maxInputBytes: 50 });
  assert.notEqual(renewed.id, grant.id);
  assert.equal((await restarted.status()).provider, 'typesafe');
  await assert.rejects(() => restarted.reserve({ id: grant.id, bytes: 1 }), { code: 'grant_changed' });
});

test('revocation invalidates identity and does not retain credentials', async t => {
  const f = await fixture(t);
  const grant = await f.store.set({ paths: ['src'], provider: 'typesafe' });
  assert.equal(JSON.stringify(await f.store.status()).includes('credential'), false);
  assert.equal(await f.store.revoke(), true);
  assert.equal(await f.store.status(), null);
  await assert.rejects(() => f.store.reserve({ id: grant.id, bytes: 1 }), { code: 'grant_changed' });
});

test('project storage is keyed by canonical project identity', async t => {
  const f = await fixture(t);
  await f.store.set({ paths: ['src'], provider: 'openrouter' });
  const other = createConsentStore({ root: join(f.root, '..', 'other-project'), agentDir: f.agentDir });
  assert.equal(await other.status(), null);
  assert.notEqual(f.store.projectId, other.projectId);
});

test('simultaneous reservation cannot exceed a single-request budget', async t => {
  const f = await fixture(t);
  const grant = await f.store.set({ paths: ['src'], provider: 'openrouter', maxRequests: 1, maxInputBytes: 100 });
  const results = await Promise.allSettled([
    f.store.reserve({ id: grant.id, bytes: 30 }),
    f.store.reserve({ id: grant.id, bytes: 30 }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await f.store.status()).requestsUsed, 1);
});

test('dispatch serializes final grant validation and fetch start with cross-store revoke', async t => {
  const f = await fixture(t);
  const first = f.store;
  const second = createConsentStore({ root: f.root, agentDir: f.agentDir });
  const revoked = await first.set({ paths: ['src'], provider: 'openrouter' });
  await second.revoke();
  let postCalls = 0;
  await assert.rejects(() => first.dispatch({ id: revoked.id }, () => { postCalls++; return Promise.resolve(); }), { code: 'grant_changed' });
  assert.equal(postCalls, 0);

  const current = await second.set({ paths: ['src'], provider: 'openrouter' });
  let resolveResponse;
  let started = false;
  const responsePending = new Promise(resolve => { resolveResponse = resolve; });
  const dispatchPending = first.dispatch({ id: current.id }, () => { started = true; return responsePending; });
  await waitFor(() => started, 'dispatch fetch start');
  // started is set inside the lock callback; wait for actual lock removal before racing revoke.
  await waitFor(async () => {
    try { await lstat(join(first.directory, '.lock')); return false; }
    catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
  }, 'dispatch lock release');
  // Revoke from another store completes while the response is still pending: dispatch released the lock.
  await second.revoke();
  assert.equal(await Promise.race([dispatchPending.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('pending'), 20))]), 'pending');
  resolveResponse('mock-response');
  assert.equal(await dispatchPending, 'mock-response');
});

test('dispatch checks expiry at the POST boundary and busy lock prevents start', async t => {
  const f = await fixture(t);
  let clock = 1_000_000;
  const store = createConsentStore({ root: f.root, agentDir: f.agentDir, now: () => clock });
  const grant = await store.set({ paths: ['src'], provider: 'openrouter', ttlMs: 60_000 });
  clock = grant.deadline;
  let postCalls = 0;
  await assert.rejects(() => store.dispatch({ id: grant.id }, () => { postCalls++; return Promise.resolve(); }), { code: 'grant_changed' });
  assert.equal(postCalls, 0);

  clock = grant.createdAt;
  const live = await store.set({ paths: ['src'], provider: 'openrouter' });
  const { mkdir, rm } = await import('node:fs/promises');
  await mkdir(join(store.directory, '.lock'));
  await assert.rejects(() => store.dispatch({ id: live.id }, () => { postCalls++; return Promise.resolve(); }), { code: 'lock_busy' });
  assert.equal(postCalls, 0);
  await rm(join(store.directory, '.lock'), { recursive: true });
});

test('state file symlinks fail closed and set validates lexical path scope', async t => {
  const f = await fixture(t);
  await f.store.set({ paths: ['src/file.ts'], provider: 'openrouter' });
  const moved = `${f.store.stateFile}.saved`;
  await rename(f.store.stateFile, moved);
  await symlink(moved, f.store.stateFile);
  assert.equal(await f.store.status(), null);
  for (const paths of [[], ['.'], ['src/../secret'], ['/absolute'], ['src\\file'], ['src//file']]) {
    await assert.rejects(() => f.store.set({ paths, provider: 'openrouter' }), { code: 'invalid_paths' });
  }
  await assert.rejects(() => f.store.set({ paths: ['src/file.ts'], provider: 'local', mode: 'external' }), { code: 'invalid_grant' });
});

test('oversized grant metadata fails closed before parsing', async t => {
  const f = await fixture(t);
  await f.store.set({ paths: ['src/file.ts'], provider: 'openrouter' });
  await writeFile(f.store.stateFile, 'x'.repeat(40 * 1024));
  assert.equal(await f.store.status(), null);
});

test('whitespace-separated path parser rejects unsupported values', () => {
  assert.deepEqual(parsePaths('src docs/api'), ['src', 'docs/api']);
  assert.throws(() => parsePaths(''), { code: 'paths_required' });
  assert.throws(() => parsePaths('-bad'), { code: 'invalid_paths' });
});
