# Pi Jev Router — experimental advisory task routing

An optional `jev_route_task` tool for the **parent Pi agent**. It asks TypeSafe Jev for one advisory primary route, one active tool, one discovered specialist skill, a pi-subagent preset, and the probability that independent parallel investigations would help. It does not execute a route, activate a tool, load a skill, create a subagent, grant authorization, or enforce policy.

The companion [`pi-jev-router` skill](../../skills/pi-jev-router/README.md) describes when to call the tool and how to interpret its result. The existing [`pi-jev-tools`](../pi-jev-tools/README.md) remains a separate public-passage reranker and is not modified or required by this router.

**Status:** experimental source implementation with offline tests and no live routing evaluation yet. The option set, input bounds, and usefulness in Korean operating workflows are hypotheses to test against the ordinary parent-agent baseline. Keep it only if representative comparisons show a net improvement.

## What it returns

One approved Jev request evaluates five independent questions over the same state:

1. primary route: `direct`, `local_subagent`, `web_subagent`, `browser_interaction`, `specialist_skill`, `clarify_with_user`, or `no_match`;
2. speculative pi-subagent preset: `lookup-standard`, `analysis-standard`, `review-standard`, or not applicable;
3. one active Pi tool, or none;
4. one discovered Pi skill, or none; and
5. a Noul probability that two or more non-overlapping, independent subagent investigations would materially help.

Choice answers retain the complete probability distribution and confidence. Noul returns a yes probability and no separate confidence value. The questions are independent, so code and the parent must ignore inapplicable speculative answers and reconcile disagreement. No fixed automation threshold is supplied.

## Flow

1. The parent decides that routing is genuinely ambiguous or worth measuring. Obvious and simple tasks skip Jev.
2. The parent supplies an **English** task description and optional English constraints. It preserves operative details, names, numbers, negation, and scope while omitting unrelated conversation history.
3. The extension snapshots active tool names/descriptions and discovered skill command names/descriptions. It never reads session history, local files, skill bodies, or tool results.
4. The extension validates the complete request and displays the entire immutable Jev payload in a scrollable editor. Submitting it unchanged continues; cancellation or edits stop without sending.
5. A separate confirmation identifies TypeSafe, the model alias, candidate counts, one-request limit, deadline, data risks, and Jev's advisory-only role.
6. Jev returns typed judgments. The extension validates and maps opaque candidate IDs back to runtime names.
7. The parent applies existing authorization, safety, privacy, tool, skill, browser, and pi-subagent rules before taking any action.

## Requirements and use

- Node.js 22.22+ and Pi with the current extension API. Offline loading/typechecking uses the same existing Pi dependency environment as `pi-jev-tools`.
- An **existing** Python 3.10+ interpreter with `typesafe-sdk` installed. The offline SDK contract targets 0.6.0.
- `TYPESAFE_API_KEY` inherited by Pi from its environment. The extension never loads `.env`, searches for keys, or accepts credentials in tool arguments.
- An interactive Pi UI, or an RPC host implementing editor and confirmation dialogs. Print/JSON modes fail closed with `confirmation_unavailable`.
- For automatic workflow guidance, copy the companion skill separately. The extension itself still works when called explicitly without the skill.

After separately authorizing runtime use, load only this source extension and point it at an existing interpreter:

```bash
pi -e ./live/extensions/pi-jev-router/index.ts \
  --jev-router-python /absolute/path/to/existing/venv/bin/python
```

Loading registers `jev_route_task` and the `--jev-router-python` flag. It makes no startup request, installs nothing, and does not modify the active tool set. Repository edits do not install this extension into the user's Pi environment.

## Tool contract

```json
{
  "task": "Determine whether this request needs a focused public web investigation or can be answered directly.",
  "constraints": "Use current public sources. Do not access authenticated pages or local files."
}
```

- `task`: English routing description, 1–8,000 Unicode characters. It should represent only the current request, not a session transcript. English is a caller contract because Jev's primary training language is English; the extension does not attempt unreliable language detection or translation.
- `constraints`: optional English text, 1–4,000 characters, containing only material constraints already established for this task.
- The extension adds up to 32 active tools and 32 discovered skills, each with its runtime name and description. It rejects larger catalogs or a semantic payload over 65,536 UTF-8 bytes rather than truncating or silently omitting candidates.
- `jev-latest` follows the current stable model. The response records both the requested alias and returned versioned model ID.
- One approval permits one paid request. SDK retries are disabled and the local adapter deadline is 30 seconds.

