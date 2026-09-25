# Pi Jev

[![Offline validation](https://github.com/MDGChamomile/pi-jev/actions/workflows/validation.yml/badge.svg?branch=main)](https://github.com/MDGChamomile/pi-jev/actions/workflows/validation.yml)
[![Latest source release](https://img.shields.io/github/v/release/MDGChamomile/pi-jev?label=source%20release)](https://github.com/MDGChamomile/pi-jev/releases/latest)
[![License](https://img.shields.io/github/license/MDGChamomile/pi-jev)](LICENSE)

> Consent-gated TypeSafe Jev advice for the [Pi coding agent](https://github.com/earendil-works/pi): choose a task route or rank public web passages without handing over control.

Pi Jev provides two optional, independently installable tools for the **parent Pi agent** and one shared skill that helps decide when to use them. Each tool makes at most one approved request through OpenRouter. Jev returns advice, not an executed route, verified evidence, or authorization.

**Status:** an experimental Git-installable Pi package with offline tests, not published to npm. The router has no live routing evaluation yet, and the reranker has not established Korean-language quality or improvements in accuracy, latency, or cost. Keep them only if representative comparisons show a net benefit over ordinary parent-agent reasoning.

### See the review flow

![Reranker demo: payload review, separate approval, ranked passages, and the parent's sourced answer](extensions/pi-jev-tools/assets/pi-jev-tools-demo.gif)

*Reranker interaction recording only.* It predates the current OpenRouter transport; it shows the review-and-confirmation pattern, not current provider compatibility or measured quality.

## Choose a tool

| Tool | Use it when | It does not |
|---|---|---|
| [`jev_task_router`](extensions/pi-jev-router/README.md) | Two or more feasible research, comparison, or review workflows remain unresolved, before choosing one; also for explicit routing evaluation. | Execute a route, activate tools, load skills, create subagents, or authorize actions. |
| [`jev_rerank`](extensions/pi-jev-tools/README.md) | Multiple usable public passages have been collected and reading order remains open, before reading all candidate sources in depth. | Search, fetch or verify sources, judge source authority, remove candidates, or write the answer. |

The shared [`pi-jev` skill](skills/pi-jev/README.md) teaches the parent agent when to use either available tool without requiring the user to name Jev. At these decision points, use the applicable tool once, subject to data and consent boundaries, without an additional speculative large-benefit test. Skip trivial tasks, user-specified or settled routes, and sufficient or fully reviewed evidence. Merely having several tools available does not justify routing. The skill itself does not contact a provider.

**Flow:** parent identifies an applicable decision point → you review the full payload and separately approve one request → Jev returns bounded advice → parent verifies sources and decides what to do. No automatic routing or answer-writing follows.

## Requirements and installation

- Node.js 22.22+ and Pi with `ctx.modelRegistry.getProviderAuth()` support. Offline loading and typechecking are pinned to Pi 0.85.0.
- A configured Pi `openrouter` provider. The extensions reuse Pi's resolved authentication and do not read credential files or environment variables themselves.
- An interactive Pi UI, or an RPC host implementing confirmation dialogs. Noninteractive modes fail closed.

Review the source, then install the single Pi package (both extensions and the shared skill):

```bash
pi install git:github.com/MDGChamomile/pi-jev
```

This unpinned source follows the repository's default branch. To update all three resources together:

```bash
pi update --extension git:github.com/MDGChamomile/pi-jev
```

Restart Pi or use `/reload` after updating. Use `pi config` to select which extensions and skills load. Existing copied or symlinked resources are not automatically removed: follow [`MIGRATION.md`](MIGRATION.md) before switching to avoid duplicates. A local development checkout is separate from this installation; uncommitted development edits do not update it.

Alternatively, preserve independent source-copy installation by copying the shared skill once and whichever extensions you need:

```bash
git clone https://github.com/MDGChamomile/pi-jev.git
cd pi-jev
mkdir -p ~/.pi/agent/extensions ~/.pi/agent/skills
cp -R skills/pi-jev ~/.pi/agent/skills/
cp -R extensions/pi-jev-router ~/.pi/agent/extensions/   # optional
cp -R extensions/pi-jev-tools ~/.pi/agent/extensions/    # optional
```

Restart Pi or use `/reload`. For an existing kit installation, follow [`MIGRATION.md`](MIGRATION.md) instead of overlaying old directories. Do not add Jev tools to a subagent's tool list.

To load one extension directly without copying it:

```bash
pi -e ./extensions/pi-jev-router/index.ts
# Or:
pi -e ./extensions/pi-jev-tools/index.ts
```

Git-package and independent source-copy installations are supported; this repository is not published to npm. No Python interpreter, TypeSafe SDK, Jev-specific flag, or separate TypeSafe key is required at runtime.

## External transmission, consent, and cost

For every invocation, the selected extension:

1. validates and snapshots the semantic request;
2. displays the complete immutable JSON payload for review;
3. requires a separate confirmation naming OpenRouter, TypeSafe, the request limit, price ceilings, deadline, and data risks;
4. resolves Pi's current OpenRouter authentication only after approval; and
5. sends at most one request, with no automatic retry.

The fixed endpoint is `https://openrouter.ai/api/alpha/decisions`. Requests use the moving `~typesafe/jev-latest` alias, disable provider fallbacks, restrict routing to TypeSafe, set price ceilings of **$0.042/M input tokens** and **$0/M output tokens**, and have a 30-second HTTP deadline. OpenRouter supplies no hard total-cost cap for this moving alias; the approval dialog states that limitation. Taxes, currency conversion, and account-level billing behavior are outside these extensions.

Declining, editing the preview, losing UI availability, or cancelling before transmission returns a sanitized fallback without a provider request. Parent cancellation or session shutdown also stops an authentication wait, releases the invocation lock, and aborts an active HTTP request. Cancellation cannot retract data or charges after a request has been accepted.

## Shared boundaries

- **Review is not DLP.** Never send secrets, credentials, session history, private files, internal documents, signed URLs, authenticated-page content, or data you are not authorized to disclose.
- **Reranking is public-web only.** URL checks reject obvious local or credential-bearing sources but do not prove that content is public. The extension does not fetch URLs or verify provenance.
- **Router metadata is disclosed.** Its payload includes active tool and discovered skill names and descriptions, which may originate in project resources. Inspect them before approval. The shared Jev workflow skill excludes itself from routing candidates.
- **Preserve semantics.** Write routing tasks and reranking questions/criteria in English while preserving names, numbers, dates, negation, uncertainty, scope, and plan-versus-execution distinctions. Reranking excerpts remain verbatim in their original language.
- **Advice is not authority.** Existing authorization, privacy, browser, tool, skill, and pi-subagent rules still apply. Jev probabilities and confidence do not establish correctness.
- **Output is bounded and sanitized.** Review JSON visibly escapes invisible Unicode format controls while preserving the exact parsed request, including supplementary-plane characters. HTTP output is limited to 32KiB, and provider bodies and exception text are reduced to fixed failure codes.
- **One active invocation per extension.** Late authentication results and late review submissions are ignored after cancellation. There is no cache, shell call, child process, model-list request, or separate raw request/response log.

Pi may retain ordinary tool arguments and results in session history. Successful calls include non-persistent `elapsedMs`, `inputBytes`, and `questionCount` diagnostics; these are not proof of quality or billing totals.

## If Jev is not being used

First distinguish no tool selection from a selected call returning `not_routed` or `not_ranked`. Confirm which extension and skill paths Pi actually loads, whether the tool is active, and the existing fixed failure code if a call failed. Reading the skill alone does not prove a tool was called. A source-copy installation does not change when this checkout changes; follow the migration guide before updating installed copies. Do not send session records to Jev or make a paid call merely to diagnose installation.

## Detailed guides

- [Router input/output contract, failure codes, and limits](extensions/pi-jev-router/README.md)
- [Reranker input/output contract, failure codes, and limits](extensions/pi-jev-tools/README.md)
- [Shared skill guide](skills/pi-jev/README.md) and [workflow](skills/pi-jev/SKILL.md)
- [Migration](MIGRATION.md)
- [Contributing](CONTRIBUTING.md)
- [Design principles](PRINCIPLE.md)

## Offline verification

With this repository's locked development dependencies already installed, run:

```bash
npm run check
```

The suite uses mocked HTTP, synthetic keys, isolated Pi loading, TypeScript checks, and skill validation. It makes no provider request and does not establish live compatibility, routing quality, reranking quality, latency, or cost.

## Evaluation before automation

Start with the [small offline reranker comparison](evaluations/reranker/README.md): `npm run evaluate:reranker` reports ranking gains and harms on synthetic Korean fixtures using explicit handwritten mock orders. It can also compare separately collected results against an original-order or supplied parent-order baseline, with optional whole-task timing and quality observations. It never calls a provider; mock output establishes neither live quality nor net benefit. Missing measurements and cost remain unknown.

The decision-point guidance is an unvalidated selection hypothesis, not evidence of improved model behavior. Review it after the first small representative comparison and before expanding use. First compare old and new guidance with the same model, tools, skills, and public/synthetic tasks; count both missed applicable calls and unnecessary calls. Include varied cases rather than only these example phrasings:

| Situation | Expected selection |
|---|---|
| One typo fix or a user-specified lookup | Skip routing |
| Several tools are available, but the workflow is obvious | Skip routing |
| Parent-led versus delegated research remains unresolved | Route once, before settling the plan |
| Routing quality is explicitly being evaluated | Route once, subject to consent and permitted data |
| Several usable public excerpts need a reading order | Rerank once, before reading all sources in depth |
| A sufficient source answers the question, or all candidates are fully reviewed | Skip reranking |
| Public excerpts are paired with a private question | Do not send the prohibited input |
| Routing is followed by a distinct reading-priority decision | One routing call and one reranking call may apply; no automatic retry |

Selection-only evaluation can stop before execution without making a provider request; it cannot establish Jev's usefulness. Live evaluation requires separate authorization. Compare representative tasks with and without Jev, recording returned model IDs, important misses, unnecessary calls, source reads, total time including preparation and approval, token use, and actual cost (missing cost is unknown). Keep contradictory evidence available regardless of rank. If selection increases without a net benefit, narrow or revert the guidance; the router and reranker need not have the same outcome. Do not add silent calls, private-data routing, automatic execution, or broader integration merely because offline checks pass.

## License

[MIT](LICENSE); keep the extension-specific bundled licenses when copying directories.
