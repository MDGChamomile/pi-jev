import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { homedir } from 'node:os';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createConsentStore, parsePaths, MAX_INPUT_BYTES, MAX_REQUESTS } from './consent.mjs';
import { findCandidates, prepareRanking, rankCandidates, renderContext, LIMITS } from './core.mjs';

const ERROR_CODES = new Set([
  'paths_required', 'invalid_paths', 'path_outside_project', 'unsupported_path', 'project_root_not_allowed',
  'invalid_provider', 'invalid_grant', 'invalid_reservation', 'lock_busy', 'unsafe_state_path',
  'grant_changed', 'budget_exhausted', 'invalid_root', 'invalid_input', 'invalid_path', 'path_not_allowed',
  'cancelled', 'input_too_large', 'sensitive_input', 'invalid_response', 'output_too_large',
  'missing_key', 'authentication_failed', 'payment_required', 'request_forbidden', 'timeout',
  'rate_limited', 'invalid_request', 'provider_error',
]);
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
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
  const agentDir = process.env.PI_CODING_AGENT_DIR || resolve(homedir(), '.pi', 'agent');
  const active = new Set<AbortController>();
  pi.on('session_shutdown', () => { for (const controller of active) controller.abort(new Error('cancelled')); active.clear(); });

  const getStore = (root: string) => createConsentStore({ root, agentDir });
  const currentProvider = () => process.env.PI_JEV_PROVIDER ?? 'openrouter';
  const canonicalScope = async (cwd: string, input: string[]) => {
    const root = await canonicalRoot(cwd);
    const paths: string[] = [];
    for (const entry of input) {
      if (isAbsolute(entry) || entry.split(/[\\/]/u).includes('..') || entry.startsWith('~')) fail('invalid_paths');
      const absolute = await realpath(resolve(root, entry));
      if (!within(root, absolute)) fail('path_outside_project');
      const info = await stat(absolute);
      if (!info.isFile() && !info.isDirectory()) fail('unsupported_path');
      const rel = relative(root, absolute).split(sep).join('/');
      if (!rel) fail('project_root_not_allowed');
      paths.push(rel);
    }
    return { root, paths: [...new Set(paths)].sort() };
  };
  const writeGrant = async (ctx: { cwd: string; hasUI: boolean; ui: ExtensionContext['ui'] }, args: string, mode: 'external' | 'local') => {
    if (!ctx.hasUI) { ctx.ui.notify('Interactive consent UI is unavailable; no grant was changed.', 'warning'); return; }
    const paths = parsePaths(args.trim());
    const scope = await canonicalScope(ctx.cwd, paths);
    const configured = currentProvider();
    if (mode === 'external' && !['openrouter', 'typesafe'].includes(configured)) fail('invalid_provider');
    const provider = mode === 'local' ? 'local' : configured;
    const providerDisclosure = provider === 'openrouter'
      ? 'OpenRouter endpoint https://openrouter.ai/api/alpha/decisions; model ~typesafe/jev-latest. Maximum one request per tool call, 5-second request timeout. Input price ceiling: $0.042 per million tokens; output price ceiling: $0. No hard total-cost cap; delivery and billing may be unknown.'
      : provider === 'typesafe'
        ? 'TypeSafe direct endpoint https://api.typesafe.ai/v1/systemone; model jev-latest. Maximum one request per tool call, 5-second request timeout. No per-token price ceiling or hard total-cost cap; delivery and billing may be unknown.'
        : 'Local-only search: no provider, authentication, or network request.';
    const description = mode === 'local'
      ? `Read only the listed local project paths. ${providerDisclosure}`
      : `Allow automatic external ranking for this canonical project and these exact allowed paths only. The request contains the goal and bounded source snippets, not Pi parameters, session, or conversation history. It may disclose sensitive text in authorized source files; known secrets are excluded by scanner patterns, but detection is not complete. ${providerDisclosure} Up to ${MAX_REQUESTS} requests and ${MAX_INPUT_BYTES} cumulative serialized input bytes over 7 days. Failed, cancelled-after-reservation, or otherwise uncertain attempts consume quota conservatively; usage persists across restart and is not reset on reload. Renewing with this command explicitly confirms a new budget. No per-call popup.`;
    const ok = await ctx.ui.confirm('Enable Jev context?', `${description}\n\nCanonical project: ${scope.root}\nAllowed paths:\n${scope.paths.map(p => `- ${p}`).join('\n')}\n\nConfirm this bounded grant?`);
    if (!ok) { ctx.ui.notify('No consent grant was created.', 'info'); return; }
    const grant = await getStore(scope.root).set({ paths: scope.paths, provider, mode, maxRequests: MAX_REQUESTS, maxInputBytes: MAX_INPUT_BYTES });
    ctx.ui.notify(`Jev context ${mode} grant saved for this project (${grant.maxRequests} requests, ${grant.maxInputBytes} input bytes, expires in 7 days).`, 'info');
  };

  pi.registerCommand('jev-context', {
    description: 'Manage bounded, project-specific Jev context consent: status | enable <paths> | local <paths> | disable.',
    handler: async (args, ctx) => {
      try {
        const [verb, ...rest] = args.trim().split(/\s+/u);
        const tail = rest.join(' ');
        const root = await canonicalRoot(ctx.cwd);
        const store = getStore(root);
        if (verb === 'status' && !tail) {
          const grant = await store.status();
          ctx.ui.notify(grant
            ? `Jev context: enabled (${grant.mode}/${grant.provider}); ${grant.requestsUsed}/${grant.maxRequests} requests and ${grant.bytesUsed}/${grant.maxInputBytes} input bytes used; expires ${new Date(grant.deadline).toISOString()}; paths: ${grant.allowedPaths.join(', ')}`
            : 'Jev context: not enabled for this project.', 'info');
        } else if (verb === 'enable' && tail) await writeGrant(ctx, tail, 'external');
        else if (verb === 'local' && tail) await writeGrant(ctx, tail, 'local');
        else if (verb === 'disable' && !tail) {
          await store.revoke();
          ctx.ui.notify('Jev context grant revoked for this project.', 'info');
        } else ctx.ui.notify('Usage: /jev-context status | enable <relative paths> | local <relative paths> | disable. Paths are whitespace-delimited; paths containing whitespace are unsupported.', 'warning');
      } catch (error) { ctx.ui.notify(`Jev context: ${sanitize(error)}`, 'warning'); }
    },
  });

  pi.registerTool({
    name: 'find_context', label: 'Find Context',
    description: 'Locate implementation/evidence for a behavior across files from paths and a goal in one call. Use when location is unknown; use read for exact known ranges/full review/patch preparation. Consent is user-managed with /jev-context; this tool cannot enable, expand, or renew consent. No grant means files are not read. External ranking may use a previously approved bounded grant; never include data outside authorized source paths, credentials/secrets, or personal session/history content.',
    parameters: Type.Object({
      paths: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { minItems: 1, maxItems: 64, description: 'Relative paths contained in the user-approved path scope.' }),
      goal: Type.String({ minLength: 1, maxLength: 4000, description: 'Focused retrieval goal; do not include private session context.' }),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const goal = params.goal;
      const paths = [...params.paths];
      const controller = new AbortController();
      active.add(controller);
      const signals = [controller.signal, ...(signal ? [signal] : [])];
      const combined = AbortSignal.any(signals);
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let revokePoll: ReturnType<typeof setInterval> | undefined;
      let scan: Awaited<ReturnType<typeof findCandidates>> | undefined;
      try {
        if (combined.aborted) return cancelled(codeOf(combined.reason));
        const invocationProvider = currentProvider();
        const root = await canonicalRoot(ctx.cwd);
        const store = getStore(root);
        const grant = await store.status();
        if (!grant) return notEnabled();
        revokePoll = setInterval(() => {
          void store.isCurrent(grant.id).then(current => {
            if (!current) controller.abort(Object.assign(new Error('grant_changed'), { code: 'grant_changed' }));
          }).catch(() => controller.abort(Object.assign(new Error('grant_changed'), { code: 'grant_changed' })));
        }, 50);
        deadlineTimer = setTimeout(() => controller.abort(Object.assign(new Error('timeout'), { code: 'timeout' })), LIMITS.timeoutMs);
        const allowed: string[] = grant.allowedPaths;
        const lexicalPaths = normalizeRequestedPaths(paths);
        if (!lexicalPaths || lexicalPaths.some(path => !withinGrant(path, allowed))) return notEnabled();
        const requested = await canonicalScope(root, lexicalPaths);
        if (requested.paths.some(path => !withinGrant(path, allowed))) return notEnabled();
        scan = await waitAbortable(findCandidates({ root, paths: requested.paths, allowedPaths: allowed, goal, signal: combined }), combined);
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        if (scan.candidates.length <= 1 || grant.mode === 'local') return renderOutput(scan, [], 'original');
        if (grant.provider !== invocationProvider) return renderOutput(scan, [], 'original', undefined, 'Configured provider differs from the saved grant; results are local-only. Re-enable with /jev-context enable after reviewing the provider.');
        const prepared = prepareRanking({ goal, candidates: scan.candidates, provider: grant.provider });
        const reserved = await store.reserve({ id: grant.id, bytes: Buffer.byteLength(prepared.serialized, 'utf8') });
        if (combined.aborted || !await store.isCurrent(reserved.id)) return combined.aborted ? stopOrFallback(scan, codeOf(combined.reason)) : renderOutput(scan, [], 'original');
        // Resolve exactly the consented provider's credential, only after grant and quota checks.
        const authPromise = reserved.provider === 'typesafe'
          ? Promise.resolve(process.env.TYPESAFE_API_KEY)
          : Promise.resolve().then(() => ctx.modelRegistry.getProviderAuth('openrouter')).then(auth => auth?.auth.apiKey);
        const apiKey = await waitAbortable(authPromise, combined);
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        if (currentProvider() !== invocationProvider) return renderOutput(scan, [], 'original', undefined, 'Configured provider changed during the operation; no external request was sent. Re-enable the grant after reviewing the provider.');
        if (!apiKey || !await store.isCurrent(reserved.id)) return renderOutput(scan, [], 'original', undefined, 'Local-only fallback (authentication_failed or grant changed).');
        const ranked = await waitAbortable(rankCandidates({ goal, candidates: scan.candidates, provider: reserved.provider, apiKey, signal: combined }), combined);
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        return renderOutput(scan, ranked.rankedIds, 'ranked', ranked.usage);
      } catch (error) {
        if (combined.aborted) return stopOrFallback(scan, codeOf(combined.reason));
        if (scan) return renderOutput(scan, [], 'original', undefined, `Local-only fallback (${sanitize(error)}); no ranking applied.`);
        return output({ status: 'not_ranked', mode: 'local', coverage: emptyCoverage(), snippets: [], omitted: 0, notice: `Local-only fallback (${sanitize(error)}).` });
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        if (revokePoll) clearInterval(revokePoll);
        active.delete(controller);
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
function notEnabled() { return output({ status: 'not_enabled', mode: 'local', coverage: emptyCoverage(), snippets: [], omitted: 0, notice: 'Enable a project-scoped grant with /jev-context before reading files.' }); }
function renderOutput(scan: Awaited<ReturnType<typeof findCandidates>>, rankedIds: string[], mode: 'original' | 'ranked', usage?: unknown, notice?: string) {
  const result = renderContext({ scan, rankedIds, mode });
  const content = notice ? { ...result, notice } : result;
  return output(content, usage === undefined ? content : { ...content, usage, actualCost: (usage as { cost?: unknown }).cost ?? 'unknown' });
}
