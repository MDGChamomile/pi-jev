import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createConsentStore, parsePaths, MAX_INPUT_BYTES, MAX_REQUESTS } from './consent.mjs';
import { findCandidates, prepareRanking, rankCandidates, renderContext, LIMITS } from './core.mjs';

const ERROR_CODES = new Set([
  'paths_required', 'invalid_paths', 'path_outside_project', 'unsupported_path', 'project_root_not_allowed',
  'invalid_provider', 'invalid_grant', 'invalid_reservation', 'invalid_dispatch', 'session_required',
  'session_unavailable', 'session_changed', 'grant_changed',
  'budget_exhausted', 'invalid_root', 'invalid_input', 'invalid_path', 'path_not_allowed', 'cancelled',
  'input_too_large', 'sensitive_input', 'invalid_response', 'output_too_large', 'missing_key',
  'authentication_failed', 'payment_required', 'request_forbidden', 'timeout', 'rate_limited',
  'invalid_request', 'provider_error',
]);
const within = (base: string, path: string) => {
  const rel = relative(base, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
const codeOf = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  return ERROR_CODES.has(code) ? code : 'internal_error';
};
const sanitize = (error: unknown) => codeOf(error);
const canonicalRoot = async (cwd: string) => realpath(cwd);
const normalizeRequestedPaths = (paths: unknown): string[] | undefined => {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 64) return undefined;
  const normalized: string[] = [];
  for (const value of paths) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\\') || value.includes('\0') || value.startsWith('~') || /^[A-Za-z]:/u.test(value) || isAbsolute(value)) return undefined;
    const path = posix.normalize(value);
    if (!path || path === '.' || path === '..' || path.startsWith('../') || path.startsWith('/')) return undefined;
    normalized.push(path);
  }
  return [...new Set(normalized)];
};
const withinGrant = (path: string, allowed: string[]) => allowed.some(scope => path === scope || path.startsWith(`${scope}/`));
const coded = (code: string) => Object.assign(new Error(code), { code });

function waitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('cancelled'));
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (fn: (value: any) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(rejectPromise, signal.reason ?? new Error('cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => finish(resolvePromise, value), error => finish(rejectPromise, error));
  });
}

