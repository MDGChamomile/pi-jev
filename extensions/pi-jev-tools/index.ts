import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { fileURLToPath } from 'node:url';
import { createRunner, JevError, LIMITS } from './core.mjs';

export default function (pi: ExtensionAPI) {
  pi.registerFlag('jev-python', {
    description: 'Absolute path to an existing Python interpreter with typesafe-sdk installed. No automatic installation or .env loading.',
    type: 'string', default: '',
  });
  let runner: ReturnType<typeof createRunner> | undefined;
  pi.on('session_shutdown', () => runner?.shutdown());
  pi.registerTool({
    name: 'jev_rerank',
    label: 'Jev Rerank',
    description: 'Optionally rerank already collected PUBLIC WEB passages by relevance using TypeSafe Jev. Sends the supplied question, criteria, URLs, titles and excerpts to an external paid service only after full-payload user review and confirmation. Parent-only workflow: do not delegate this tool to subagents. Never supply session data, internal/local material, credentials or authenticated-page content, even with a public URL attached. Write question and criteria in English; preserve original excerpts, names, numbers, dates and negation. Use only when prioritizing many candidates may help. No fetching, translation, deletion, truth verification, or automatic retries. Up to 10 candidates, 4000 Unicode characters per excerpt (prefer about 2000), 64KiB UTF-8 including generated request instructions. Oversized inputs are rejected, not truncated. Returns bounded scores/IDs and token usage, not source text. On not_ranked continue with original candidates; do not retry automatically.',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 4000, description: 'English research question. Do not include private user context.' }),
      criteria: Type.String({ minLength: 1, maxLength: 4000, description: 'English relevance criteria shared by all candidates. Include important distinctions such as planned versus completed.' }),
      candidates: Type.Array(Type.Object({
        id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$', description: 'Unique stable ID.' }),
        url: Type.String({ minLength: 1, maxLength: 2048, description: 'Public source URL, not a local, signed, private or authenticated URL.' }),
        title: Type.String({ minLength: 1, maxLength: 500 }),
        excerpt: Type.String({ minLength: 1, maxLength: LIMITS.excerptChars, description: 'Relevant verbatim public passage with enough context; do not blindly take the first characters.' }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: LIMITS.candidates }),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      runner ??= createRunner({
        python: String(pi.getFlag('jev-python') ?? ''),
        adapter: fileURLToPath(new URL('./adapter.py', import.meta.url)),
      });
      try {
        const result = await runner.execute(params, signal, ctx);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      } catch (error) {
        // Never expose SDK/OS exception messages or input excerpts.
        throw new Error(error instanceof JevError ? `jev_rerank: ${error.code}` : 'jev_rerank: internal_error');
      }
    },
  });
}
