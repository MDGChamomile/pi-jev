import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const VERSION = 1;
const MAX_PATHS = 64;
const MAX_REQUESTS = 100;
const MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 32 * 1024;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class ConsentError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ConsentError(code); };
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
const validPath = p => typeof p === 'string' && p.length > 0 && p.length <= 512 &&
  !isAbsolute(p) && !p.includes('\\') && p.split('/').every(part => part && part !== '.' && part !== '..');

export function parsePaths(input) {
  // Whitespace-delimited on purpose; paths containing whitespace are unsupported.
  if (typeof input !== 'string' || !input.trim()) fail('paths_required');
  const paths = input.trim().split(/\s+/u);
  if (paths.length > MAX_PATHS || paths.some(p => p.includes('\\') || p.startsWith('-') || p.includes('\0'))) fail('invalid_paths');
  return [...new Set(paths)];
}

export function createConsentStore({ root, agentDir, now = Date.now, randomId = randomUUID }) {
  const canonicalRoot = resolve(root);
  const projectId = createHash('sha256').update(canonicalRoot).digest('hex').slice(0, 32);
  // The configured Pi agent directory and its ancestor hierarchy are trusted user-owned storage.
  // Managed state directories and grant files are checked for symlinks; credentials are never persisted.
  const base = resolve(agentDir);
  const contextDir = resolve(base, 'jev-context');
  const directory = resolve(contextDir, projectId);
  const stateFile = resolve(directory, 'grant.json');
  const lockDir = resolve(directory, '.lock');

  async function ensureDirectory(path) {
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe_state_path');
  }
  async function ensureLayout() {
    await ensureDirectory(base);
    await ensureDirectory(contextDir);
    await ensureDirectory(directory);
  }
  async function read() {
    let handle;
    try {
      const info = await lstat(stateFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) return null;
      handle = await open(stateFile, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_STATE_BYTES) return null;
      const buffer = Buffer.alloc(MAX_STATE_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > MAX_STATE_BYTES) return null;
      const parsed = JSON.parse(buffer.subarray(0, total).toString('utf8'));
      if (!validGrant(parsed) || parsed.projectId !== projectId || parsed.root !== canonicalRoot) return null;
      return parsed;
    } catch { return null; }
    finally { await handle?.close().catch(() => {}); }
  }
  function validGrant(g) {
    if (!g || g.version !== VERSION || typeof g.id !== 'string' || typeof g.projectId !== 'string' || typeof g.root !== 'string') return false;
    if (!['openrouter', 'typesafe', 'local'].includes(g.provider) || !['external', 'local'].includes(g.mode) ||
        (g.mode === 'external' && g.provider === 'local') || (g.mode === 'local' && g.provider !== 'local')) return false;
    if (!Array.isArray(g.allowedPaths) || g.allowedPaths.length < 1 || g.allowedPaths.length > MAX_PATHS ||
        !g.allowedPaths.every(validPath) || new Set(g.allowedPaths).size !== g.allowedPaths.length) return false;
    return Number.isSafeInteger(g.maxRequests) && g.maxRequests >= 1 && g.maxRequests <= MAX_REQUESTS &&
      Number.isSafeInteger(g.maxInputBytes) && g.maxInputBytes >= 1 && g.maxInputBytes <= MAX_INPUT_BYTES &&
      Number.isSafeInteger(g.requestsUsed) && g.requestsUsed >= 0 && g.requestsUsed <= g.maxRequests &&
      Number.isSafeInteger(g.bytesUsed) && g.bytesUsed >= 0 && g.bytesUsed <= g.maxInputBytes &&
      Number.isSafeInteger(g.deadline) && Number.isSafeInteger(g.createdAt) &&
      g.deadline - g.createdAt >= 60_000 && g.deadline - g.createdAt <= MAX_TTL_MS;
  }
  async function locked(action) {
    await ensureLayout();
    try { await mkdir(lockDir, { mode: 0o700 }); } catch { fail('lock_busy'); }
    try { return await action(); }
    finally { await rm(lockDir, { recursive: true, force: true }); }
  }
  async function save(grant) {
    const tmp = resolve(directory, `.grant-${randomId()}.tmp`);
    await writeFile(tmp, `${JSON.stringify(grant)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(tmp, stateFile);
  }
  async function set({ paths, provider, mode = 'external', maxRequests = 10, maxInputBytes = 262144, ttlMs = DEFAULT_TTL_MS }) {
    if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS || !paths.every(validPath) || new Set(paths).size !== paths.length) fail('invalid_paths');
    if (!['openrouter', 'typesafe', 'local'].includes(provider) || !['external', 'local'].includes(mode) ||
        (mode === 'external' && provider === 'local') || (mode === 'local' && provider !== 'local')) fail('invalid_grant');
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS ||
        !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > MAX_INPUT_BYTES ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_TTL_MS) fail('invalid_grant');
    await ensureLayout();
    const createdAt = now();
    const grant = await locked(async () => {
      const value = {
        version: VERSION, id: randomId(), projectId, root: canonicalRoot,
        mode, provider, allowedPaths: [...paths].sort(), maxRequests, maxInputBytes,
        requestsUsed: 0, bytesUsed: 0, deadline: createdAt + ttlMs, createdAt,
      };
      await save(value);
      return value;
    });
    return grant;
  }
  async function revoke() {
    return locked(async () => {
      const previous = await read();
      const value = { version: VERSION, id: randomId(), projectId, root: canonicalRoot, revoked: true, createdAt: now() };
      await save(value);
      return Boolean(previous);
    });
  }
  async function status() {
    await ensureLayout();
    const value = await read();
    return value && !value.revoked && value.deadline > now() ? value : null;
  }
  async function reserve({ id, bytes }) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_INPUT_BYTES) fail('invalid_reservation');
    return locked(async () => {
      const latest = await read();
      if (!latest || latest.revoked || latest.id !== id || latest.deadline <= now()) fail('grant_changed');
      if (latest.mode !== 'external' || latest.requestsUsed >= latest.maxRequests || latest.bytesUsed + bytes > latest.maxInputBytes) fail('budget_exhausted');
      const next = { ...latest, requestsUsed: latest.requestsUsed + 1, bytesUsed: latest.bytesUsed + bytes };
      await save(next);
      return next;
    });
  }
  async function isCurrent(id) {
    const latest = await status();
    return Boolean(latest && latest.id === id);
  }
  return Object.freeze({ projectId, directory, stateFile, status, set, revoke, reserve, isCurrent });
}

export { DEFAULT_TTL_MS, MAX_INPUT_BYTES, MAX_REQUESTS };
