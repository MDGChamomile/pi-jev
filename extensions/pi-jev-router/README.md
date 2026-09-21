# Pi Jev Router — experimental advisory task routing

An optional `jev_route_task` tool for the **parent Pi agent**. It asks TypeSafe Jev through OpenRouter for one advisory primary route, one active tool, one discovered specialist skill, a pi-subagent preset, and the probability that independent parallel investigations would help. It does not execute a route, activate tools, load skills, create subagents, grant authorization, or enforce policy.

The shared [`pi-jev` skill](../../skills/pi-jev/README.md) describes when to select this tool or the separate [`jev_rerank`](../pi-jev-tools/README.md) public-passage reranker.

**Status:** experimental source implementation with offline tests and no live routing evaluation yet. Keep it only if representative comparisons show a net benefit over ordinary parent-agent reasoning.

## What it returns

One approved Jev request evaluates five independent questions over the same state:

1. primary route: `direct`, `local_subagent`, `web_subagent`, `browser_interaction`, `specialist_skill`, `clarify_with_user`, or `no_match`;
2. speculative pi-subagent preset: `lookup-standard`, `analysis-standard`, `review-standard`, or not applicable;
3. one active Pi tool, or none;
4. one discovered Pi skill, or none; and
5. a Noul probability that two or more independent subagent investigations would materially help.

Choice answers retain their probability distributions and confidence. The questions are independent, so the parent must ignore inapplicable speculative answers and reconcile disagreement. No automation threshold is supplied.

## Flow

1. The parent decides that comparing multiple plausible handling routes could materially improve the outcome or that routing quality should be evaluated explicitly; simple tasks and low-benefit calls skip Jev.
2. It supplies an English task description and optional constraints while omitting unrelated history.
3. The extension snapshots active tool and discovered skill names/descriptions. It does not read session history, files, skill bodies, or tool results.
4. It validates and displays the complete immutable payload for review. In the interactive TUI, submit the editor unchanged to continue; cancellation or edits stop without sending. In RPC mode, the host receives the exact payload in an abortable confirmation dialog.
5. A separate confirmation names OpenRouter, TypeSafe, the requested latest-model alias, request count, per-token price ceilings, absence of a hard total-cost cap, deadline, and data risks.
6. Only after approval does the extension resolve Pi's existing OpenRouter authentication and send one Decisions API request.
7. It validates typed judgments and maps opaque candidate IDs back to runtime names.
8. The parent applies existing authorization, safety, privacy, tool, skill, browser, and pi-subagent rules before acting.

## Requirements and use

- Node.js 22.22+ and Pi with `ctx.modelRegistry.getProviderAuth()` support.
- A configured Pi `openrouter` provider. The extension reuses Pi's resolved provider authentication; it does not read `models.json`, `auth.json`, environment variables, `.env`, or credential files itself.
- An interactive Pi UI, or an RPC host implementing confirmation dialogs. Print/JSON modes fail closed with `confirmation_unavailable`.
- Copy the shared `pi-jev` skill separately for automatic workflow guidance.

Load only this source extension:

```bash
pi -e ./live/extensions/pi-jev-router/index.ts
```

No Python interpreter, TypeSafe SDK, Jev-specific flag, or separate TypeSafe key is needed. Loading registers only `jev_route_task`, installs nothing, makes no startup request, and does not change active tools.

## Tool contract

```json
{
  "task": "Determine whether this request needs a focused public web investigation or can be answered directly.",
  "constraints": "Use current public sources. Do not access authenticated pages or local files."
}
```

- `task`: English routing description, 1–8,000 Unicode characters, representing only the current request.
- `constraints`: optional English text, 1–4,000 characters, containing only established material constraints.
- The extension adds up to 32 active tools and 32 discovered skills with names/descriptions. Larger catalogs and semantic payloads over 65,536 UTF-8 bytes are rejected, not truncated.
- The request uses OpenRouter's `~typesafe/jev-latest` alias, which redirects to the latest Jev-family model. It disables provider fallbacks, restricts routing to TypeSafe, and sets price caps of $0.042/M input tokens and $0/M output tokens.
- One approval still permits only one paid request, but OpenRouter does not provide a hard total-cost cap for a moving model alias. The confirmation therefore discloses this explicitly. If a future Jev version exceeds either per-token price ceiling, the request fails instead of using it. Taxes, currency conversion, and account-level billing behavior are outside this extension.
- One approval permits one request to `https://openrouter.ai/api/alpha/decisions`, with no retry and a 30-second HTTP deadline.

