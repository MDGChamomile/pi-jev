import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { Editor, truncateToWidth } from '@earendil-works/pi-tui';
import { createPayloadReviewer, createRunner, JevError, LIMITS } from './core.mjs';

const reviewPayload = createPayloadReviewer({ Editor, truncateToWidth });

export default function (pi: ExtensionAPI) {
  const newRunner = () => createRunner({
    resolveApiKey: async (ctx: ExtensionContext) => (await ctx.modelRegistry.getProviderAuth('openrouter'))?.auth.apiKey,
    review: reviewPayload,
  });
  let runner = newRunner();
  pi.on('session_shutdown', () => runner.shutdown());
  pi.on('session_start', () => { runner.shutdown(); runner = newRunner(); });
  pi.registerCommand('jev-rerank-status', {
    description: 'Show in-memory reranker status without authentication or network access.',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const status = runner.getStatus();
      ctx.ui.notify([
        `Jev reranker: loaded / tool ${pi.getActiveTools().includes('jev_rerank') ? 'active' : 'inactive'}`,
        `Calls since session start/reload: ${status.calls}`,
        `Approved request attempts: ${status.requestAttempts} (delivery and billing unknown)`,
        `In flight: ${status.inFlight ? 'yes' : 'no'}; last completed result: ${status.lastResult}`,
        `Validated provider response observed: ${status.validatedResponseObserved ? 'yes (historical, not a current connection check)' : 'no (unverified)'}`,
      ].join('\n'), 'info');
    },
  });
  pi.registerTool({
    name: 'jev_rerank',
    label: 'Jev Rerank',
    description: 'Rank 1–10 collected public-web passages by relevance with TypeSafe Jev. Use once with multiple usable passages, before reading all in depth, when reading order is open. Skip a single sufficient source, evidence already answering the question, fully reviewed candidates, or inadequate provenance/context. External paid request: review the full payload and confirm before sending. Parent only; never send secrets, credentials, session/local/private data, signed URLs, or authenticated content. Preserve excerpts verbatim, including names, numbers, dates, and negation. Does not fetch or verify facts. Inputs over 64KiB UTF-8 fail. No retries; on not_ranked keep original order.',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 4000, description: 'English research question; no private context.' }),
      criteria: Type.Optional(Type.String({ minLength: 1, maxLength: 4000, description: 'English relevance criteria; preserve state distinctions. Default: direct evidence over background, preserving dates, negation, uncertainty, planned vs completed actions, and contradictory evidence. Omit for default; empty/invalid values are rejected.' })),
      candidates: Type.Array(Type.Object({
        id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Unique candidate ID.' }),
        url: Type.String({ minLength: 1, maxLength: 2048, description: 'Public, unsigned, unauthenticated source URL.' }),
        title: Type.String({ minLength: 1, maxLength: 500 }),
        excerpt: Type.String({ minLength: 1, maxLength: LIMITS.excerptChars, description: 'Shortest exact excerpt with enough context for relevance; preserve negation, uncertainty, and state distinctions.' }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: LIMITS.candidates }),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        const result = await runner.execute(params, signal, ctx);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      } catch (error) {
        // Never expose provider exception messages or input excerpts.
        throw new Error(error instanceof JevError ? `jev_rerank: ${error.code}` : 'jev_rerank: internal_error');
      }
    },
  });
}
