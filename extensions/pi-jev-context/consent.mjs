import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const VERSION = 1;
const MAX_PATHS = 64;
const MAX_REQUESTS = 100;
const MAX_INPUT_BYTES = 1024 * 1024;
const RUNTIME_STATES = new WeakMap();

export class ConsentError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ConsentError(code); };
const validPath = p => typeof p === 'string' && p.length > 0 && p.length <= 512 &&
  !isAbsolute(p) && !p.includes('\\') && p.split('/').every(part => part && part !== '.' && part !== '..');
const canonicalRoot = root => resolve(root);

export function parsePaths(input) {
  // Whitespace-delimited on purpose; paths containing whitespace are unsupported.
  if (typeof input !== 'string' || !input.trim()) fail('paths_required');
  const paths = input.trim().split(/\s+/u);
  if (paths.length > MAX_PATHS || paths.some(p => p.includes('\\') || p.startsWith('-') || p.includes('\0'))) fail('invalid_paths');
  return [...new Set(paths)];
}

/** In-memory grants shared only by store facades carrying this extension-runtime token. */
export function createConsentStore({ sessionToken, idFactory = randomUUID }) {
  if (!sessionToken || typeof sessionToken !== 'object') fail('session_required');
  let runtime = RUNTIME_STATES.get(sessionToken);
  if (!runtime) {
    runtime = { grants: new Map(), sessionId: undefined, epoch: 0, active: false, retired: false };
    RUNTIME_STATES.set(sessionToken, runtime);
  }

  function project(root) {
    if (typeof root !== 'string' || !root) fail('invalid_root');
    const canonical = canonicalRoot(root);
    return { root: canonical, projectId: createHash('sha256').update(canonical).digest('hex').slice(0, 32) };
  }
  function current(root) {
    const { root: canonical } = project(root);
    const grant = runtime.grants.get(canonical);
    return runtime.active && grant && grant.sessionId === runtime.sessionId && grant.epoch === runtime.epoch
      ? grant : null;
  }
  function activate(sessionId) {
    if (runtime.retired || typeof sessionId !== 'string' || !sessionId) fail('session_unavailable');
    runtime.grants.clear();
    runtime.epoch++;
    runtime.sessionId = sessionId;
    runtime.active = true;
    return runtime.epoch;
  }
  function clear() {
    runtime.grants.clear();
    runtime.epoch++;
  }
  function invalidate() {
    clear();
    runtime.active = false;
    runtime.sessionId = undefined;
    runtime.retired = true;
  }
  function set({ root, paths, provider, mode = 'external', maxRequests = 100, maxInputBytes = MAX_INPUT_BYTES }) {
    if (!runtime.active || runtime.retired) fail('session_unavailable');
    if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS || !paths.every(validPath) || new Set(paths).size !== paths.length) fail('invalid_paths');
    if (!['openrouter', 'typesafe', 'local'].includes(provider) || !['external', 'local'].includes(mode) ||
        (mode === 'external' && provider === 'local') || (mode === 'local' && provider !== 'local')) fail('invalid_grant');
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS ||
        !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > MAX_INPUT_BYTES) fail('invalid_grant');
    const { root: canonical, projectId } = project(root);
    const grant = Object.freeze({
      version: VERSION, id: idFactory(), projectId, root: canonical, sessionId: runtime.sessionId, epoch: runtime.epoch,
      mode, provider, allowedPaths: Object.freeze([...paths].sort()), maxRequests, maxInputBytes,
      requestsUsed: 0, bytesUsed: 0,
    });
    runtime.grants.set(canonical, grant);
    return grant;
  }
  function status({ root }) { return current(root); }
  function revoke({ root }) {
    const { root: canonical } = project(root);
    const existed = Boolean(current(canonical));
    runtime.grants.delete(canonical);
    return existed;
  }
  function reserve({ root, id, bytes }) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_INPUT_BYTES) fail('invalid_reservation');
    const { root: canonical } = project(root);
    const latest = current(canonical);
    if (!latest || latest.id !== id) fail('grant_changed');
    if (latest.mode !== 'external' || latest.requestsUsed >= latest.maxRequests || latest.bytesUsed + bytes > latest.maxInputBytes) fail('budget_exhausted');
    const updated = Object.freeze({ ...latest, requestsUsed: latest.requestsUsed + 1, bytesUsed: latest.bytesUsed + bytes });
    runtime.grants.set(canonical, updated);
    return updated;
  }
  function isCurrent({ root, id }) {
    return current(root)?.id === id;
  }
  function dispatch({ root, id }, start) {
    if (typeof start !== 'function') fail('invalid_dispatch');
    const { root: canonical } = project(root);
    const latest = current(canonical);
    if (!latest || latest.id !== id || latest.mode !== 'external') fail('grant_changed');
    // Validation and invocation are one synchronous section: no event-loop await gap before fetch starts.
    return Promise.resolve(start());
  }
  return Object.freeze({ activate, clear, invalidate, set, status, revoke, reserve, isCurrent, dispatch });
}

export { MAX_INPUT_BYTES, MAX_REQUESTS };
