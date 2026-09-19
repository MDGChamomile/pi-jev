import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { createRunner, JevError, LIMITS } from './core.mjs';

export default function (pi: ExtensionAPI) {
  let runner: ReturnType<typeof createRunner> | undefined;
  pi.on('session_shutdown', () => runner?.shutdown());
  pi.registerTool({
    name: 'jev_rerank',
    label: 'Jev Rerank',
    description: 'Rerank collected public-web passages by relevance with TypeSafe Jev when candidate prioritization would help. The runtime sends the supplied data to this external paid service only after full-payload user review and confirmation. Parent only: never send session, local, or private data, credentials, or authenticated-page content. Use English for question and criteria; preserve excerpts verbatim, including names, numbers, dates, and negation. This tool only ranks; it does not fetch, translate, delete, or verify truth. Inputs over 64KiB UTF-8 are rejected, not truncated. Returns bounded candidate IDs, scores, and usage, not source text. Never retry automatically; on not_ranked, keep the original order.',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 4000, description: 'English research question; exclude private context.' }),
      criteria: Type.String({ minLength: 1, maxLength: 4000, description: 'English relevance criteria; preserve distinctions such as planned versus completed.' }),
      candidates: Type.Array(Type.Object({
        id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Unique stable ID.' }),
        url: Type.String({ minLength: 1, maxLength: 2048, description: 'Public source URL; never local, signed, private, or authenticated.' }),
        title: Type.String({ minLength: 1, maxLength: 500 }),
        excerpt: Type.String({ minLength: 1, maxLength: LIMITS.excerptChars, description: 'Relevant verbatim passage with context; prefer about 2000 characters.' }),
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
