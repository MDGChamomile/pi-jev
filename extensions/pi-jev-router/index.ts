import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { Editor, truncateToWidth } from '@earendil-works/pi-tui';
import { createPayloadReviewer, createRunner, JevRouterError, LIMITS, runtimeSkillCatalog, TOOL_NAME } from './core.mjs';

const reviewPayload = createPayloadReviewer({ Editor, truncateToWidth });

function runtimeCatalog(pi: ExtensionAPI) {
  const active = new Set(pi.getActiveTools());
  const tools = pi.getAllTools()
    .filter(tool => active.has(tool.name) && tool.name !== TOOL_NAME)
    .map(tool => ({ name: tool.name, description: tool.description || 'No description provided.' }));
  const skills = runtimeSkillCatalog(pi.getCommands());
  return { tools, skills };
}

export default function (pi: ExtensionAPI) {
  const newRunner = () => createRunner({
    resolveApiKey: async (ctx: ExtensionContext) => (await ctx.modelRegistry.getProviderAuth('openrouter'))?.auth.apiKey,
    review: reviewPayload,
  });
  let runner = newRunner();
  pi.on('session_shutdown', () => runner.shutdown());
  pi.on('session_start', () => { runner.shutdown(); runner = newRunner(); });
  pi.registerCommand('jev-router-status', {
    description: 'Show in-memory router status without authentication or network access.',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const status = runner.getStatus();
      ctx.ui.notify([
        `Jev router: loaded / tool ${pi.getActiveTools().includes(TOOL_NAME) ? 'active' : 'inactive'}`,
        `Calls since session start/reload: ${status.calls}`,
        `Approved request attempts: ${status.requestAttempts} (delivery and billing unknown)`,
        `In flight: ${status.inFlight ? 'yes' : 'no'}; last completed result: ${status.lastResult}`,
        `Validated provider response observed: ${status.validatedResponseObserved ? 'yes (historical, not a current connection check)' : 'no (unverified)'}`,
      ].join('\n'), 'info');
    },
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: 'Jev Route Task',
    description: 'TypeSafe Jev advises on task, active-tool, specialist-skill, pi-subagent-preset, and parallel-investigation routing. Use once before choosing among 2+ unresolved, feasible research/comparison/review workflows (e.g. parent-led vs delegated); available tools alone do not qualify. Also use for explicit routing evaluation. Otherwise skip trivial tasks, user-specified workflows, and settled routes. External paid request: review the full payload and confirm before sending. Preserve operative details, names, numbers, negation, and scope. Never include secrets, credentials, session/local/private data, authenticated content, or unauthorized data. Jev neither executes nor authorizes actions. No retries; on not_routed continue normally.',
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        maxLength: LIMITS.taskChars,
        description: 'Current request in English; exclude history and unrelated context.',
      }),
      constraints: Type.Optional(Type.String({
        minLength: 1,
        maxLength: LIMITS.constraintsChars,
        description: 'Only established material constraints in English; exclude secrets and private content.',
      })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
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
