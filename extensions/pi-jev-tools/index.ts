import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { createRunner, JevError, LIMITS } from './core.mjs';

export default function (pi: ExtensionAPI) {
  let runner: ReturnType<typeof createRunner> | undefined;
  pi.on('session_shutdown', () => runner?.shutdown());
  pi.registerTool({
    name: 'jev_rerank',
    label: 'Jev Rerank',
    description: 'Rank 1–10 collected public-web passages by relevance with TypeSafe Jev. Use only when prioritization would help. External paid request: review the full payload and confirm before sending. Parent only; never send secrets, credentials, session/local/private data, signed URLs, or authenticated content. Write question and criteria in English; preserve excerpts verbatim, including names, numbers, dates, and negation. It does not fetch or verify facts. Inputs over 64KiB UTF-8 fail. Never retry; on not_ranked keep the original order.',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 4000, description: 'English research question; no private context.' }),
      criteria: Type.String({ minLength: 1, maxLength: 4000, description: 'English relevance criteria; preserve state distinctions.' }),
      candidates: Type.Array(Type.Object({
        id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Unique candidate ID.' }),
        url: Type.String({ minLength: 1, maxLength: 2048, description: 'Public, unsigned, unauthenticated source URL.' }),
        title: Type.String({ minLength: 1, maxLength: 500 }),
        excerpt: Type.String({ minLength: 1, maxLength: LIMITS.excerptChars, description: 'Relevant verbatim passage with context (~2,000 characters).' }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: LIMITS.candidates }),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      runner ??= createRunner({
        resolveApiKey: async () => (await ctx.modelRegistry.getProviderAuth('openrouter'))?.auth.apiKey,
      });
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
