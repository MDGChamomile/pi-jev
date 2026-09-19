---
name: pi-jev
description: Use available TypeSafe Jev tools without requiring the user to request Jev explicitly. Use jev_route_task when the best handling route is genuinely ambiguous, and jev_rerank when prioritizing already-collected public web passages would materially help. Skip simple or obvious tasks.
license: MIT
compatibility: Requires at least one companion Jev extension, an interactive Pi or compatible RPC approval UI, and a configured Pi OpenRouter provider.
---

# Pi Jev

Use this workflow to select among the available consent-gated TypeSafe Jev tools. The user does not need to mention Jev. Each tool is optional and advisory; use ordinary reasoning when its expected benefit is small.

## Select a tool

- Use `jev_route_task` when the best primary handling route, active tool, specialist skill, or pi-subagent mode for the current task is genuinely ambiguous. Skip obvious routes and simple lookups.
- Use `jev_rerank` only after collecting public web passages, when prioritizing those candidates by relevance would materially improve the investigation. It ranks supplied passages; it does not search, fetch, verify truth, or write the answer.
- Do not call a Jev tool merely because it is available. If a needed tool is inactive, continue with the normal workflow.
- Avoid multiple Jev calls for one task unless each call has a distinct, material purpose. Never retry a declined or failed call automatically.

## Shared boundaries

- Jev advice never grants authorization or overrides safety, privacy, tool, browser, skill, or pi-subagent rules.
- Never use Jev to decide whether a restricted action is permitted or whether a policy may be bypassed.
- Prepare semantic instructions in English while faithfully preserving names, numbers, dates, negation, uncertainty, scope, and plan-versus-execution distinctions. Do not use another translation service merely to prepare a payload.
- Review the complete payload shown by the extension and obtain its separate approval before each paid OpenRouter request. A decline falls back to the normal workflow.
- Treat probabilities and confidence as advisory model outputs, not proof that a route or ranking is correct.

## Route tasks

When `jev_route_task` applies:

1. Write `task` in English using only the current request and its operative details. Do not paste conversation history.
2. Add `constraints` only when material constraints are already established. Never include secrets, credentials, session history, private file contents, internal documents, signed URLs, authenticated-page content, or data the user is not authorized to disclose.
3. Call the tool at most once for the current task.
4. On `not_routed`, continue normally without retrying.
5. On `ok`, inspect the primary route's full probabilities and confidence. Use `subagentPreset` and `parallelInvestigationProbability` only if a subagent route remains applicable. Treat `primaryTool` and `specialistSkill` as candidates, then apply their own instructions and boundaries.
6. Ignore speculative answers for routes that are not used; independent Jev questions can disagree.

For the complete runtime contract and limitations, read the [`pi-jev-router` extension guide](../../extensions/pi-jev-router/README.md).

## Rerank public passages

When `jev_rerank` applies:

1. First collect 1–10 candidate passages from confirmed public HTTP(S) sources. Keep the original candidates available.
2. Write an English research question and relevance criteria. Distinguish important states such as planned, approved, and completed when applicable.
3. Preserve each excerpt verbatim, including its original language, names, numbers, dates, quotations, negation, and uncertainty. Include enough surrounding context; do not blindly take the beginning of a page.
4. Never supply local or private material, credentials, session data, internal documents, signed URLs, or authenticated-page content. A public-looking URL does not make attached text public.
5. Call the tool once. On `not_ranked`, retain the original order and continue without retrying.
6. Use the result to prioritize reading; do not treat a low score as deletion or the ranking as authority or factual verification.

For the complete input limits, output shape, and data boundary, read the [`pi-jev-tools` extension guide](../../extensions/pi-jev-tools/README.md).
