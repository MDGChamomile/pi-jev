# Pi Jev — experimental advisory routing and public-passage reranking

Optional TypeSafe Jev tools for the **parent Pi agent**, called through OpenRouter after full-payload review and explicit confirmation. A shared [`pi-jev` skill](skills/pi-jev/README.md) lets the agent select an available tool without requiring the user to request Jev explicitly.

The skill currently covers:

- [`jev_route_task`](extensions/pi-jev-router/README.md) when comparing multiple plausible task, tool, skill, browser, and pi-subagent routes could materially improve the outcome, or when explicitly evaluating routing quality; and
- [`jev_rerank`](extensions/pi-jev-tools/README.md) for relevance ranking of already-collected public web passages.

The skill does not contact a provider. Each extension validates its own input, displays the complete payload, requires separate approval, resolves Pi's existing OpenRouter authentication, performs at most one paid request per invocation, and returns advisory output.

**Status:** experimental source implementations with offline tests. The router has no live routing evaluation yet; the reranker has not established Korean-language quality or improvements in accuracy, latency, or cost. Keep them only if representative comparisons show a net benefit over ordinary parent-agent reasoning.

## In action

This recording demonstrates the reranker's review-and-confirmation workflow on three public IANA passages:

![Jev's English payload-review and approval dialogs, followed by a reranking result and sourced answer](extensions/pi-jev-tools/assets/pi-jev-tools-demo.gif)

The recording predates the OpenRouter transport now used by the extension, so it is evidence for the interaction pattern rather than current provider compatibility, ranking quality, or latency. No private documents or personal sessions are used. It is not a demonstration of the router.

## Requirements and installation

- Node.js 22.22+ and Pi with `ctx.modelRegistry.getProviderAuth()` support. Offline loading/typechecking was checked with Pi 0.85.0.
- A configured Pi `openrouter` provider. The extensions reuse Pi's resolved provider authentication; they do not read `models.json`, `auth.json`, environment variables, `.env`, or credential files themselves.
- An interactive Pi UI, or an RPC host implementing confirmation dialogs. Print/JSON modes fail closed with `confirmation_unavailable`.
- The shared `pi-jev` skill for automatic workflow guidance.

Review the source and clone the repository:

```bash
git clone https://github.com/MDGChamomile/pi-jev.git
cd pi-jev
```

For a new source installation, copy the shared skill once and whichever Jev extensions you intend to expose. At least one extension is required. For an existing kit installation, first review the [migration guide](MIGRATION.md) rather than overlaying existing directories.

```bash
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
cp -R skills/pi-jev ~/.pi/agent/skills/
cp -R extensions/pi-jev-router ~/.pi/agent/extensions/   # optional
cp -R extensions/pi-jev-tools ~/.pi/agent/extensions/    # optional
```

No Python interpreter, TypeSafe SDK, Jev-specific flag, or separate TypeSafe key is needed at runtime. The extensions do not install dependencies and make no startup request. Do not add them to a subagent's tool list. Pi Subagent is not a runtime or development dependency; router preset names are advisory references only.

Restart Pi or use `/reload`. The model may load the skill automatically when an available Jev tool would materially help, or it can be invoked explicitly:

```text
/skill:pi-jev Decide whether an available Jev tool would help with this task.
```

To load only one source extension without copying it:

```bash
pi -e ./extensions/pi-jev-router/index.ts
# Or, for reranking only:
pi -e ./extensions/pi-jev-tools/index.ts
```

The [skill guide](skills/pi-jev/README.md) also explains migration from the former router-only skill and direct TypeSafe/Python setup. Source-copy installation remains the distribution method; this repository is not published as an npm package.

## Advisory task routing — `jev_route_task`

It asks TypeSafe Jev through OpenRouter for one advisory primary route, one active tool, one discovered specialist skill, a pi-subagent preset, and the probability that independent parallel investigations would help. It does not execute a route, activate tools, load skills, create subagents, grant authorization, or enforce policy.

### What it returns

One approved Jev request evaluates five independent questions over the same state:

1. primary route: `direct`, `local_subagent`, `web_subagent`, `browser_interaction`, `specialist_skill`, `clarify_with_user`, or `no_match`;
2. speculative pi-subagent preset: `lookup-standard`, `analysis-standard`, `review-standard`, or not applicable;
3. one active Pi tool, or none;
4. one discovered Pi skill, or none; and
5. a Noul probability that two or more independent subagent investigations would materially help.

Choice answers retain their probability distributions and confidence. The questions are independent, so the parent must ignore inapplicable speculative answers and reconcile disagreement. No automation threshold is supplied.

### Flow

1. The parent decides that comparing multiple plausible handling routes could materially improve the outcome or that routing quality should be evaluated explicitly; simple tasks and low-benefit calls skip Jev.
2. It supplies an English task description and optional constraints while omitting unrelated history.
3. The extension snapshots active tool and discovered skill names/descriptions. It does not read session history, files, skill bodies, or tool results.
4. It validates and displays the complete immutable payload for review. In the interactive TUI, submit the editor unchanged to continue; cancellation or edits stop without sending. In RPC mode, the host receives the exact payload in an abortable confirmation dialog.
5. A separate confirmation names OpenRouter, TypeSafe, the requested latest-model alias, request count, per-token price ceilings, absence of a hard total-cost cap, deadline, and data risks.
6. Only after approval does the extension resolve Pi's existing OpenRouter authentication and send one Decisions API request.
7. It validates typed judgments and maps opaque candidate IDs back to runtime names.
8. The parent applies existing authorization, safety, privacy, tool, skill, browser, and pi-subagent rules before acting.

### Tool contract

```json
{
  "task": "Determine whether this request needs a focused public web investigation or can be answered directly.",
  "constraints": "Use current public sources. Do not access authenticated pages or local files."
}
```

- `task`: English routing description, 1–8,000 Unicode characters, representing only the current request.
- `constraints`: optional English text, 1–4,000 characters, containing only established material constraints.
- The extension adds up to 32 active tools and 32 discovered skills with names/descriptions. Larger catalogs and semantic payloads over 65,536 UTF-8 bytes are rejected, not truncated.

Success returns `status: "ok"`, the route and full probabilities, mapped tool/skill candidates, optional subagent preset, parallel-investigation probability, token usage, and an advisory limitation note. Failure or decline, including preflight validation failure, returns `status: "not_routed"` with a fixed code. Continue normally; do not retry automatically.

See the [router guide](extensions/pi-jev-router/README.md) for the full contract, failure codes, and candidate/catalog limitations.

## Public-passage reranking — `jev_rerank`

It ranks already collected public web passages with TypeSafe Jev through OpenRouter, after full-payload review and explicit confirmation. It does not search, write answers, replace a model, or modify another extension.

### Flow

1. The parent collects public candidates with existing web tools.
2. It supplies an English question and criteria with original-language excerpts.
3. The tool validates the input, then shows the **entire immutable request**. In the interactive TUI it uses a scrollable editor that must be submitted unchanged; in RPC mode the host receives the exact payload in an abortable confirmation. Cancellation or edits stop without sending.
4. A separate confirmation names OpenRouter, TypeSafe, the requested latest-model alias, request count, per-token price ceilings, absence of a hard total-cost cap, and deadline.
5. Only after approval does the extension resolve Pi's existing OpenRouter authentication and send one Decisions API request.
6. Jev supplies one relevance Score per candidate. Code validates the response and sorts every ID by descending score; ties preserve input order.
7. The parent reads original sources and writes the final answer.

There is no automatic hook into web results, saved-response access, session/history collection, child-agent integration, or automatic retry.

### Tool contract

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

Jev receives the question, criteria, candidate IDs, URLs, titles, excerpts, and generated English Score questions. Four fixed levels distinguish no useful evidence, background only, partial evidence, and direct evidence. Contradictory evidence can score highly; source authority and truth are not scored.

Success returns `status: "ok"`, the requested latest alias and returned Jev-family model ID, original and ranked IDs, per-ID scores (0–3), confidence, probabilities, and token usage. Unrelated response fields and source text are not returned. Failure or decline, including preflight validation failure, returns `status: "not_ranked"`, a fixed code, and every recoverable original candidate ID in unchanged order. Continue with the original candidates; do not retry automatically.

See the [reranker guide](extensions/pi-jev-tools/README.md) for the full contract and failure codes. Reranking cannot recover omitted candidates and can misrank useful material. Keep the original candidates and never treat a low score as deletion.

## Boundaries and limitations

- **Advice, not authority.** Existing authorization, privacy, browser, tool, specialist-skill, and pi-subagent rules still determine what may happen. Availability can change after the router's snapshot; the parent must still follow each selected resource's contract.
- **English semantic input.** Preserve names, numbers, negation, uncertainty, scope, and plan-versus-execution distinctions. Do not use another translation provider merely to prepare a payload. Reranking excerpts retain their original language.
- **Router metadata disclosure.** The payload contains active tool and discovered skill names/descriptions, which may come from project resources. Inspect them before approval. Never include secrets, credentials, session history, private files, internal documents, signed URLs, authenticated-page content, or data the user is not authorized to disclose. Review is not DLP.
- **Public web data only for reranking**, including the question and criteria. URL checks reject obvious local/file/IP/credential-bearing sources but do not prove that content is public. The extension does not fetch URLs, verify provenance, or perform DLP. Candidate text is untrusted data, not instructions.
- **One request after approval.** Each invocation uses OpenRouter's `~typesafe/jev-latest` alias, disables provider fallbacks, restricts routing to TypeSafe, and sets price caps of $0.042/M input tokens and $0/M output tokens. There is no retry, and the HTTP deadline is 30 seconds. Review time is not part of that deadline.
- **No hard total-cost cap.** OpenRouter does not provide one for a moving model alias; confirmations disclose this explicitly. If a future Jev version exceeds either per-token price ceiling, the request fails instead of using it. Taxes, currency conversion, and account-level billing behavior are outside the extensions.
- **Credentials and transport.** Authentication is resolved from Pi only after approval and sent only in the OpenRouter `Authorization` header. The endpoint is fixed and HTTP redirects are rejected. The extensions make no model-list request, run no shell or child process, create no cache, and add no raw request/response log. Pi may retain ordinary tool arguments and results.
- **Bounded, sanitized output.** Invisible Unicode format controls are visibly escaped in review JSON without changing approved text. HTTP output is limited to 32KiB. Provider bodies and exception text are sanitized to fixed codes.
- **Cancellation and concurrency.** Only one invocation can be pending per extension instance. Parent cancellation or session shutdown dismisses an active payload review, releases the invocation lock, and aborts an active HTTP request. Cancellation cannot retract accepted data or charges.
- **Diagnostics are not quality evidence.** Successful calls also return non-persistent provider-call `elapsedMs`, serialized `inputBytes`, and `questionCount`. These observations are not proof of quality or billing totals. The latest alias can move to a new Jev version; record returned Jev-family model IDs and reevaluate behavior after changes.

## Offline verification

From the repository root, without credentials or provider calls:

```bash
node --test extensions/pi-jev-router/tests/core.test.mjs extensions/pi-jev-tools/tests/core.test.mjs
python3 -B .github/scripts/validate_skills.py
```

For all checks, including TypeScript checking and offline Pi loading, install this repository's locked development dependencies (accesses npm), then run:

```bash
npm ci --include=dev --ignore-scripts
npm run check
```

Tests use mocked HTTP responses and synthetic keys. They cover request construction and limits, candidate mapping and stable sorting, preflight fallbacks, immutable review and approval, current-context authentication, non-persistent call diagnostics, malformed replies, single-call/no-retry behavior, cancellation, deadlines, bounded output, sanitized errors, and noninteractive refusal.

The Pi check loads each extension separately, then verifies router-only, reranker-only, and combined source-copy installations with exactly one shared skill. It uses this repository's pinned Pi 0.85.0/TypeScript dependencies and isolated configuration, not a subagent checkout or active Pi settings. No model session or provider request is created.

## Evaluation before automation

For routing, start in advisory or shadow use and compare with the ordinary workflow on representative tasks. Measure route agreement with reviewed outcomes, important-route misses, unnecessary tool/skill/subagent calls, success, latency, and actual OpenRouter cost. Do not add silent calls, input hooks, private-data routing, or automatic execution merely because offline checks pass.

For reranking, with separate authorization, compare representative public/synthetic tasks with and without reranking. Measure useful-evidence coverage, important evidence demotion, source reads, latency, token use, and actual OpenRouter cost. Record returned model IDs. Do not widen this into automatic calls or private-data workflows merely because offline checks pass.

## Documentation

- [Router guide](extensions/pi-jev-router/README.md)
- [Reranker guide](extensions/pi-jev-tools/README.md)
- [Shared skill guide](skills/pi-jev/README.md) and [workflow](skills/pi-jev/SKILL.md)
- [Migration](MIGRATION.md)
- [Contributing](CONTRIBUTING.md)
- [Design principles](PRINCIPLE.md)

## References

- [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/decisions/create-decisions)
- [OpenRouter provider routing](https://openrouter.ai/docs/features/provider-routing)
- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)
- [TypeSafe Score](https://docs.typesafe.ai/primitives/score)
- [Intent routing pattern](https://docs.typesafe.ai/patterns/intent-routing)
- [Reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe)
- [Models and limitations](https://docs.typesafe.ai/models)
- [Confidence](https://docs.typesafe.ai/confidence)

## License

[MIT](LICENSE). Keep the bundled license notices when copying or redistributing the skill and extensions.
