# Experimental purposeful reading

`find_context` takes project-relative `paths` and a focused `goal`, discovers bounded source excerpts locally, optionally ranks them with Jev, and returns source text with file/line references and coverage. It does not write or summarize code, execute commands, modify ordinary `read`, or compact conversation history. Jev is a selector, not an authorization service or source verifier.

This is an opt-in experiment. Offline tests do not establish live compatibility, useful code-search recall, natural tool adoption, or end-to-end speed/cost gains. Keep the ordinary tools available and remove or narrow this feature if matched comparisons do not justify it.

## Load separately

From a development checkout with its existing locked dependencies available:

```bash
pi --no-extensions --no-skills -e ./extensions/pi-jev-context/index.ts
```

This deliberately isolates the reader from the legacy router/reranker/skill and all other discovered extensions. It is not a migration instruction or a promise that another extension's permission controls still run. Extensions execute with Pi's OS permissions; this reader explicitly checks its own authorized project paths. Do not use a live-environment install as a test shortcut. For later deployment, review the complete directory (including its license and local modules) and choose its resource configuration explicitly.

The root Git package continues to select the legacy tools and skill. They remain independently usable and keep full-payload review and separate per-request approval. The reader does not import their installed files, require the shared Jev skill, or insert a router before reading.

## Explicit activation, no per-call popup

A newly loaded reader has no permission to scan project files. Use its **user command**, not a model tool, to grant a bounded scope:

```text
/jev-context local src tests
/jev-context enable src tests
/jev-context status
/jev-context disable
```

- `local`: authorize local discovery only. No credential lookup or provider call occurs.
- `enable`: confirm local discovery plus automatic external ranking for the displayed canonical project, relative paths, selected provider/model, lifetime and request/input quotas. The request includes the goal and source candidates; it does not include conversation history or the whole project. Only activate it for material you are authorized to disclose.
- `status`: inspect the grant and consumed quota without contacting a provider.
- `disable`: revoke the project grant. Data already accepted by a provider cannot be recalled.

Command paths are whitespace-delimited; paths containing whitespace are not supported by this initial command parser. Project-wide `.` grants, traversal outside the project, and unsupported paths are rejected. Paths in a tool call must be within the stored scope. A file-access grant is not a general grant to send other project material, sessions, authenticated content, or credentials.

Activation requires an interactive confirmation-capable Pi host. Execution never opens approval dialogs. A persisted grant survives ordinary reload/restart until revoked, expired, replaced, or exhausted; re-enabling is an explicit renewal, not an automatic reset. Current activation permits **at most 100 reserved attempts and 1 MiB of serialized request input over 7 days**. Reservations are persisted under a project-keyed `jev-context` directory in Pi's agent directory (no keys are stored) and protected against concurrent reservations. Failed/cancelled reservations are not refunded. A busy lock fails closed rather than guessing that a lock is stale.

These are request/input limits, **not a hard dollar spending cap**. Inspect the confirmation and the selected provider's pricing before enabling. Credentials alone never authorize transmission. Changing the provider or authorized paths requires a new explicit activation; a changed provider does not silently redirect an existing grant.

### Connection and cost

Select `PI_JEV_PROVIDER=openrouter` (default) or `PI_JEV_PROVIDER=typesafe` before starting Pi. No automatic switching occurs.

| Connection | Endpoint/model | Authentication after grant checks | Price control |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/alpha/decisions`, `~typesafe/jev-latest` | Pi `getProviderAuth('openrouter')` | TypeSafe-only routing, fallbacks disabled; $0.042/M input and $0/M output ceilings; no enforced total-dollar cap |
| Direct TypeSafe | `https://api.typesafe.ai/v1/systemone`, `jev-latest` | `TYPESAFE_API_KEY` | No enforced per-token or total-dollar cap |

Both aliases move over time. One ranking attempt makes at most one request, rejects redirects, has a 5-second HTTP deadline, and bounds response bytes to 32 KiB. Failures use local discovery order instead of retries. Unknown or missing billed cost is not zero. A user-controlled project activation is distinct from authorization to run a developer's live evaluation; this repository's tests never exercise paid provider calls.

## Use in Pi

For a normal request such as “find the token-refresh retry termination condition,” the parent can call:

```json
{"paths":["src/auth"],"goal":"Find token refresh retry termination conditions and error handling"}
```

The parent does not paste source bodies or prepare ranking candidates. The tool does bounded lexical discovery (including filenames), collects surrounding lines, merges adjacent windows, and ranks only when there is a choice and an eligible external grant. It returns at most three source blocks; it does not generate an explanation or patch.

Use ordinary `read` for known exact ranges, complete review, and patch preparation. Continue using ordinary `bash`, `edit`, and `write` for execution and changes. A source reference can be read again with `read(path, offset=startLine, limit=endLine-startLine+1)`. References describe the file at scan time, not an immutable snapshot; re-read before editing.

## Coverage, limits, and failure

Initial discovery limits are 80 considered source files, 1,200 visited entries, 96 KiB per file, 1 MiB read bytes, and 1.5 seconds of scan work. Candidate windows include up to four surrounding lines on each side of a match and merge when adjacent. There are at most 12 candidates, each at most 8 KiB; a serialized ranking request must fit 64 KiB. Returned JSON is bounded to 24 KiB and three source blocks. Reaching a discovery/candidate budget must be visible in coverage, not represented as an exhaustive search.

The result distinguishes `found`, `not_found` within the checked scope, and `limit_reached`, and includes file/byte counts, skipped material, selected original text, and an omission count. A failure to find a passage is never evidence that the implementation does not exist. Lexical discovery can miss aliases, indirect calls, morphology, or code whose terminology differs from the goal; Jev cannot recover a file that was never a candidate.

The scanner excludes symlinks, hidden/generated/credential-oriented paths, unsupported or binary text, oversized material, and recognizable secret patterns. These exclusions and a bounded local root are defense in depth, **not a sandbox or complete DLP**. They cannot establish that arbitrary business data is safe to disclose. Secret/session/authenticated content remains prohibited; approve only appropriate source paths and keep sensitive material outside them.

No valid grant means no project content read. Local mode, a single candidate, exhausted quota, provider mismatch, or a provider failure does not cause a fresh approval dialog or alternate-provider request. The reader returns the bounded local result when available, or a fixed failure/cancellation status. No raw provider body, credential, or exception message is included in errors.

## Verification and evaluation

```bash
npm run check
npm run evaluate:context
```

See the [evaluation guide](../../evaluations/context-reading/README.md). Test local candidate recall separately from final evidence preservation. Compare ordinary Pi, local-only reading, and Jev-assisted reading on matched tasks; measure whole-task accuracy/time/cost and additional reads, not only returned bytes. Separately test natural selection on normal requests that do not name Jev or force `find_context`. Include exact-read tasks where using it is unnecessary. No live Jev ranking, main-model benchmark, natural-adoption rate, or end-to-end improvement is established by the bundled synthetic suite.
