# Pi Jev Tools — experimental public-passage reranking

An optional `jev_rerank` tool for the **parent Pi agent**. It ranks already collected public web passages with TypeSafe Jev through OpenRouter, after full-payload review and explicit confirmation. It does not search, write answers, replace a model, or modify another extension. The shared [`pi-jev` skill](../../skills/pi-jev/README.md) lets the agent select this tool without requiring the user to request Jev explicitly.

**Status:** experimental source implementation with offline tests. It has not established Korean-language quality or improvements in accuracy, latency, or cost. Start small and compare it against the ordinary workflow.

## In action

This recording demonstrates the review-and-confirmation workflow on three public IANA passages:

![Jev's English payload-review and approval dialogs, followed by a reranking result and sourced answer](assets/pi-jev-tools-demo.gif)

The recording predates the OpenRouter transport now used by the extension, so it is evidence for the interaction pattern rather than current provider compatibility, ranking quality, or latency. No private documents or personal sessions are used.

Use Jev once after collecting multiple usable public passages, before reading all candidate sources in depth, when reading order remains open. Skip a single sufficient source, evidence that already answers the question, fully reviewed candidates, or passages with inadequate provenance or context. Data and consent boundaries still apply.

## Flow

1. The parent collects public candidates with existing web tools.
2. It supplies an English question, optional question-specific criteria, and original-language excerpts. Omitted criteria use the documented default relevance standard.
3. The tool validates the input, then shows the **entire immutable request**. In the interactive TUI it uses a scrollable editor that must be submitted unchanged; in RPC mode the host receives the exact payload in an abortable confirmation. Cancellation or edits stop without sending.
4. A separate confirmation names OpenRouter, TypeSafe, the requested latest-model alias, request count, per-token price ceilings, absence of a hard total-cost cap, and deadline.
5. Only after approval does the extension resolve Pi's existing OpenRouter authentication and send one Decisions API request.
6. Jev supplies one relevance Score per candidate. Code validates the response and sorts every ID by descending score; ties preserve input order.
7. The parent reads original sources and writes the final answer.

There is no automatic hook into web results, saved-response access, session/history collection, child-agent integration, or automatic retry.

## Requirements and use

- Node.js 22.22+ and Pi with `ctx.modelRegistry.getProviderAuth()` support. Offline loading/typechecking was checked with Pi 0.85.0.
- A configured Pi `openrouter` provider. The extension reuses Pi's resolved provider authentication; it does not read `models.json`, `auth.json`, environment variables, `.env`, or credential files itself.
- An interactive Pi UI, or an RPC host implementing confirmation dialogs. Print/JSON mode fails closed with `confirmation_unavailable`.

Load only this source extension:

```bash
pi -e ./extensions/pi-jev-tools/index.ts
```

No Python interpreter, TypeSafe SDK, Jev-specific flag, or separate TypeSafe key is needed. Loading registers the `jev_rerank` tool and `/jev-rerank-status` command, installs nothing, and makes no startup request. Do not add it to a subagent's tool list.

## Session status

Run `/jev-rerank-status` to see whether the tool is currently active, calls received by its runner, approved request attempts, whether a call is pending, and the last completed result (`ok` or a fixed failure code). It also reports whether a validated provider response has been observed in this session runtime, not whether the provider is currently reachable.

This command never resolves authentication or sends a request. Request attempts are counted just before transport is invoked after approval and authentication; they do not prove delivery or billing. A decline or missing key adds a call but no request attempt. A rejected concurrent call counts as `busy`; the last result follows completion order while the pending call remains visible.

Only counters, a fixed result code, and flags are kept in memory. No payload, response body, credential, or session history is added to a log. Counters reset on session start, switch, resume, fork, or reload; they are not reconstructed from history or rewound by tree navigation. The router uses a separate `/jev-router-status` command, so either extension can be installed alone. Status notifications require an interactive UI or compatible RPC host.

## Tool contract

```json
{
  "question": "Has the company completed its treasury-share cancellation?",
  "criteria": "Prioritize passages that establish execution status. Distinguish plans, board approval, and completed cancellation. Evidence of non-completion is relevant too.",
  "candidates": [
    {
      "id": "source_1",
      "url": "https://example.com/public-announcement",
      "title": "Synthetic public announcement example",
      "excerpt": "이사회는 다음 달 자사주를 소각하기로 결의했다."
    }
  ]
}
```

The example is synthetic. For real use, supply confirmed public URLs and accurate excerpts.

- `question`: required English research question, at most 4,000 Unicode characters.
- `criteria`: optional English relevance criteria, at most 4,000 Unicode characters. Omit it for the default below; provide it for a question-specific standard. Existing valid explicit criteria are sent unchanged. Only omission uses the default: empty/whitespace-only strings, `null`, and other invalid values are rejected.
- Candidates: 1–10; unique IDs matching `[A-Za-z0-9_-]{1,64}`; public HTTP(S) URL up to 2,048 characters; title up to 500 characters; excerpt up to 4,000 characters.
- Use the shortest exact excerpts that preserve enough context for relevance, including negation, uncertainty, names, numbers, dates, quotes, and plan/execution distinctions. A sufficient public search excerpt can be used. Do not infer text from titles, pad excerpts to a target length, or read every source in depth merely to prepare a ranking request. The 1–10 candidate contract remains valid, but skip calls with no reading-priority decision to make.
- The constructed request, including generated questions, must fit **65,536 UTF-8 bytes**. Nothing is truncated or split into batches.
- The request uses OpenRouter's `~typesafe/jev-latest` alias, which redirects to the latest Jev-family model. It disables provider fallbacks, restricts routing to TypeSafe, and sets price caps of $0.042/M input tokens and $0/M output tokens.
- One approval still permits only one paid request, but OpenRouter does not provide a hard total-cost cap for a moving model alias. The confirmation therefore discloses this explicitly. If a future Jev version exceeds either per-token price ceiling, the request fails instead of using it. Taxes, currency conversion, and account-level billing behavior are outside this extension.
- One approval permits one request to `https://openrouter.ai/api/alpha/decisions`, with no retry and a 30-second HTTP deadline. Review time is not part of that deadline.

When `criteria` is omitted, the extension uses this exact default:

> Prioritize evidence that directly addresses the question. Distinguish useful background from resolving evidence. Preserve dates, negation, uncertainty, and planned versus completed actions. Contradictory evidence remains relevant.

The default is included in the final payload before size validation, full-payload review, and separate approval. It is not added after approval. Generated questions and the resolved criteria all count toward the 65,536-byte request limit. Unknown input fields and incomplete candidate objects remain invalid.

Jev receives the question, resolved criteria, candidate IDs, URLs, titles, excerpts, and generated English Score questions. Four fixed levels distinguish no useful evidence, background only, partial evidence, and direct evidence. Contradictory evidence can score highly; source authority and truth are not scored.

Success returns `status: "ok"`, the requested latest alias and returned Jev-family model ID, original and ranked IDs, per-ID scores (0–3), confidence, probabilities, and token usage. It also returns non-persistent call diagnostics: provider-call `elapsedMs`, serialized `inputBytes`, and `questionCount`. These fields are observations for comparison, not proof of quality or billing totals. Unrelated response fields and source text are not returned.

Failure or decline, including preflight validation failure, returns `status: "not_ranked"`, a fixed code, and every recoverable original candidate ID in unchanged order. Codes include `invalid_input`, `invalid_candidate_id`, `invalid_source_url`, `input_too_large`, `declined`, `preview_changed`, `missing_key`, `authentication_failed` (HTTP 401 or authentication lookup failure), `payment_required` (HTTP 402), `request_forbidden` (HTTP 403; access or policy refusal, not necessarily invalid credentials), `confirmation_unavailable`, `busy`, `rate_limited`, `timeout`, `cancelled`, `output_too_large`, `provider_error`, and `invalid_response`. Continue with the original candidates; do not retry automatically.

When supplied as a finite, non-negative number, optional `usage.cost` preserves the provider-reported call cost in USD, including zero. Missing or invalid cost values are omitted without rejecting an otherwise valid result. This is not a final bill, a preflight spending cap, or a complete accounting of failed calls; taxes, currency conversion, and account-level billing are not represented. No additional request or persistent log is created.

## Boundaries and limitations

- **Public web data only**, including the question and criteria. Never send session contents, session-search output, local code, private notes, internal documents, signed URLs, credentials, or authenticated-page excerpts.
- URL checks reject obvious local/file/IP/credential-bearing sources but do not prove that content is public. The extension does not fetch URLs, verify provenance, or perform DLP.
- Candidate text is untrusted data, not instructions. Jev is neither a security boundary nor an authorization judge.
- Authentication is resolved from Pi only after approval and is sent only in the OpenRouter `Authorization` header. It is never accepted as a tool argument or returned in results.
- The endpoint is fixed and HTTP redirects are rejected. The extension makes no model-list request, runs no shell or child process, creates no cache, and adds no raw request/response log. Pi may retain ordinary tool arguments and results in session history.
- Invisible Unicode format controls are visibly escaped in the review JSON without changing the text sent after approval. HTTP output is limited to 32KiB. Raw provider bodies and exception text are never returned to the model.
- Only one invocation can be pending per extension instance. Shutdown or parent cancellation dismisses an active payload review, stops waiting for Pi authentication, releases the invocation lock, and aborts the HTTP request. A late authentication result is ignored, but cancellation cannot retract accepted data or charges.
- Byte limits are not exact tokenizer limits. A request can still exceed provider limits and fail without retry.
- Reranking cannot recover omitted candidates and can misrank useful material. Keep the original candidates and never treat a low score as deletion.

## Offline verification

From the repository root, without credentials or provider calls:

```bash
node --test extensions/pi-jev-tools/tests/core.test.mjs
```

For TypeScript checking and offline Pi loading, install this repository's locked development dependencies (accesses npm), then run:

```bash
npm ci --include=dev --ignore-scripts
npm run check:pi
```

This checks each extension separately and all three source-copy installation combinations with exactly one shared skill. It uses no subagent checkout or active Pi configuration. The standalone `tests/pi-check.mjs` also accepts explicit Pi and TypeScript package directories.

Tests use mocked HTTP responses and synthetic keys. They cover request limits and immutability, preflight order-preserving fallback, future Jev-family model names, current-context authentication and cancellation, non-persistent call diagnostics, response validation, stable sorting, abortable review and approval gates, Pi-auth resolution failures, single-call/no-retry behavior, HTTP status mapping, deadline, bounded output, sanitized errors, and noninteractive refusal.

## Opt-in evaluation

With separate authorization, compare representative public/synthetic tasks with and without reranking. Measure useful-evidence coverage, important evidence demotion, source reads, latency, token use, and actual OpenRouter cost. Record returned model IDs. Do not widen this into automatic calls or private-data workflows merely because offline checks pass.

## References

- [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/decisions/create-decisions)
- [OpenRouter provider routing](https://openrouter.ai/docs/features/provider-routing)
- [TypeSafe Score](https://docs.typesafe.ai/primitives/score)
- [Reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe)
- [Models and limitations](https://docs.typesafe.ai/models)

MIT; keep the bundled `LICENSE` when copying the directory.
