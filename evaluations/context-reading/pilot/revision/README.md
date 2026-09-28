# Candidate-selection revision: matched offline comparison

This follow-up was separately authorized after the initial discovery gate failed. It changes local candidate selection only. No live Jev calls, agent-benchmark model runs, active installation, default-resource changes, commits, or pushes are part of this experiment. Ordinary assistant/subagent work was used to author the gold; that is not a measured benchmark arm.

## Scope and protocol

- The original ten scored tasks are now **development data**, not heldout evidence.
- Four new Korean questions and literal English translations were written for a third public repository, `MDGChamomile/pi-ask-user`, commit `4edb7522011a085edbd88d1976d4fff2bc163813`. All visible root entries are supplied uniformly because the project has no common `src/` directory and the reader does not accept `.`. This exposes the same project layout for every question, not answer-specific filenames.
- An independent read-only lookup authored gold; the parent verified source spans and corrected its narrow-layout interpretation. The heldout questions, gold, and corpus inventory were frozen at **2026-09-28 08:57:47 UTC**, before the source change. They were not selected from retrieval scores. The author/developer can see the gold, so this is not a blinded external benchmark.
- Implementation and comparison code were frozen at **09:09:24 UTC** before any heldout retrieval. No parameter tuning followed the results.
- Baseline and revised functions run on exactly the same verified source copies. Query, task, and implementation order alternate across three repetitions. Only local scan/render time is measured; source validation and copying make these warm-cache measurements.
- Fourteen scored tasks × two languages × two implementations × three repetitions = **168 runs**. The original two unresolved questions and two natural-selection controls remain excluded and visible.
- Existing file, entry, byte, time, candidate-count, output, and external-request limits are unchanged. The comparison asserts equal `LIMITS` and an unchanged credential filter. The known redaction-marker false positive was not bypassed.

## Implementation being tested

The scanner no longer stops when twelve candidates have appeared. It visits more files within the existing bounds and maintains a maximum-twelve local pool (plus one transient insertion). Distinct query terms score once, exact words/camel-case identifier parts outrank incidental substrings, filenames add lexical weight, and ties prefer shorter excerpts then path/line order. Common English function words are excluded from local matching; the original goal is not rewritten or translated. Oversized merged windows keep their most informative matching anchor rather than always the first one.

The selector does not know which files are authoritative, enforce file diversity, or translate Korean. Its output is heuristic, not semantic proof. All original security checks, session consent, rendering and provider behavior remain intact. Discarded candidates still mark coverage incomplete.

## Results

See [REPORT.md](REPORT.md) and `results.json`. Summary recall uses the first repetition of each condition; the other repetitions are checked for stability. The original scoring/oracle helpers are reused only after asserting that baseline/revised renderers and limits are identical. Gold-aware oracle order is a ceiling, not Jev output. All task success, model usage/cost, and natural tool-selection measurements remain unknown.

## Reproduce without installation

Use existing Git object stores containing the three pinned commits. Recreate disposable corpus directories `subagent/`, `browser/`, and `ask/` using `git archive` (see the parent pilot guide for the first two). Retain the source licenses. Export the third with:

```sh
mkdir -p "$CORPUS/ask"
git -C /path/to/pi-ask-user archive 4edb7522011a085edbd88d1976d4fff2bc163813 | tar -x -C "$CORPUS/ask"
BASELINE_DIR=$(mktemp -d)
git show 9579d0910d20df8ef7b3cce2fd090c556bd9bcea:extensions/pi-jev-context/core.mjs > "$BASELINE_DIR/core.mjs"
node --test evaluations/context-reading/pilot/evaluate.test.mjs evaluations/context-reading/pilot/revision/compare.test.mjs
node evaluations/context-reading/pilot/revision/compare.mjs "$CORPUS" "$BASELINE_DIR/core.mjs" > /tmp/context-candidate-comparison-new.json
```

The comparison verifies the baseline module hash **before importing a private temporary copy**, validates every corpus file, checks the current core and comparison script against `comparison-freeze.json`, and checks the question/gold inventory hashes. It copies data to its own temporary directory and removes only that directory. It never executes source projects or calls a provider. A subsequent code change must be a separately identified experiment, not silently replace this frozen result.
