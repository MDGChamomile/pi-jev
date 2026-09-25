# Small offline reranker comparison

This developer-only harness checks a comparison procedure, **not Jev quality**. It reads JSON and prints a report; it never invokes the extension runner, resolves authentication, fetches sources, or contacts a provider. It adds no Pi tool, dependency, or installed resource.

## Run without credentials

From the repository root:

```bash
npm run evaluate:reranker
node --test evaluations/reranker/evaluate.test.mjs
```

The first command explicitly uses `--mock`. The five bundled cases use synthetic Korean excerpts and reserved `example.com` URL placeholders, not verified public sources. They cover plans versus completion, a negative correction, as-of dates and uncertainty, no useful evidence, and equally relevant evidence. They are deliberately small, human-authored examples, not a representative benchmark. Do not pass these placeholders off as public sources or feed local fixture files to the live tool.

`mock-results.json` contains handwritten orders, including an intentionally harmful order and a fallback. Orders are not generated from the gold labels and are not Jev output. The report should show two improvements, one critical demotion, one fallback with undefined relevance metrics, and one unchanged order. Timing and cost remain unknown. This validates that the evaluator can show harm as well as improvement.

## Compare previously collected results

```bash
node evaluations/reranker/evaluate.mjs RESULTS.json [FIXTURES.json]
```

Omit the optional fixtures argument to use the bundled cases. Custom fixtures follow `fixtures.json`: unique `id`, explicit `provenance` and `rationale`, a valid reranker `input`, a `relevance` grade (0–3) for every candidate, and `criticalIds` identifying evidence whose demotion matters. Input validation reuses the actual reranker contract. Labels should be reviewed before inspecting assisted orders; keep the question, dates, candidate set, and grading criteria fixed across arms.

Results follow `mock-results.json`, with top-level `kind` equal to `mock` or `observed`. Use separate files for these kinds; never label handwritten orders as observed. Include every fixture exactly once, even when declined or failed. Each case has:

- `caseId`: fixture ID.
- `status`: `ok` or `not_ranked`, copied from the result.
- `rankedIds`: every original candidate exactly once. A fallback must retain original order.
- `returnedModel`: the returned `typesafe/jev-...` model ID for an observed success; `null` when unavailable. This is metadata supplied by the evaluator's user, not provider verification.
- Optional `baselineIds`: the ordinary parent's reading order, captured independently **before showing it the assisted order**. Without this field the comparator uses original candidate order and labels it `original_order_only`; it is not evidence of improvement over parent reasoning.
- Optional `baseline` and `assisted` measurement objects, described below.

A complete measurement object looks like this (illustrative numbers, not a measurement):

```json
{
  "preparationMs": 300,
  "reviewApprovalMs": 400,
  "requestMs": 10,
  "readingAnswerMs": 200,
  "sourceReads": 2,
  "inputTokens": null,
  "outputTokens": null,
  "costUsd": null,
  "answerCorrect": true
}
```

Times must be non-overlapping wall-clock phases: initial search and candidate preparation; payload review and approval; provider request; then original-source reading and answering. Record zero for a genuinely absent phase, such as provider time in the baseline, rather than omitting it. Total time is calculated only when **all four phases** are measured. `elapsedMs` from a Jev result covers only the provider phase, not the whole task. Positive assisted-minus-baseline time means slower. A tool failure still has preparation/review/wait costs; record them and subsequent fallback work.

Token counts and `costUsd` should cover the whole comparison arm, not just Jev. Missing or partial accounting must stay unknown, not zero. `sourceReads` counts actual source openings, not ranking positions. `answerCorrect` records an independent answer assessment, not the model's confidence or relevance score. Missing fields and explicit nulls stay null in the report. Numeric values must be finite and non-negative; counts must be integers.

The file importer does not establish provenance, consent, answer correctness, fair experimental conditions, or that an observed result actually came from Jev. It also does not read Pi sessions to populate fields. Keep local observation files out of commits unless their complete contents are approved for publication; do not include credentials, private questions, internal notes, or session exports.

## Interpret the report

For both orders, the report includes:

- **nDCG@k**, where `k = min(3, candidate count)` and gain is `2^grade - 1`; null if there is no useful evidence.
- **First direct-evidence rank** (grade 3); null when there is none. This is a ranking proxy, not actual reads or time saved.
- **Direct-evidence coverage@k**; null when no direct passage exists.
- **Critical evidence missing from the first k positions** and **critical demotions** relative to the baseline.
- Original, baseline, and assisted orders with every candidate retained.
- Per-arm observations, total time where complete, and assisted-minus-baseline deltas. Missing cost stays unknown.

Equal grades permit multiple equally good orders. These metrics do not test provider calibration, stable score ties, source authority, or factual truth; runtime response/tie validation remains in the existing extension tests. A valid permutation can still contain no useful evidence. Ranking cannot recover omitted candidates.

## Small evaluation protocol

1. First run the mock comparison and regression tests offline. This verifies mechanics only.
2. Before any live evaluation, independently collect suitable public passages with provenance and sufficient context. Replace synthetic placeholders with confirmed public sources. Preserve the complete candidate set, including contrary evidence. Do not deeply read all sources just to prepare a reranking call.
3. Use matched parent-only and assisted tasks with the same model, tools, question, and success criteria. Separate the runs to avoid leaking the assisted order or answer into the baseline; alternate arm order across cases. Record preparation costs in both arms. Evaluate answer correctness independently and keep failures in the dataset.
4. Any live provider request still requires separate explicit authorization for provider/model, maximum requests, maximum spend, and disclosed data, plus the existing full-payload review and approval. **This harness does not supply a live runner or bypass consent.** If a spending bound cannot be enforced or agreed, stop rather than infer approval. No live request is needed to run these tests.
5. Review per-case quality, missed/demoted evidence, total time, source reads, tokens, and actual cost together. Do not declare a net benefit from mock output, faster HTTP alone, or a small nDCG gain. Narrow, redesign, or stop using reranking if the preparation and approval burden outweighs the benefit.

This is a reranker utility evaluation scaffold. It does not measure whether an agent chooses the tool at appropriate moments, and it provides no evidence for retaining or expanding the router. Those require separate comparisons. The fixtures and procedure should be revisited after the first small representative comparison, before broader use.
