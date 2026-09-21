import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { Editor, truncateToWidth } from '@earendil-works/pi-tui';
import { createPayloadReviewer, createRunner, isJevWorkflowSkill, JevRouterError, LIMITS, TOOL_NAME } from './core.mjs';

const reviewPayload = createPayloadReviewer({ Editor, truncateToWidth });

function runtimeCatalog(pi: ExtensionAPI) {
  const active = new Set(pi.getActiveTools());
  const tools = pi.getAllTools()
    .filter(tool => active.has(tool.name) && tool.name !== TOOL_NAME)
    .map(tool => ({ name: tool.name, description: tool.description || 'No description provided.' }));
  const skills = pi.getCommands()
    .filter(command => command.source === 'skill' && !isJevWorkflowSkill(command.name))
    .map(command => ({ name: command.name, description: command.description || 'No description provided.' }));
  return { tools, skills };
}

export default function (pi: ExtensionAPI) {
  let runner: ReturnType<typeof createRunner> | undefined;
  pi.on('session_shutdown', () => runner?.shutdown());

  pi.registerTool({
    name: TOOL_NAME,
    label: 'Jev Route Task',
    description: 'Ask TypeSafe Jev for advisory task, active-tool, specialist-skill, pi-subagent-preset, and parallel-investigation routing when comparing multiple plausible handling routes could materially improve the outcome or when explicitly evaluating routing quality; skip simple tasks and low-benefit calls. External paid request: write task and constraints in English, review the full payload, and confirm before sending. Preserve operative details, names, numbers, negation, and scope. Never include secrets, credentials, session/local/private data, authenticated content, or unauthorized data. Jev neither executes nor authorizes actions. One request; no retries. On not_routed continue normally.',
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        maxLength: LIMITS.taskChars,
        description: 'Current request in English. Preserve operative details, names, numbers, negation, and scope; exclude history and unrelated context.',
      }),
      constraints: Type.Optional(Type.String({
        minLength: 1,
        maxLength: LIMITS.constraintsChars,
        description: 'Only established material constraints in English; exclude secrets and private content.',
      })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      runner ??= createRunner({
        resolveApiKey: async (currentCtx: typeof ctx) => (await currentCtx.modelRegistry.getProviderAuth('openrouter'))?.auth.apiKey,
        review: reviewPayload,
      });
      try {
        // Resource-loader smoke tests and noninteractive modes have no live session catalog.
        // They fail closed before any provider call, so avoid querying session-bound APIs there.
        const catalog = ctx.hasUI ? runtimeCatalog(pi) : { tools: [], skills: [] };
        const result = await runner.execute(params, catalog, signal, ctx);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      } catch (error) {
        throw new Error(error instanceof JevRouterError ? `${TOOL_NAME}: ${error.code}` : `${TOOL_NAME}: internal_error`);
      }
    },
  });
}
