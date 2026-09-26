---
name: pi-jev
description: Use available TypeSafe Jev tools at two decision points without requiring the user to name Jev. Use jev_task_router before choosing among two or more unresolved, feasible research, comparison, or review workflows, or for explicit routing evaluation. Use jev_rerank after collecting multiple usable public passages, before reading all sources in depth, when reading order remains open. Use the applicable tool once, subject to data and consent boundaries; skip trivial tasks, settled routes, and sufficient evidence.
license: MIT
compatibility: Requires at least one companion Jev extension, an interactive Pi or compatible RPC approval UI, and a configured Pi OpenRouter provider.
---

# Pi Jev

Use this workflow to select among the available consent-gated TypeSafe Jev tools. The user does not need to mention Jev. When a decision point below applies, use the corresponding tool once; do not require a second, speculative estimate of a large benefit. These are advisory tools, not mandatory steps for every task.

## Select a tool

- Use `jev_task_router` at the planning stage of research, comparison, or review when two or more feasible workflow choices remain unresolved, before committing to one. Examples include parent-led versus delegated investigation, choosing between applicable specialist skills, or deciding whether independent tracks are useful. Merely having several tools available is not a workflow choice. Also use it for explicit routing evaluation. Otherwise skip trivial tasks, user-specified workflows, and settled routes.
- Use `jev_rerank` after collecting multiple usable public passages and before reading all candidate sources in depth, when their reading order remains open. Skip a single sufficient source, evidence that already answers the question, fully reviewed candidates, or passages with inadequate provenance or context. It ranks supplied passages; it does not search, fetch, verify truth, or write the answer.
- These decision points do not override data or consent boundaries. If a needed tool is inactive or a permitted payload cannot be prepared, continue with the normal workflow.
- Do not repeat a call for the same decision. Routing and later reranking may serve distinct decisions in one task. Never retry a declined or failed call automatically.

## Shared boundaries

- Jev advice never grants authorization or overrides safety, privacy, tool, browser, skill, or pi-subagent rules.
- Never use Jev to decide whether a restricted action is permitted or whether a policy may be bypassed.
- Prepare semantic instructions in English while faithfully preserving names, numbers, dates, negation, uncertainty, scope, and plan-versus-execution distinctions. Do not use another translation service merely to prepare a payload.
- Review the complete payload shown by the extension and obtain its separate approval before each paid OpenRouter request. A decline falls back to the normal workflow.
- Treat probabilities and confidence as advisory model outputs, not proof that a route or ranking is correct.

## Route tasks

When `jev_task_router` applies:

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
2. Write an English research question. Omit `criteria` for the default relevance standard, which prioritizes direct evidence over background while preserving dates, negation, uncertainty, planned versus completed actions, and contradictory evidence. Supply English criteria when the question needs a more specific standard, such as distinguishing planned, approved, and completed states. Empty or invalid criteria are not treated as omission.
3. Preserve each excerpt verbatim, including its original language, names, numbers, dates, quotations, negation, and uncertainty. Include enough surrounding context; do not blindly take the beginning of a page.
4. Never supply local or private material, credentials, session data, internal documents, signed URLs, or authenticated-page content. A public-looking URL does not make attached text public.
5. Call the tool once. On `not_ranked`, retain the original candidates and order without retrying; that order is not a relevance ranking. If the user requested reading only the top-ranked subset, disclose that no ranking was produced rather than treating the first input items as that subset. Use an alternative selection method only within the user's authorization; ask if changing the method would materially change the requested scope. Do not silently expand the reading limit.
6. On `ok`, use the result to prioritize reading; do not treat a low score as deletion or the ranking as authority or factual verification.

Use the shortest exact excerpts that preserve the context needed for relevance, including plan-versus-execution distinctions. A sufficient public search excerpt can be used; do not infer text from titles, pad to a target length, or read every source in depth just to prepare the call.

For the complete input limits, output shape, and data boundary, read the [`pi-jev-tools` extension guide](../../extensions/pi-jev-tools/README.md).
