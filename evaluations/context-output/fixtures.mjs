// Synthetic command outputs for offline context-compaction comparisons.
// mustKeep is evaluation-only gold evidence; compaction implementations must not read it.
const repeatedPassingTests = Array.from(
  { length: 18 },
  (_, index) => `✔ parser case ${String(index + 1).padStart(2, "0")} (${index + 3}ms)`,
).join("\n");

const repeatedBuildModules = Array.from(
  { length: 2_105 },
  (_, index) => `m${String(index + 1).padStart(4, "0")}`,
).join("\n");

const midstreamBefore = Array.from(
  { length: 1_800 },
  (_, index) => `p${String(index + 1).padStart(4, "0")}`,
).join("\n");
const midstreamAfter = Array.from(
  { length: 2_300 },
  (_, index) => `s${String(index + 1).padStart(4, "0")}`,
).join("\n");
const longUtf8Line = `ROOT_CAUSE: synthetic diagnostic ${"한글🙂".repeat(15_000)} END_MARKER=preserved`;

export const fixtures = [
  {
    id: "passing-test-summary",
    kind: "test",
    command: "npm test",
    exitCode: 0,
    text: `${repeatedPassingTests}\n\nTest Files  3 passed (3)\n     Tests  18 passed (18)\n  Duration  1.24s`,
    mustKeep: ["Test Files  3 passed (3)", "Tests  18 passed (18)"],
    notes: "Many repetitive successes; the final aggregate conveys completion and scale.",
  },
  {
    id: "test-failure-stack-and-aggregate",
    kind: "test",
    command: "node --test",
    exitCode: 1,
    text: `✔ handles empty input (2ms)\n✖ preserves the requested limit (8ms)\n  AssertionError [ERR_ASSERTION]: expected 4, received 3\n      at TestContext.<anonymous> (src/limit.test.mjs:27:10)\n      at Test.runInAsyncScope (node:async_hooks:214:14)\n\nℹ tests 9\nℹ pass 8\nℹ fail 1\nℹ duration_ms 94.2`,
    mustKeep: ["expected 4, received 3", "src/limit.test.mjs:27:10", "ℹ fail 1"],
    notes: "Requires the assertion cause, actionable source location, and aggregate failure count.",
  },
  {
    id: "early-cause-before-noisy-tail",
    kind: "build",
    command: "npm run build",
    exitCode: 1,
    text: `src/config.mjs:4:12: error TS2305: Module './flags.mjs' has no exported member 'strictMode'.\nBuild stopped while checking src/config.mjs.\n${repeatedBuildModules}\nBuild failed with 1 error.`,
    mustKeep: ["src/config.mjs:4:12: error TS2305: Module './flags.mjs' has no exported member 'strictMode'.", "Build failed with 1 error."],
    notes: "Synthetic illustrative build output, not literal npm output. The cause is followed by 2,105 generated lines and is lost to Pi's default tail truncation.",
  },
  {
    id: "successful-command-warning",
    kind: "build",
    command: "npm run build",
    exitCode: 0,
    text: `building for production...\nCircular dependency: src/alpha.mjs -> src/beta.mjs -> src/alpha.mjs\n✓ 42 modules transformed.\nbuild complete in 311ms`,
    mustKeep: ["Circular dependency: src/alpha.mjs -> src/beta.mjs -> src/alpha.mjs", "build complete in 311ms"],
    notes: "Exit success does not make a potentially actionable warning disappear.",
  },
  {
    id: "unknown-diff-output",
    kind: "unknown",
    command: "synthetic-diff-and-status-report",
    exitCode: 0,
    text: `diff --git a/src/limits.mjs b/src/limits.mjs\nindex 1111111..2222222 100644\n--- a/src/limits.mjs\n+++ b/src/limits.mjs\n@@ -8,2 +8,2 @@\n-const defaultLimit = 20;\n+const defaultLimit = 12;\n\n{ "changed": true, "reason": "fixture-only" }`,
    mustKeep: ["-const defaultLimit = 20;", "+const defaultLimit = 12;", '"reason": "fixture-only"'],
    notes: "Synthetic wrapper output mixes a diff-like block and JSON-like status; this is not literal output from git diff --check or git diff.",
  },
  {
    id: "utf8-byte-size",
    kind: "unknown",
    command: "tool --report",
    exitCode: 0,
    text: `요약: 변경 없음\n검증 대상: 가상의 서울 지점\n주의: 승인 전 실행하지 마세요.\n상태: 완료 — UTF-8 입력을 그대로 보존합니다.`,
    mustKeep: ["요약: 변경 없음", "주의: 승인 전 실행하지 마세요.", "상태: 완료 — UTF-8 입력을 그대로 보존합니다."],
    notes: "Korean and multibyte punctuation exercise UTF-8 byte-aware handling and meaning preservation.",
  },
  {
    id: "failure-looking-data",
    kind: "unknown",
    command: "node print-fixture.mjs",
    exitCode: 0,
    text: `{
  "message": "the sample string says ERROR: disk full, but this is quoted test data",
  "token_example": "sk-example-not-a-credential-000000000000",
  "status": "ok"
}
Printed sample; no error occurred.`,
    mustKeep: ["the sample string says ERROR: disk full, but this is quoted test data", '"status": "ok"', "Printed sample; no error occurred."],
    notes: "Synthetic secret-shaped text and an error-looking quoted value must not override successful structured output.",
  },
  {
    id: "very-long-single-line",
    kind: "unknown",
    command: "tool --emit",
    exitCode: 0,
    text: longUtf8Line,
    mustKeep: ["ROOT_CAUSE: synthetic diagnostic", "END_MARKER=preserved"],
    notes: "Synthetic one-line output exceeds 60 KiB in UTF-8 and includes multibyte characters; Pi's default byte-tail truncation drops the beginning at a UTF-8 boundary.",
  },
  {
    id: "failure-cause-midstream",
    kind: "test",
    command: "synthetic-check-wrapper",
    exitCode: 1,
    text: `Starting synthetic checks...\n${midstreamBefore}\nFAIL extension load: Cannot find module './missing-helper.mjs'\n    at loadExtension (checks/load.mjs:61:9)\n${midstreamAfter}\nSummary: 1,800 passed, 1 failed, 2,300 skipped`,
    mustKeep: ["FAIL extension load: Cannot find module './missing-helper.mjs'", "    at loadExtension (checks/load.mjs:61:9)", "Summary: 1,800 passed, 1 failed, 2,300 skipped"],
    notes: "Synthetic wrapper output, not literal npm or Node test-runner output. The cause is near the middle of 4,104 total lines; Pi's default 2,000-line tail drops the entire failure and stack.",
  },
  {
    id: "unknown-empty-success",
    kind: "unknown",
    command: "formatter --check",
    exitCode: 0,
    text: "",
    mustKeep: [],
    notes: "Empty successful output is a valid case; avoid inventing a failure or evidence.",
  },
];
