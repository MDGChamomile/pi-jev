import assert from "node:assert/strict";
import test from "node:test";
import { truncateTail } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js";
import { fixtures } from "./fixtures.mjs";

const requiredKinds = new Set(["test", "build", "unknown"]);

test("context-output fixtures have the documented shape and distinct IDs", () => {
  assert.ok(fixtures.length >= 8 && fixtures.length <= 12);
  const ids = new Set();
  for (const fixture of fixtures) {
    assert.deepEqual(
      Object.keys(fixture).sort(),
      ["command", "exitCode", "id", "kind", "mustKeep", "notes", "text"].sort(),
      `${fixture.id} has unexpected fields`,
    );
    assert.equal(typeof fixture.id, "string");
    assert.ok(!ids.has(fixture.id), `duplicate fixture id: ${fixture.id}`);
    ids.add(fixture.id);
    assert.ok(requiredKinds.has(fixture.kind), `${fixture.id} has invalid kind`);
    assert.equal(typeof fixture.command, "string");
    assert.ok(Number.isInteger(fixture.exitCode));
    assert.equal(typeof fixture.text, "string");
    assert.equal(typeof fixture.notes, "string");
    assert.ok(Array.isArray(fixture.mustKeep));
    for (const evidence of fixture.mustKeep) {
      assert.equal(typeof evidence, "string");
      assert.ok(evidence.length > 0, `${fixture.id} has empty required evidence`);
      assert.ok(
        fixture.text.includes(evidence),
        `${fixture.id} is missing mustKeep evidence: ${JSON.stringify(evidence)}`,
      );
    }
  }
});

test("fixtures cover the intended adversarial output shapes", () => {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  for (const id of [
    "passing-test-summary",
    "test-failure-stack-and-aggregate",
    "early-cause-before-noisy-tail",
    "successful-command-warning",
    "unknown-diff-output",
    "utf8-byte-size",
    "failure-looking-data",
    "very-long-single-line",
    "failure-cause-midstream",
    "unknown-empty-success",
  ]) {
    assert.ok(byId.has(id), `missing coverage fixture: ${id}`);
  }
  assert.ok(byId.get("passing-test-summary").text.split("\n").length >= 18);
  assert.equal(byId.get("unknown-empty-success").exitCode, 0);
  assert.equal(byId.get("unknown-empty-success").text, "");
});

test("large early and midstream evidence is lost by Pi's actual default truncateTail", () => {
  const early = fixtures.find((fixture) => fixture.id === "early-cause-before-noisy-tail");
  const midstream = fixtures.find((fixture) => fixture.id === "failure-cause-midstream");
  const earlyResult = truncateTail(early.text);
  const midstreamResult = truncateTail(midstream.text);

  assert.equal(earlyResult.maxLines, 2_000);
  assert.equal(earlyResult.maxBytes, 50 * 1024);
  assert.ok(early.text.split("\n").length > 2_100);
  assert.equal(earlyResult.truncated, true);
  assert.equal(earlyResult.truncatedBy, "lines");
  assert.ok(!earlyResult.content.includes(early.mustKeep[0]), "full early diagnostic line should be truncated");
  assert.ok(earlyResult.content.includes(early.mustKeep[1]), "final build summary should remain");

  assert.ok(midstream.text.split("\n").length > 3_000);
  assert.equal(midstreamResult.truncated, true);
  assert.equal(midstreamResult.truncatedBy, "lines");
  assert.ok(!midstreamResult.content.includes(midstream.mustKeep[0]), "full midstream failure line should be truncated");
  assert.ok(!midstreamResult.content.includes(midstream.mustKeep[1]), "failure stack frame should be truncated");
  assert.ok(midstreamResult.content.includes(midstream.mustKeep[2]), "final aggregate should remain");
});

test("the long UTF-8 line exceeds 60 KiB and default byte truncation drops its cause", () => {
  const fixture = fixtures.find((item) => item.id === "very-long-single-line");
  const inputBytes = Buffer.byteLength(fixture.text, "utf8");
  const result = truncateTail(fixture.text);

  assert.ok(inputBytes >= 60 * 1024, `expected >= 60 KiB, got ${inputBytes} bytes`);
  assert.equal(fixture.text.split("\n").length, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.truncatedBy, "bytes");
  assert.ok(!result.content.includes(fixture.mustKeep[0]), "full initial diagnostic marker should be truncated");
  assert.ok(result.content.includes(fixture.mustKeep[1]), "end marker should remain in the retained tail");
  assert.ok(Buffer.byteLength(result.content, "utf8") <= 50 * 1024);
  assert.ok(!result.content.includes("\uFFFD"), "retained UTF-8 should not contain a replacement character");
});