export default function (pi: ExtensionAPI) {
  const sessionToken = {};
  const store = createConsentStore({ sessionToken });
  let sessionEpoch = 0;
  let sessionId: string | undefined;
  let sessionLive = false;
  const active = new Set<{ controller: AbortController; root?: string }>();
  const pendingConsents = new Set<AbortController>();
  const abortAll = (code: string) => {
    for (const { controller } of active) controller.abort(coded(code));
    for (const controller of pendingConsents) controller.abort(coded(code));
    active.clear();
    pendingConsents.clear();
  };
  const abortProject = (root: string, code = 'grant_changed') => {
    for (const entry of active) if (entry.root === root) entry.controller.abort(coded(code));
  };
  const sessionIdFrom = (ctx: Pick<ExtensionContext, 'sessionManager'>) => {
    try { return ctx.sessionManager?.getSessionId(); } catch { return undefined; }
  };
  const snapshotSession = (ctx: Pick<ExtensionContext, 'sessionManager'>) => {
    const id = sessionIdFrom(ctx);
    return sessionLive && id && id === sessionId ? { epoch: sessionEpoch, id } : undefined;
  };
  const snapshotCurrent = (snapshot: { epoch: number; id: string } | undefined, ctx: Pick<ExtensionContext, 'sessionManager'>) =>
    Boolean(snapshot && sessionLive && sessionEpoch === snapshot.epoch && sessionId === snapshot.id && sessionIdFrom(ctx) === snapshot.id);
  const requireSnapshot = (snapshot: { epoch: number; id: string } | undefined, ctx: Pick<ExtensionContext, 'sessionManager'>) => {
    if (!snapshotCurrent(snapshot, ctx)) throw coded('session_changed');
  };
  const invalidateTransition = () => {
    sessionEpoch++;
    store.clear();
    abortAll('session_changed');
    // Keep the current identity alive if a before_* transition is later cancelled; permissions stay cleared.
  };
  pi.on('session_start', (_event, ctx) => {
    const id = sessionIdFrom(ctx);
    sessionEpoch++;
    abortAll('session_changed');
    if (!id) {
      store.invalidate();
      sessionId = undefined;
      sessionLive = false;
      return;
    }
    try {
      store.activate(id); // Every start/reload requires a fresh, explicit grant.
      sessionId = id;
      sessionLive = true;
    } catch {
      sessionId = undefined;
      sessionLive = false;
    }
  });
  pi.on('session_before_switch', () => { invalidateTransition(); });
  pi.on('session_before_fork', () => { invalidateTransition(); });
  pi.on('session_shutdown', () => {
    sessionEpoch++;
    sessionLive = false;
    sessionId = undefined;
    store.invalidate();
    abortAll('session_changed');
  });

  const currentProvider = () => process.env.PI_JEV_PROVIDER ?? 'openrouter';
  const canonicalScope = async (cwd: string, input: string[]) => {
    const root = await canonicalRoot(cwd);
    const paths: string[] = [];
    for (const entry of input) {
      if (isAbsolute(entry) || entry.split(/[\\/]/u).includes('..') || entry.startsWith('~')) throw coded('invalid_paths');
      const absolute = await realpath(resolve(root, entry));
      if (!within(root, absolute)) throw coded('path_outside_project');
      const info = await stat(absolute);
      if (!info.isFile() && !info.isDirectory()) throw coded('unsupported_path');
      const rel = relative(root, absolute).split(sep).join('/');
      if (!rel) throw coded('project_root_not_allowed');
      paths.push(rel);
    }
    return { root, paths: [...new Set(paths)].sort() };
  };
  const writeGrant = async (ctx: { cwd: string; hasUI: boolean; ui: ExtensionContext['ui']; sessionManager: ExtensionContext['sessionManager'] }, snapshot: { epoch: number; id: string }, args: string, mode: 'external' | 'local') => {
    if (!ctx.hasUI) { ctx.ui.notify('Interactive consent UI is unavailable; no grant was changed.', 'warning'); return; }
    const paths = parsePaths(args.trim());
    const scope = await canonicalScope(ctx.cwd, paths);
    requireSnapshot(snapshot, ctx);
    const configured = currentProvider();
    if (mode === 'external' && !['openrouter', 'typesafe'].includes(configured)) throw coded('invalid_provider');
    const provider = mode === 'local' ? 'local' : configured;
    const providerDisclosure = provider === 'openrouter'
      ? 'OpenRouter endpoint https://openrouter.ai/api/alpha/decisions; model ~typesafe/jev-latest. Maximum one request per tool call, 5-second request timeout. Input price ceiling: $0.042 per million tokens; output price ceiling: $0. No hard total-cost cap; delivery and billing may be unknown.'
      : provider === 'typesafe'
        ? 'TypeSafe direct endpoint https://api.typesafe.ai/v1/systemone; model jev-latest. Maximum one request per tool call, 5-second request timeout. No per-token price ceiling or hard total-cost cap; delivery and billing may be unknown.'
        : 'Local-only search: no provider, authentication, or network request.';
    const description = mode === 'local'
      ? `Read only the listed local project paths. This grant applies only to the current Pi session. ${providerDisclosure}`
      : `Allow automatic external ranking only for this Pi session, canonical project, and exact allowed paths. The request contains the goal and bounded source snippets, not Pi parameters, session, or conversation history. It may disclose sensitive text in authorized source files; known secrets are excluded by scanner patterns, but detection is not complete. ${providerDisclosure} Up to ${MAX_REQUESTS} requests and ${MAX_INPUT_BYTES} cumulative serialized input bytes in this session. Failed, cancelled-after-reservation, or otherwise uncertain attempts consume quota conservatively. New/restarted sessions, session switches, forks, reloads, and shutdown discard this grant and quota; /tree navigation within this session preserves them. Explicitly re-enabling confirms a fresh budget. No per-call popup.`;
    requireSnapshot(snapshot, ctx);
    const promptController = new AbortController();
    pendingConsents.add(promptController);
    try {
      const ok = await ctx.ui.confirm('Enable Jev context for this session?', `${description}\n\nCanonical project: ${scope.root}\nAllowed paths:\n${scope.paths.map(p => `- ${p}`).join('\n')}\n\nConfirm this bounded session grant?`, { signal: promptController.signal });
      requireSnapshot(snapshot, ctx);
      if (promptController.signal.aborted || !ok) { ctx.ui.notify('No session grant was created.', 'info'); return; }
      const grant = store.set({ root: scope.root, paths: scope.paths, provider, mode, maxRequests: MAX_REQUESTS, maxInputBytes: MAX_INPUT_BYTES });
      abortProject(scope.root);
      ctx.ui.notify(`Jev context ${mode} grant is active for this session (${grant.maxRequests} requests, ${grant.maxInputBytes} input bytes).`, 'info');
    } finally { pendingConsents.delete(promptController); }
  };

  pi.registerCommand('jev-context', {
    description: 'Manage current-session Jev context consent: status | enable <paths> | local <paths> | disable.',
    handler: async (args, ctx) => {
      const snapshot = snapshotSession(ctx); // Capture before any await; stale commands cannot adopt a replacement session.
      if (!snapshot) { if (ctx.hasUI) ctx.ui.notify('No active session identity; Jev context is disabled.', 'warning'); return; }
      try {
        const [verb, ...rest] = args.trim().split(/\s+/u);
        const tail = rest.join(' ');
        const root = await canonicalRoot(ctx.cwd);
        requireSnapshot(snapshot, ctx);
        if (verb === 'status' && !tail) {
          const grant = store.status({ root });
          ctx.ui.notify(grant
            ? `Jev context: enabled for this session (${grant.mode}/${grant.provider}); ${grant.requestsUsed}/${grant.maxRequests} requests and ${grant.bytesUsed}/${grant.maxInputBytes} input bytes used; paths: ${grant.allowedPaths.join(', ')}`
            : 'Jev context: not enabled for this session and project.', 'info');
        } else if (verb === 'enable' && tail) await writeGrant(ctx, snapshot, tail, 'external');
        else if (verb === 'local' && tail) await writeGrant(ctx, snapshot, tail, 'local');
        else if (verb === 'disable' && !tail) {
          store.revoke({ root });
          abortProject(root);
          requireSnapshot(snapshot, ctx);
          ctx.ui.notify('Jev context grant revoked for this session and project.', 'info');
        } else ctx.ui.notify('Usage: /jev-context status | enable <relative paths> | local <relative paths> | disable. Paths are whitespace-delimited; paths containing whitespace are unsupported.', 'warning');
      } catch (error) {
        if (snapshotCurrent(snapshot, ctx) && ctx.hasUI) ctx.ui.notify(`Jev context: ${sanitize(error)}`, 'warning');
      }
    },
  });

  pi.registerTool({
    name: 'find_context', label: 'Find Context',
    description: 'Locate implementation/evidence for a behavior across files from paths and a goal in one call. Use when location is unknown; use read for exact known ranges/full review/patch preparation. Consent is user-managed with /jev-context; this tool cannot enable, expand, or renew consent. No current-session grant means files are not read. External ranking may use a previously approved bounded grant; never include data outside authorized source paths, credentials/secrets, or personal session/history content.',
    parameters: Type.Object({
      paths: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { minItems: 1, maxItems: 64, description: 'Relative paths contained in the user-approved path scope.' }),
      goal: Type.String({ minLength: 1, maxLength: 4000, description: 'Focused retrieval goal; do not include private session context.' }),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const snapshot = snapshotSession(ctx); // Session identity/epoch and caller input are frozen before the first await.
      const goal = params.goal;
      const paths = [...params.paths];
      if (!snapshot) return notEnabled();
      const controller = new AbortController();
      const activeEntry: { controller: AbortController; root?: string } = { controller };
      active.add(activeEntry);
      const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let scan: Awaited<ReturnType<typeof findCandidates>> | undefined;
      try {
        if (combined.aborted) return cancelled(codeOf(combined.reason));
        const invocationProvider = currentProvider();
        const root = await canonicalRoot(ctx.cwd);
        activeEntry.root = root;
        requireSnapshot(snapshot, ctx);
        const grant = store.status({ root });
        if (!grant) return notEnabled();
        deadlineTimer = setTimeout(() => controller.abort(coded('timeout')), LIMITS.timeoutMs);
        const allowed: string[] = [...grant.allowedPaths];
        const lexicalPaths = normalizeRequestedPaths(paths);
        if (!lexicalPaths || lexicalPaths.some(path => !withinGrant(path, allowed))) return notEnabled();
        // Keep requested lexical paths: core performs no-follow/realpath checks and partial coverage for missing members.
        scan = await waitAbortable(findCandidates({ root, paths: lexicalPaths, allowedPaths: allowed, goal, signal: combined }), combined);
        requireSnapshot(snapshot, ctx);
        if (!store.isCurrent({ root, id: grant.id })) return cancelled('grant_changed');
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        if (scan.candidates.length <= 1 || grant.mode === 'local') return renderOutput(scan, [], 'original');
        if (grant.provider !== invocationProvider) return renderOutput(scan, [], 'original', undefined, 'Configured provider differs from the saved grant; results are local-only. Re-enable with /jev-context enable after reviewing the provider.');
        const prepared = prepareRanking({ goal, candidates: scan.candidates, provider: grant.provider });
        const reserved = store.reserve({ root, id: grant.id, bytes: Buffer.byteLength(prepared.serialized, 'utf8') });
        if (combined.aborted || !store.isCurrent({ root, id: reserved.id })) return combined.aborted ? stopOrFallback(scan, codeOf(combined.reason)) : cancelled('grant_changed');
        const authPromise = reserved.provider === 'typesafe'
          ? Promise.resolve(process.env.TYPESAFE_API_KEY)
          : Promise.resolve().then(() => ctx.modelRegistry.getProviderAuth('openrouter')).then(auth => auth?.auth.apiKey);
        const apiKey = await waitAbortable(authPromise, combined);
        requireSnapshot(snapshot, ctx);
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        if (currentProvider() !== invocationProvider) return renderOutput(scan, [], 'original', undefined, 'Configured provider changed during the operation; no external request was sent. Re-enable the grant after reviewing the provider.');
        if (!apiKey) return renderOutput(scan, [], 'original', undefined, 'Local-only fallback (authentication_failed).');
        const guardedFetch: typeof fetch = (input, init) => store.dispatch({ root, id: reserved.id }, () => {
          requireSnapshot(snapshot, ctx);
          if (combined.aborted) throw combined.reason ?? coded('cancelled');
          return fetch(input, init);
        }).catch(error => {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'grant_changed') controller.abort(error);
          throw error;
        });
        const ranked = await waitAbortable(rankCandidates({ goal, candidates: scan.candidates, provider: reserved.provider, apiKey, signal: combined, fetchImpl: guardedFetch }), combined);
        requireSnapshot(snapshot, ctx);
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        return renderOutput(scan, ranked.rankedIds, 'ranked', ranked.usage);
      } catch (error) {
        if (!snapshotCurrent(snapshot, ctx)) return cancelled('session_changed');
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        if (scan) return renderOutput(scan, [], 'original', undefined, `Local-only fallback (${sanitize(error)}); no ranking applied.`);
        return output({ status: 'not_ranked', mode: 'local', coverage: emptyCoverage(), snippets: [], omitted: 0, notice: `Local-only fallback (${sanitize(error)}).` });
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        active.delete(activeEntry);
      }
    },
  });
}

