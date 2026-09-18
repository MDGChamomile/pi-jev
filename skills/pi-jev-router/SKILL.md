---
name: pi-jev-router
description: Use when the best primary handling route, active tool, specialist skill, or pi-subagent mode for the current task is genuinely ambiguous and a consent-gated TypeSafe Jev recommendation would materially help or is being evaluated. Skip obvious and simple tasks.
license: MIT
compatibility: Requires the companion pi-jev-router extension, an interactive Pi or compatible RPC approval UI, and an existing Python environment with the TypeSafe SDK.
---

# Pi Jev Router

Use this workflow only for a current task whose handling route is genuinely ambiguous or when the user is explicitly evaluating Jev routing. The companion `jev_route_task` tool returns advice; it does not execute anything.

## Decide

- Do not call Jev for an obvious route, a simple lookup, or a task the parent can handle confidently with ordinary reasoning.
- Do not use Jev to decide authorization, safety, privacy, destructive actions, production control, purchases, account changes, or whether a policy may be bypassed. Existing instructions and code-enforced boundaries always win.
- Do not call when the minimum useful payload would contain secrets, credentials, session history, private file contents, internal documents, signed URLs, authenticated-page content, or data the user is not authorized to disclose.
- Use at most one routing call for the current task. A failure or decline falls back to the normal parent workflow without retrying.

## Prepare and invoke

1. Write `task` in **English**. Faithfully preserve the current user's operative request, names, numbers, negation, scope, and plan-versus-execution distinctions. Do not paste prior conversation or add unrelated context.
2. If needed, write `constraints` in English using only material constraints already established for this task. Do not invent restrictions or include private evidence.
3. Call `jev_route_task`. The extension adds the current active tool and discovered skill names/descriptions, then shows the complete immutable payload for user review and asks for separate approval.
4. Do not use another translation service merely to prepare the payload. English is a caller contract; the extension does not detect or translate languages.

## Interpret

- `not_routed` means no recommendation was applied. Continue normally and do not retry automatically.
- `ok` is advisory. Read the primary route's full probabilities and confidence before the selected label. Confidence measures how concentrated the Choice distribution is, not whether the workflow is correct.
- Read `subagentPreset` and `parallelInvestigationProbability` only when a subagent route remains applicable after normal policy checks. A Noul probability near 0.5 means yes and no are similarly likely; it is not medium intensity and has no separate confidence.
- Read `primaryTool` and `specialistSkill` as candidate selections, not commands. Check that the capability is still available and allowed. Load a selected skill before following its instructions.
- If delegation remains appropriate, load and follow the installed `pi-subagent` skill. Its capability, scope, call-count, model, privacy, and result-handling contract remains authoritative.
- If browser interaction remains appropriate, follow the browser tool's authorization and verification rules. A Jev recommendation never authorizes an external action.
- Independent Jev questions can disagree. Ignore speculative answers on unused branches rather than forcing a coherent plan from every field.

For setup, data boundaries, output shape, and offline evaluation guidance, read the companion [extension guide](../../extensions/pi-jev-router/README.md).