Success returns `status: "ok"`, the route and full probabilities, mapped tool/skill candidates, optional subagent preset, parallel-investigation probability, token usage, and an advisory limitation note. It also returns non-persistent call diagnostics: provider-call `elapsedMs`, serialized `inputBytes`, and `questionCount`. These fields are observations for comparison, not proof of quality or billing totals.

Failure or decline, including preflight validation failure, returns `status: "not_routed"` with a fixed code such as `invalid_input`, `invalid_candidate_catalog`, `candidate_catalog_too_large`, `input_too_large`, `declined`, `preview_changed`, `confirmation_unavailable`, `missing_key`, `authentication_failed`, `busy`, `rate_limited`, `timeout`, `cancelled`, `output_too_large`, `provider_error`, or `invalid_response`. Continue normally; do not retry automatically.

## Boundaries and limitations

- **English semantic input.** Preserve names, numbers, negation, uncertainty, scope, and plan-versus-execution distinctions. Do not use another translation provider merely to prepare a payload.
- **Reviewed request data, not public-only data.** Never include secrets, credentials, session history, private files, internal documents, signed URLs, authenticated-page content, or data the user is not authorized to disclose. Review is not DLP.
- **Metadata disclosure.** The payload contains active tool and discovered skill names/descriptions, which may come from project resources. Inspect them before approval.
- **No authority or execution.** Jev advice never authorizes restricted action. Availability can change after the snapshot; the parent must still follow each selected resource's contract.
- **Independent questions can disagree.** Consume only fields relevant to the chosen, policy-permitted route.
- **Candidate coverage matters.** Jev can select only included active tools and discovered skills.
- Authentication is resolved from Pi only after approval and sent only in the OpenRouter `Authorization` header. It is never accepted in tool input or returned.
- The endpoint is fixed and HTTP redirects are rejected. The extension makes no model-list request, shell call, child process, cache, or separate raw request/response log. Pi may retain ordinary tool arguments and results.
- Invisible Unicode format controls are visibly escaped in the review JSON without changing the text sent after approval. HTTP output is limited to 32KiB. Provider bodies and exception text are sanitized to fixed codes.
- Only one invocation can be pending per extension instance. Parent cancellation or session shutdown dismisses an active payload review, releases the invocation lock, and aborts an active HTTP request. Cancellation cannot retract accepted data or charges.
- Routing quality and calibration remain task-specific. The latest alias can move to a new Jev version; record the returned Jev-family model ID and reevaluate behavior after changes.

## Offline verification

From the repository root, without credentials or provider calls:

```bash
node --test live/extensions/pi-jev-router/tests/core.test.mjs
python3 -B .github/scripts/validate_skills.py
```

For TypeScript checking and offline Pi loading, provide existing package directories:

```bash
node live/extensions/pi-jev-router/tests/pi-check.mjs \
  /absolute/path/to/pi-coding-agent \
  /absolute/path/to/typescript
```

Tests use mocked HTTP responses and synthetic keys. They cover request construction, candidate mapping, size limits, preflight fallback, future Jev-family model names, current-context authentication, non-persistent call diagnostics, malformed replies, immutable review and approval, Pi-auth resolution failures, unchanged fallback, concurrency, single-call/no-retry behavior, HTTP status mapping, cancellation, deadline, bounded output, sanitized errors, and noninteractive refusal.

## Evaluation before automation

Start in advisory or shadow use and compare with the ordinary workflow on representative tasks. Measure route agreement with reviewed outcomes, important-route misses, unnecessary tool/skill/subagent calls, success, latency, and actual OpenRouter cost. Do not add silent calls, input hooks, private-data routing, or automatic execution merely because offline checks pass.

## References

- [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/decisions/create-decisions)
- [OpenRouter provider routing](https://openrouter.ai/docs/features/provider-routing)
- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)
- [Intent routing pattern](https://docs.typesafe.ai/patterns/intent-routing)
- [Confidence](https://docs.typesafe.ai/confidence)

MIT; keep the bundled [LICENSE](LICENSE) when copying the directory.