function emptyCoverage() { return { filesConsidered: 0, filesRead: 0, bytesRead: 0, limited: false, skipped: 0 }; }
function output(result: unknown, details: unknown = result) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details };
}
function stopOrFallback(scan: Awaited<ReturnType<typeof findCandidates>> | undefined, code: string) {
  if (code === 'timeout' && scan) return renderOutput(scan, [], 'original', undefined, 'Local-only fallback (timeout); no ranking applied.');
  return cancelled(code);
}
function cancelled(code = 'cancelled') {
  return output({ status: 'cancelled', mode: 'local', coverage: emptyCoverage(), snippets: [], omitted: 0, notice: `Operation stopped (${ERROR_CODES.has(code) ? code : 'cancelled'}); no snippets returned.` });
}
function notEnabled() { return output({ status: 'not_enabled', mode: 'local', coverage: emptyCoverage(), snippets: [], omitted: 0, notice: 'Enable a current-session project grant with /jev-context before reading files.' }); }
function renderOutput(scan: Awaited<ReturnType<typeof findCandidates>>, rankedIds: string[], mode: 'original' | 'ranked', usage?: unknown, notice?: string) {
  const result = renderContext({ scan, rankedIds, mode });
  const content = notice ? { ...result, notice } : result;
  return output(content, usage === undefined ? content : { ...content, usage, actualCost: (usage as { cost?: unknown }).cost ?? 'unknown' });
}
