# Offline context-output comparison

This small developer-only harness compares (A) Pi 0.85.0's default bash tail truncation and return wrapper, (B) conservative local filtering for recognized test/build logs, and (C) an optional offline replay of supplied line-selection records. It reads synthetic fixture data only: it does not execute fixture commands, invoke Jev, call a provider, access sessions, or make network requests. It changes no Pi tools or installation.

## Run

From the repository root:

```bash
node --test evaluations/context-output/evaluate.test.mjs evaluations/context-output/fixtures.test.mjs
node evaluations/context-output/evaluate.mjs
node evaluations/context-output/evaluate.mjs --selection SELECTION.json
```

`fixtures.mjs` contains synthetic output and `mustKeep` gold strings. Gold strings are checked against the source at validation time and used only after selection to score what was preserved; they are never available to the filtering rules. Do not replace these fixtures with private session output or authenticated material.

## Arms and interpretation

- **Baseline A** reproduces `truncateTail` from the repository-pinned `@earendil-works/pi-coding-agent` 0.85.0: retain the last 2,000 lines or 50 KiB (51,200 UTF-8 bytes), whichever limit is reached first; an overlong final line may be cut at a UTF-8 boundary. It also counts the `(no output)` and nonzero-exit status wrapper in the returned text. The installed source is the contract checked by the tests. Since this offline harness does not create Pi's temporary full-output file, it replaces Pi's dynamic temp path with a deterministic fixture ID and source-line omission reference. This substitution is explicitly not a literal Pi runtime result or an actual temp-file path.
- **Local B** only filters lines from the already-visible baseline. For successful, recognized test/build output, it removes only explicit pass/compile-progress rows and retains every other recognized line, including warnings, diagnostics, and summaries. Failed commands, unfamiliar lines, ambiguous output, or a result that would not reduce bytes fall back byte-for-byte to A. It cannot recover information Pi already truncated.
- **Offline C** is `not_measured`/null if no selection record is supplied. With a record, the evaluator checks source line references and exact selected text against the *visible baseline*, then renders the selection with source refs, initial/interior/final omission ranges, and the original Pi truncation/full-fixture reference. A line reference alone cannot restore a clipped prefix of a partial line. The evaluator does not verify record provenance and never presents replayed text as actual Jev output.

A selection file has this shape:

```json
{
  "kind": "observed-selection",
  "cases": [
    {
      "fixtureId": "passing-test-summary",
      "lineRefs": [{ "start": 20, "end": 21 }],
      "selectedText": "Test Files  3 passed (3)\n     Tests  18 passed (18)",
      "jevLatencyMs": null,
      "jevCostUsd": null
    }
  ]
}
```

Line refs are 1-based inclusive ranges in the original fixture. `selectedText` must exactly equal the referenced lines as visible in the baseline; a selection outside Pi's visible tail or a mismatch is an error. Partial lines are validated against their visible clipped text, never silently expanded to the original full line. A missing fixture in the record remains unmeasured. Optional Jev latency/cost are supplied observations, not independently verified.

The report includes original and returned UTF-8 byte counts, byte reductions/rates relative both to the original fixture and to baseline A, gold-string preservation/misses, line refs, and local processing time where measured. Returned bytes include wrappers, omissions, source-line labels, and exit status. Byte reductions are **not token savings**. Jev latency/cost and whole-task success/time/requery stay unknown/null unless supplied; there is no whole-task measurement protocol in this harness.

In the bundled synthetic fixtures, local B reduces bytes only for the repeated passing-test log; the short failure and warning cases use safe baseline fallback. Additional unit regressions verify that a long successful build can drop compile-progress rows while retaining `tsc` and a dependency warning, and that a failed long `AssertionError` log falls back with its diagnostic intact. These narrow cases test the delete-only-progress rule; they do not establish broad compression quality. The baseline itself loses the early build cause, midstream test failure/stack, and beginning of the long UTF-8 line; local filtering cannot recover that evidence and its gold misses are reported. These examples demonstrate mechanics and known tail-truncation failure modes only. Local processing measurements do not prove exact model round-trip speed improvement, model quality, or whole-task time/success benefit. No live Jev result is bundled. Keep the experiment offline and do not infer authorization to send payloads from this tool.
