# Real-source candidate-discovery pilot

This is the **local discovery gate**, not an A/B/C agent benchmark. No live Jev request, model task run, active installation, or default-resource change is performed by the evaluator. Public source is read as data, never executed. Gold authoring used one read-only assistant investigation (partial due to its tool budget), followed by targeted parent adjudication.

## Frozen design

- Two public GitHub repositories, pinned commits and Git trees in `tasks.json`; local Git trees were checked against GitHub's public commit metadata before export. Only `git archive` content was used, not working-tree changes or private configuration.
- 14 ordinary Korean prompts: 12 potential discovery tasks and 2 known-location negative controls. Ten discovery tasks have scored implementation gold. `b2` is ambiguous about executable overrides; `b5` requires native-backend behavior not adjudicated here. Both remain visible and unscored rather than being replaced after retrieval.
- Gold implementation facts and literal English translations are prepared **before any retrieval run**. Neither filenames, gold spans, answers, nor identifier-enriched rewrites are passed as primary retrieval hints. The same broad extension-directory scope is used for every task within a repository.
- Raw Korean and literal English goals are separate forced-input diagnostics. Neither is evidence of how a parent model will construct goals. No conclusion about Korean users' actual task success follows directly from these scores.
- Three repetitions for each language and each of two corpus materialization orders (ascending and descending file paths). Task/language order is reversed on the middle repetition. Creation order does not guarantee filesystem enumeration order; the actual native traversal is recorded.
- `freeze.json` records pre-run hashes of questions, gold, full corpus inventory, the unchanged reader core, and the evaluator. The reader is the code merged by PR #28 (`52b13be630903b80735c068a894cedc7a08daeeb`; feature head `9579d0910d20df8ef7b3cce2fd090c556bd9bcea`).

## Scoring

Each gold item contains required fact groups. A group is hit when a passage in the correct file contains an entire listed atomic line span; equivalent alternatives within a group use OR, groups use AND for full-task evidence coverage. Every span is at most five lines. Source file hashes and bounds are checked, and returned candidate text is checked against the pinned source.

Report separately:

1. **Candidate recall:** fraction of required groups present among the up-to-12 discovered candidates.
2. **Returned recall:** fraction present in the actual local top-three renderer output.
3. **Full-evidence task count:** tasks for which every required group is present. This is NOT model answer accuracy.
4. **Gold-aware ordering ceiling:** maximum group recall achievable from those same candidates through the real bounded renderer. This deliberately uses the gold; it is NOT measured Jev performance or an executable ranking strategy for production.
5. Coverage limits, candidate/returned source ranges, local pipeline time, rendered JSON bytes, and eligibility/bytes for serialization of a possible ranking request. Serialization does not send anything and does not represent a real HTTP attempt.

The aggregate recall values are task-macro means from the first repetition of each condition; stability is checked against the other two repetitions. If stability fails, inspect all rows rather than relying on the first repetition. Timing summaries use all repetitions, but are warm-cache **local scan/render only**: source validation/materialization has already warmed the files. They exclude setup, consent, main-model reasoning, authentication, provider latency, and oracle scoring. No significance or speedup claim is justified by this small pilot.

After all primary runs, a separate **gold-file-path probe** supplies the known implementation filenames with the same literal-English goals. This is intentionally oracle-aided failure diagnosis, never a primary score or fair baseline.

These are designated implementation spans, not all possible valid evidence. Documentation-only excerpts do not satisfy this implementation-grounded rubric; unlisted equivalent source evidence can be undercounted. The related Pi ecosystem repositories and modest task count limit external validity.

## Reproduce

No dependencies need to be installed. Export the pinned public commits from existing Git object stores into a disposable directory with `subagent/` and `browser/` children, retaining each repository's LICENSE. Both repositories are MIT-licensed; authors are MDGChamomile and Mitch Fultz respectively.

```sh
# CORPUS is a newly created disposable directory; never extract over user work.
mkdir -p "$CORPUS/subagent" "$CORPUS/browser"
git -C /path/to/pi-subagent archive 7aa98ac47bc6786613f5d2085bc0cff2dbe6f4bb | tar -x -C "$CORPUS/subagent"
git -C /path/to/pi-agent-browser-native archive 2a872baf6a8e920120fbb49c3cfcb80142b2a483 | tar -x -C "$CORPUS/browser"
node --test evaluations/context-reading/pilot/evaluate.test.mjs
# The baseline evaluator intentionally rejects a changed reader core.
# Reproduce the original baseline in a disposable tree, not by reverting current work.
BASELINE_TREE=$(mktemp -d)
mkdir -p "$BASELINE_TREE/extensions/pi-jev-context" "$BASELINE_TREE/evaluations/context-reading/pilot"
git show 9579d0910d20df8ef7b3cce2fd090c556bd9bcea:extensions/pi-jev-context/core.mjs > "$BASELINE_TREE/extensions/pi-jev-context/core.mjs"
cp evaluations/context-reading/pilot/{evaluate.mjs,tasks.json,gold.json,corpus-manifest.json,freeze.json} "$BASELINE_TREE/evaluations/context-reading/pilot/"
node "$BASELINE_TREE/evaluations/context-reading/pilot/evaluate.mjs" "$CORPUS" > /tmp/context-reading-pilot-results-new.json
```

The evaluator verifies every source file against `corpus-manifest.json`, makes its own temporary copies, and removes only those copies. It does not delete the supplied corpus. Keep original result artifacts rather than overwriting them with a rerun. No runtime algorithm is tuned during this frozen pilot. The separately authorized [candidate-selection revision](revision/README.md) preserves this baseline and adds new heldout questions and a matched comparison.

## Still unmeasured

Existing-tools baseline A, actual local-tool arm B, live Jev arm C, natural tool selection (including the two negative controls), follow-up reads/searches, answer correctness, main-model tokens, full-task latency, and total cost remain unknown. Permission/session lifecycle is not exercised by this direct-core experiment; separate offline integration tests cover that contract.

Inspect the discovery gate before paying for ranking. If most required evidence is absent from candidates, ranking cannot fix those misses; diagnose the local selection or actual parent query construction first. Any later provider run requires a separately disclosed provider/model, maximum request count, maximum spend, and authorized data scope. The runtime's request/input quotas are not a hard dollar cap.