A successful result has `status: "ok"`, the route and full probabilities, mapped tool/skill candidates, optional subagent preset, the parallel-investigation probability, token usage, and an advisory limitation note. A Choice confidence value describes concentration of its distribution, not end-to-end correctness.

A declined or failed call returns `status: "not_routed"` with a fixed code such as `declined`, `preview_changed`, `confirmation_unavailable`, `missing_key`, `python_not_configured`, `busy`, `rate_limited`, `timeout`, `cancelled`, or `invalid_response`. Continue with the normal parent-agent workflow and do not retry automatically.

## Boundaries and limitations

- **English semantic input.** Generated instructions and criteria are English. The parent must also write `task` and `constraints` in English. Preserve the user's operative meaning; do not add a second translation provider. Test routing quality on representative Korean-origin requests before relying on it.
- **Reviewed request data, not public-only data.** Unlike `pi-jev-tools`, this router may carry an English representation of the current user request. Never include secrets, credentials, session history, private file contents, internal documents, signed URLs, authenticated-page content, or data the user is not authorized to disclose. Review is informed consent, not a DLP system or an override of another resource's privacy boundary.
- **Metadata disclosure.** The reviewed payload contains active tool and discovered skill names/descriptions. Descriptions can come from trusted project resources. Inspect them before approval.
- **No automatic collection.** The extension does not hook user input, read the session, inspect local files, read skill bodies, capture tool schemas, or log raw requests/responses. Pi may retain ordinary tool arguments and results in session history.
- **No authority.** Jev is not a security boundary or authorization judge. A route, tool, skill, or browser recommendation never permits an otherwise restricted action. Existing Pi and resource-specific controls remain authoritative.
- **No automatic execution.** The tool returns advice only. Availability may change after the snapshot. The parent must load a selected skill before following it and must use the installed pi-subagent contract for any delegation.
- **Independent questions can disagree.** A route may recommend direct handling while speculative fields name a subagent preset or skill. Consume only fields relevant to the chosen and policy-permitted route.
- **Candidate coverage matters.** Jev can select only from active tools and discovered skills included in the reviewed payload. It cannot recover an inactive, undiscovered, or omitted capability.
- **Language and model drift.** English is Jev's strongest language, but routing quality and calibration remain task-specific. `jev-latest` can move to a new model; record actual model IDs during evaluation.
- **Process isolation is limited.** The Python child receives only `TYPESAFE_API_KEY` and a locale, uses stdin rather than arguments, and has bounded output/time. This is credential minimization, not an OS sandbox.
- Only one invocation can be pending per extension instance. Cancellation kills an active adapter but cannot retract accepted provider data or charges.

## Offline verification

From the repository root, without making provider calls:

```bash
node --test live/extensions/pi-jev-router/tests/core.test.mjs
python3 -B -m unittest discover -s live/extensions/pi-jev-router/tests -v
python3 -B .github/scripts/validate_skills.py
```

Python tests skip SDK-contract cases if the SDK is absent. To include them, use an existing interpreter with `typesafe-sdk==0.6.0`; mock transports and synthetic credentials prevent real provider requests.

For TypeScript checking and an offline Pi extension-load smoke, reuse existing package directories:

```bash
node live/extensions/pi-jev-router/tests/pi-check.mjs \
  /absolute/path/to/pi-coding-agent \
  /absolute/path/to/typescript
```

Tests cover request construction and English caller contracts, runtime candidate mapping, size limits, malformed replies, immutable review and separate confirmation, unchanged fallback, concurrency, cancellation, subprocess environment isolation, bounded output, sanitized errors, real SDK serialization through a mock transport, and zero retries for 429 responses.

## Evaluation before automation

Start in advisory or shadow use: record Jev's recommendation without treating it as authority, then compare it with the ordinary workflow on representative tasks. Measure at least route agreement with reviewed outcomes, important-route misses, unnecessary tool/skill/subagent calls, end-to-end success, latency, and actual cost. Evaluate Korean-origin requests using faithful English task descriptions.

Do not add automatic input hooks, silent provider calls, private-data routing, direct tool activation, or direct child creation merely because offline checks pass. Any automation threshold or wider data policy needs its own evidence and authorization.

## References

- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)
- [Intent routing pattern](https://docs.typesafe.ai/patterns/intent-routing)
- [Confidence](https://docs.typesafe.ai/confidence)
- [Python SDK](https://docs.typesafe.ai/sdk/python)
- [Models and language limitations](https://docs.typesafe.ai/models)

MIT; keep the bundled [LICENSE](LICENSE) when copying the directory.
