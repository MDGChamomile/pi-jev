# Pi Jev Tools — experimental public-passage reranking

An optional `jev_rerank` tool for the **parent Pi agent**. It ranks already collected public web passages with TypeSafe Jev through OpenRouter, after full-payload review and explicit confirmation. It does not search, write answers, replace a model, or modify another extension. The shared [`pi-jev` skill](../../skills/pi-jev/README.md) lets the agent select this tool without requiring the user to request Jev explicitly.

**Status:** experimental source implementation with offline tests. It has not established Korean-language quality or improvements in accuracy, latency, or cost. Start small and compare it against the ordinary workflow.

## In action

This recording demonstrates the review-and-confirmation workflow on three public IANA passages:

![Jev's English payload-review and approval dialogs, followed by a reranking result and sourced answer](assets/pi-jev-tools-demo.gif)

The recording predates the OpenRouter transport and pinned model now used by the extension, so it is evidence for the interaction pattern rather than current provider compatibility, ranking quality, or latency. No private documents or personal sessions are used.

## Flow

1. The parent collects public candidates with existing web tools.
2. It supplies an English question and criteria with original-language excerpts.
3. The tool validates the input, then shows the **entire immutable request** in a scrollable editor. Submit it unchanged to continue; cancel or edit it to stop.
4. A separate confirmation names OpenRouter, TypeSafe, the pinned model, request count, maximum model charge, and deadline.
5. Only after approval does the extension resolve Pi's existing OpenRouter authentication and send one Decisions API request.
6. Jev supplies one relevance Score per candidate. Code validates the response and sorts every ID by descending score; ties preserve input order.
7. The parent reads original sources and writes the final answer.

There is no automatic hook into web results, saved-response access, session/history collection, child-agent integration, or automatic retry.

## Requirements and use

- Node.js 22.22+ and Pi with `ctx.modelRegistry.getProviderAuth()` support. Offline loading/typechecking was checked with Pi 0.85.0.
- A configured Pi `openrouter` provider. The extension reuses Pi's resolved provider authentication; it does not read `models.json`, `auth.json`, environment variables, `.env`, or credential files itself.
- An interactive Pi UI, or an RPC host implementing both editor and confirmation dialogs. Print/JSON mode fails closed with `confirmation_unavailable`.

Load only this source extension:

```bash
pi -e ./live/extensions/pi-jev-tools/index.ts
```

No Python interpreter, TypeSafe SDK, Jev-specific flag, or separate TypeSafe key is needed. Loading registers only `jev_rerank`, installs nothing, and makes no startup request. Do not add it to a subagent's tool list.

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

- `question` / `criteria`: English instructions, at most 4,000 Unicode characters each.
- Candidates: 1–10; unique IDs matching `[A-Za-z0-9_-]{1,64}`; public HTTP(S) URL up to 2,048 characters; title up to 500 characters; excerpt up to 4,000 characters.
- Prefer excerpts around 2,000 characters. Preserve context, negation, uncertainty, names, numbers, dates, quotes, and plan/execution distinctions.
- The constructed request, including generated questions, must fit **65,536 UTF-8 bytes**. Nothing is truncated or split into batches.
- The request pins `typesafe/jev-1.13`, disables fallbacks, restricts routing to TypeSafe, and sets OpenRouter provider price caps of $0.042/M input tokens and $0/M output tokens.
- With Jev's 32K context, those enforced caps bound the listed model charge for one approved request to **US$0.001344**. Taxes, currency conversion, and account-level billing behavior are outside this extension.
- One approval permits one request to `https://openrouter.ai/api/alpha/decisions`, with no retry and a 30-second HTTP deadline. Review time is not part of that deadline.

Jev receives the question, criteria, candidate IDs, URLs, titles, excerpts, and generated English Score questions. Four fixed levels distinguish no useful evidence, background only, partial evidence, and direct evidence. Contradictory evidence can score highly; source authority and truth are not scored.

Success returns `status: "ok"`, requested and returned model IDs, original and ranked IDs, per-ID scores (0–3), confidence, probabilities, and token usage. Unrelated response fields and source text are not returned.

Failure or decline returns `status: "not_ranked"`, a fixed code, and unchanged IDs. Codes include `declined`, `preview_changed`, `missing_key`, `authentication_failed`, `confirmation_unavailable`, `busy`, `rate_limited`, `timeout`, `cancelled`, `output_too_large`, `provider_error`, and `invalid_response`. Continue with the original candidates; do not retry automatically.

## Boundaries and limitations

- **Public web data only**, including the question and criteria. Never send session contents, session-search output, local code, private notes, internal documents, signed URLs, credentials, or authenticated-page excerpts.
- URL checks reject obvious local/file/IP/credential-bearing sources but do not prove that content is public. The extension does not fetch URLs, verify provenance, or perform DLP.
- Candidate text is untrusted data, not instructions. Jev is neither a security boundary nor an authorization judge.
- Authentication is resolved from Pi only after approval and is sent only in the OpenRouter `Authorization` header. It is never accepted as a tool argument or returned in results.
- The endpoint is fixed and HTTP redirects are rejected. The extension makes no model-list request, runs no shell or child process, creates no cache, and adds no raw request/response log. Pi may retain ordinary tool arguments and results in session history.
- Invisible Unicode format controls are visibly escaped in the review JSON without changing the text sent after approval. HTTP output is limited to 32KiB. Raw provider bodies and exception text are never returned to the model.
- Only one invocation can be pending per extension instance. Shutdown or parent cancellation aborts the HTTP request, but cannot retract accepted data or charges.
- Byte limits are not exact tokenizer limits. A request can still exceed provider limits and fail without retry.
- Reranking cannot recover omitted candidates and can misrank useful material. Keep the original candidates and never treat a low score as deletion.

## Offline verification

From the repository root, without credentials or provider calls:

```bash
node --test live/extensions/pi-jev-tools/tests/core.test.mjs
```

For TypeScript checking and offline Pi loading, provide existing package directories:

```bash
node live/extensions/pi-jev-tools/tests/pi-check.mjs \
  /absolute/path/to/pi-coding-agent \
  /absolute/path/to/typescript
```

Tests use mocked HTTP responses and synthetic keys. They cover request limits and immutability, response validation, stable sorting, review and approval gates, Pi-auth resolution failures, single-call/no-retry behavior, HTTP status mapping, cancellation, deadline, bounded output, sanitized errors, and noninteractive refusal.

## Opt-in evaluation

With separate authorization, compare representative public/synthetic tasks with and without reranking. Measure useful-evidence coverage, important evidence demotion, source reads, latency, token use, and actual OpenRouter cost. Record returned model IDs. Do not widen this into automatic calls or private-data workflows merely because offline checks pass.

## References

- [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/decisions/create-decisions)
- [OpenRouter provider routing](https://openrouter.ai/docs/features/provider-routing)
- [TypeSafe Score](https://docs.typesafe.ai/primitives/score)
- [Reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe)
- [Models and limitations](https://docs.typesafe.ai/models)

MIT; keep the bundled `LICENSE` when copying the directory.
