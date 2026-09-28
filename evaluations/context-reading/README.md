# Purpose-shaped reading: offline scaffold

Run from the repository root:

```sh
node evaluations/context-reading/evaluate.mjs
node --test evaluations/context-reading/evaluate.test.mjs
node evaluations/context-reading/evaluate.mjs --replay RECORDS.json
```

The local mode validates fixture IDs, relative contained paths, sizes, counts, and gold passage presence before writing six synthetic cases under a temporary root, then deletes it. It calls `findCandidates` and `renderContext` from the context extension. Gold passages are independently declared in `fixtures.json`; candidate recall asks whether a gold passage entered the local candidate set, while returned recall asks whether it survived in the rendered original text. Exact substring matching intentionally makes lexical mismatch visible: synonyms, paraphrases, split passages, and changed formatting can produce false misses. These tiny curated cases do not measure broad retrieval quality.

Replay JSON is an array of `{caseId,rankedIds:[...]}` records. The evaluator rebuilds each fixture scan, requires every current candidate ID exactly once, and applies the actual ranked-mode renderer (including its top-three output cap); records cannot supply or alter candidate text. Missing records produce null recall fields. The top-three-effect replay shows candidate recall 1 but returned recall 0 when the supplied ranking uses fixture file order, then 1 when an injected order promotes the gold passage. The current local lexical selector may already promote that passage without Jev; the deliberately poor replay still tests the actual output cap. This is injected synthetic ordering, not live Jev. Record provenance is not verified; do not treat replay as established Jev output. Unknown measurements remain unmeasured: existing task success, elapsed time, cost, natural tool choice, and Jev live measurements are null/not collected by this scaffold.

For a later evaluation, compare (1) baseline reading without assisted retrieval, (2) local-only retrieval/rendering, and (3) Jev-assisted results on matched tasks and the same independently reviewed gold evidence. Also measure natural-language tasks that do not mention Jev: appropriate tool selection, unnecessary selection, and re-querying. Control model/version, cache state, candidate and source order, and task wording; counterbalance arm order and prevent answer/order leakage. Record full task success/time/cost, not just tool latency. Any live test requires separate explicit approval of provider/model, maximum requests, maximum spend, and disclosed data. No provider call path exists here.

The [real-source pilot](pilot/README.md) separately freezes public source snapshots and implementation-evidence questions. Its original report is retained unchanged; follow-up local candidate-selection comparisons live under `pilot/revision/`. Neither is a main-model task benchmark or evidence of measured Jev quality.
