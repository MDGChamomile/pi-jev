import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { createRunner, isJevWorkflowSkill, JevRouterError, LIMITS, TOOL_NAME } from './core.mjs';

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
    description: 'Optionally ask TypeSafe Jev for an advisory primary route, active tool, specialist skill, pi-subagent preset, and probability that independent parallel investigations would help. Use only when the route is genuinely ambiguous or worth measuring; skip obvious/simple tasks. Write the task and constraints in English while preserving operative details, names, numbers, negation, and scope. Sends only those fields plus active tool and discovered skill names/descriptions after full-payload user review and separate confirmation. Never include secrets, credentials, session history, private file contents, authenticated-page content, or data the user is not authorized to disclose. Jev does not execute tools, load skills, create subagents, grant authorization, or enforce safety policy. One paid request, no retries. On not_routed continue normally without retrying.',
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        maxLength: LIMITS.taskChars,
        description: 'English description of the current user request. Preserve operative details, names, numbers, negation, and scope; do not include prior session content or unrelated context.',
      }),
      constraints: Type.Optional(Type.String({
        minLength: 1,
        maxLength: LIMITS.constraintsChars,
        description: 'English statement of only material constraints already established for this task, such as read-only scope or required source type. Do not add secrets or private content.',
      })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      runner ??= createRunner({
        resolveApiKey: async () => (await ctx.modelRegistry.getProviderAuth('openrouter'))?.auth.apiKey,
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
