// Offline context-output comparison. This module never executes commands or contacts providers.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PI_MAX_LINES = 2000;
export const PI_MAX_BYTES = 50 * 1024;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new Error(code); };
const bytes = value => Buffer.byteLength(value, 'utf8');
const splitLines = text => text.length === 0 ? [] : text.split('\n').slice(text.endsWith('\n') ? 0 : undefined, text.endsWith('\n') ? -1 : undefined);

export function validateFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0 || fixtures.length > 100) fail('invalid_fixtures');
  const ids = new Set();
  let totalBytes = 0;
  for (const fixture of fixtures) {
    if (!isObject(fixture) || typeof fixture.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(fixture.id) || ids.has(fixture.id)) fail('invalid_fixture_id');
    ids.add(fixture.id);
    if (!['test', 'build', 'unknown'].includes(fixture.kind) || typeof fixture.command !== 'string' || !Number.isInteger(fixture.exitCode) || fixture.exitCode < 0 || typeof fixture.text !== 'string' || !Array.isArray(fixture.mustKeep) || fixture.mustKeep.some(item => typeof item !== 'string' || item.length === 0) || new Set(fixture.mustKeep).size !== fixture.mustKeep.length || typeof fixture.notes !== 'string') fail('invalid_fixture');
    const fixtureBytes = bytes(fixture.text);
    totalBytes += fixtureBytes;
    if (fixtureBytes > 16 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024) fail('fixture_too_large');
    if (fixture.mustKeep.some(needle => !fixture.text.includes(needle))) fail('must_keep_not_in_source');
  }
}

// Matches Pi 0.85.0's built-in bash tail truncation, then its user-visible wrapper.
// Source line refs make omissions inspectable against the retained synthetic fixture.
export function piBashReturn(fixture) {
  const sourceLines = splitLines(fixture.text);
  const totalLines = sourceLines.length;
  const totalBytes = bytes(fixture.text);
  if (totalLines <= PI_MAX_LINES && totalBytes <= PI_MAX_BYTES) {
    return { text: withExitStatus(fixture.text || '(no output)', fixture.exitCode), truncation: null, omission: null, visibleLines: sourceLines.map((text, i) => ({ line: i + 1, text })) };
  }
  const retained = [];
  let used = 0;
  let truncatedBy = 'lines';
  let partial = false;
  for (let i = sourceLines.length - 1; i >= 0 && retained.length < PI_MAX_LINES; i--) {
    const line = sourceLines[i];
    const lineBytes = bytes(line) + (retained.length ? 1 : 0);
    if (used + lineBytes > PI_MAX_BYTES) {
      truncatedBy = 'bytes';
      if (retained.length === 0) {
        // Match Pi's UTF-8-safe last-byte slice for a single overlong final line.
        let start = Math.max(0, bytes(line) - PI_MAX_BYTES);
        while (start < bytes(line) && (Buffer.from(line)[start] & 0xc0) === 0x80) start++;
        const raw = Buffer.from(line);
        const shown = raw.subarray(start).toString('utf8');
        retained.unshift({ line: i + 1, text: shown });
        used = bytes(shown);
        partial = true;
      }
      break;
    }
    retained.unshift({ line: i + 1, text: line });
    used += lineBytes;
  }
  if (retained.length >= PI_MAX_LINES && used <= PI_MAX_BYTES) truncatedBy = 'lines';
  const shownText = retained.map(row => row.text).join('\n');
  const from = totalLines - retained.length + 1;
  const to = totalLines;
  const omission = partial
    ? `[Showing last ${formatSize(bytes(shownText))} of line ${to} (line is ${formatSize(bytes(sourceLines.at(-1)))}). Full output retained in fixture ${fixture.id}; see source line ${to}]`
    : truncatedBy === 'lines'
      ? `[Showing lines ${from}-${to} of ${totalLines}. Full output retained in fixture ${fixture.id}; omitted source lines 1-${from - 1}]`
      : `[Showing lines ${from}-${to} of ${totalLines} (${formatSize(PI_MAX_BYTES)} limit). Full output retained in fixture ${fixture.id}; omitted source lines 1-${from - 1}]`;
  const text = withExitStatus(`${shownText}\n\n${omission}`, fixture.exitCode);
  return {
    text,
    omission,
    truncation: { truncated: true, truncatedBy, totalLines, totalBytes, outputLines: retained.length, outputBytes: bytes(shownText), lastLinePartial: partial, firstLineExceedsLimit: false, maxLines: PI_MAX_LINES, maxBytes: PI_MAX_BYTES },
    visibleLines: retained,
  };
}

function formatSize(n) { return n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`; }
function withExitStatus(text, exitCode) { return exitCode === 0 ? text : `${text}\n\nCommand exited with code ${exitCode}`; }

// Only narrowly recognized common Node TAP, pytest, and TypeScript build lines are
// reduced. Any unfamiliar line or ambiguous/empty classification returns the input.
const TEST_LINE = /^(?:TAP version \d+|# (?:Subtest: .+|tests \d+|pass \d+|fail \d+|cancelled \d+|skipped \d+|todo \d+|duration_ms [\d.]+)|(?:ok|not ok) \d+(?: - .+)?|> .+|(?:✔|✖) .+|(?:Test Files? +\d+ .+|\s*Tests +\d+ .+|\s*Duration +[\d.]+s|\d+ passed(?:,? .*)?|\d+ failed(?:,? .*)?|\d+ skipped(?:,? .*)?|Summary: .+|=+ .* in [\d.]+s =+)|(?:ℹ (?:tests|pass|fail|cancelled|skipped|todo|duration_ms) .+)|(?:\s+at .+)|(?:\s+.+Error(?: \[.*\])?: .+)|\s*)$/;
const BUILD_LINE = /^(?:> .+|(?:> )?tsc(?: .*)?|(?:\[.*\] )?(?:info|warning|error) TS\d+:.*|(?:ERROR|WARNING) in .+|(?:webpack|vite) .*|building for .+|Circular dependency: .+|✓ \d+ modules transformed\.|build complete in [\d.]+ms|src\/.+: error TS\d+: .+|Build stopped while checking .+|compiled module-\d+\.mjs|Build failed with \d+ errors?\.|\s*)$/i;
function rulesFor(fixture) {
  // Failed commands may contain actionable context not captured by these narrow
  // progress rules. Keep their baseline intact rather than infer what is noise.
  if (fixture.exitCode !== 0) return null;
  if (fixture.kind === 'test') return { accepts: TEST_LINE, remove: /^(?:ok \d+(?: - .+)?|✔ .+)$/ };
  if (fixture.kind === 'build') return { accepts: BUILD_LINE, remove: /^compiled module-\d+\.mjs$/ };
  return null;
}

function selectedRowsForLocal(fixture, baseline) {
  const rules = rulesFor(fixture);
  if (!rules || baseline.visibleLines.some(({ text }) => !rules.accepts.test(text))) return null;
  // Delete only explicitly recognized successful progress rows; retain every
  // other recognized line, including warnings, diagnostics, and summaries.
  const chosen = baseline.visibleLines.filter(({ text }) => !rules.remove.test(text));
  if (!chosen.length || chosen.length === baseline.visibleLines.length) return null;
  return chosen;
}

function selectionText(fixture, rows, baseline) {
  const output = [];
  const totalLines = splitLines(fixture.text).length;
  if (rows.length === 0 && totalLines > 0) output.push(`[Omitted source lines 1-${totalLines}; no selected lines; see fixture ${fixture.id}]`);
  if (rows.length && rows[0].line > 1) output.push(`[Omitted source lines 1-${rows[0].line - 1}; see fixture ${fixture.id}]`);
  for (let i = 0; i < rows.length; i++) {
    if (i && rows[i].line > rows[i - 1].line + 1) output.push(`[Omitted source lines ${rows[i - 1].line + 1}-${rows[i].line - 1}; see fixture ${fixture.id}]`);
    output.push(`[Source line ${rows[i].line}] ${rows[i].text}`);
  }
  if (rows.length && rows.at(-1).line < totalLines) output.push(`[Omitted source lines ${rows.at(-1).line + 1}-${totalLines}; see fixture ${fixture.id}]`);
  if (baseline.omission) output.push(baseline.omission);
  return withExitStatus(output.join('\n') || '(no output)', fixture.exitCode);
}

function exactMustKeep(fixture, sourceRows) {
  const selectedSource = sourceRows.map(row => row.text).join('\n');
  const missing = fixture.mustKeep.filter(needle => !selectedSource.includes(needle));
  return { required: fixture.mustKeep.length, preserved: fixture.mustKeep.length - missing.length, missing };
}
function measurements(fixture, text, sourceRows, elapsedMs, method, baselineBytes) {
  const rawBytes = bytes(fixture.text);
  const returnedBytes = bytes(text);
  const deltaVsBaseline = returnedBytes - baselineBytes;
  return {
    method, sourceBytes: rawBytes, returnedBytes, returnedText: text,
    reductionBytes: rawBytes - returnedBytes,
    reductionRate: rawBytes === 0 ? null : (rawBytes - returnedBytes) / rawBytes,
    returnedByteDeltaVsBaseline: deltaVsBaseline,
    byteReductionVsBaseline: -deltaVsBaseline,
    byteReductionRateVsBaseline: baselineBytes === 0 ? null : -deltaVsBaseline / baselineBytes,
    mustKeep: exactMustKeep(fixture, sourceRows), localProcessingMs: elapsedMs,
    jevLatencyMs: null, jevCostUsd: null, wholeTaskSuccess: null, wholeTaskTimeMs: null, requeryCount: null,
  };
}

function parseSelectionRecord(selectionRecord, fixtureIds) {
  if (selectionRecord === undefined || selectionRecord === null) return null;
  if (!isObject(selectionRecord) || selectionRecord.kind !== 'observed-selection' || !Array.isArray(selectionRecord.cases) || selectionRecord.cases.length > fixtureIds.size) fail('invalid_selection_record');
  const seen = new Set();
  for (const row of selectionRecord.cases) {
    if (!isObject(row) || !fixtureIds.has(row.fixtureId) || seen.has(row.fixtureId) || !Array.isArray(row.lineRefs) || row.lineRefs.length > PI_MAX_LINES || typeof row.selectedText !== 'string' || bytes(row.selectedText) > 1024 * 1024) fail('invalid_selection_case');
    seen.add(row.fixtureId);
    if (row.lineRefs.some(ref => !isObject(ref) || !Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 1 || ref.end < ref.start) || (row.jevLatencyMs !== undefined && row.jevLatencyMs !== null && (!Number.isFinite(row.jevLatencyMs) || row.jevLatencyMs < 0)) || (row.jevCostUsd !== undefined && row.jevCostUsd !== null && (!Number.isFinite(row.jevCostUsd) || row.jevCostUsd < 0))) fail('invalid_selection_case');
  }
  return selectionRecord.cases;
}

function replaySelection(fixture, baseline, record) {
  if (!record) return { status: 'not_measured', text: null, selectedLineRefs: null, jevLatencyMs: null, jevCostUsd: null };
  const visible = new Map(baseline.visibleLines.map(row => [row.line, row.text]));
  const sourceLineCount = splitLines(fixture.text).length;
  const refs = [];
  for (const ref of record.lineRefs) {
    if (ref.end > sourceLineCount || (refs.length && ref.start <= refs.at(-1).end)) fail('invalid_selection_line_refs');
    if (Array.from({ length: ref.end - ref.start + 1 }, (_, i) => ref.start + i).some(line => !visible.has(line))) fail('selection_outside_pi_baseline');
    refs.push(ref);
  }
  const rows = refs.flatMap(ref => Array.from({ length: ref.end - ref.start + 1 }, (_, i) => ({ line: ref.start + i, text: visible.get(ref.start + i) })));
  const joined = rows.map(row => row.text).join('\n');
  if (joined !== record.selectedText) fail('selection_text_mismatch');
  const annotated = selectionText(fixture, rows, baseline);
  return { status: 'replayed', text: annotated, rows, selectedLineRefs: refs, jevLatencyMs: record.jevLatencyMs ?? null, jevCostUsd: record.jevCostUsd ?? null };
}

export function evaluate(fixtures, selectionRecord = null) {
  validateFixtures(fixtures);
  const records = parseSelectionRecord(selectionRecord, new Set(fixtures.map(fixture => fixture.id)));
  const rows = fixtures.map(fixture => {
    const start = performance.now();
    const baseline = piBashReturn(fixture);
    const baselineMs = performance.now() - start;
    const localStart = performance.now();
    let localRows = selectedRowsForLocal(fixture, baseline);
    let localText = localRows ? selectionText(fixture, localRows, baseline) : baseline.text;
    if (localRows && bytes(localText) >= bytes(baseline.text)) { localRows = null; localText = baseline.text; }
    const localMs = performance.now() - localStart;
    const record = records?.find(item => item.fixtureId === fixture.id);
    const replay = replaySelection(fixture, baseline, record);
    const sourceRows = baseline.visibleLines;
    return {
      fixtureId: fixture.id, kind: fixture.kind, command: fixture.command, exitCode: fixture.exitCode,
      baseline: measurements(fixture, baseline.text, sourceRows, baselineMs, 'pi-bash-0.85.0-tail', bytes(baseline.text)),
      local: measurements(fixture, localText, localRows ?? sourceRows, localMs, localRows ? 'recognized-local-rules' : 'fallback-to-baseline', bytes(baseline.text)),
      localFallback: !localRows,
      selection: replay.status === 'replayed' ? {
        status: replay.status, selectedLineRefs: replay.selectedLineRefs,
        ...measurements(fixture, replay.text, replay.rows, null, 'offline-replay-of-supplied-selection', bytes(baseline.text)),
        jevLatencyMs: replay.jevLatencyMs, jevCostUsd: replay.jevCostUsd,
      } : { status: 'not_measured', selectedLineRefs: null, sourceBytes: bytes(fixture.text), returnedBytes: null, reductionBytes: null, reductionRate: null, returnedByteDeltaVsBaseline: null, byteReductionVsBaseline: null, byteReductionRateVsBaseline: null, mustKeep: null, localProcessingMs: null, jevLatencyMs: null, jevCostUsd: null, wholeTaskSuccess: null, wholeTaskTimeMs: null, requeryCount: null },
      truncation: baseline.truncation,
    };
  });
  return {
    experiment: 'offline-context-output-selection',
    evidence: records ? 'The supplied selection records are replayed offline; this evaluator does not verify their origin or claim they are Jev output.' : 'No external selection record supplied; selection result is not measured (null).',
    byteMetric: 'Reduction is UTF-8 bytes of the returned text, including wrappers and status markers; it is not token savings.',
    limitations: 'Synthetic fixtures and local elapsed time do not establish task success, model round-trip speed, or whole-task speed improvement. Missing Jev latency/cost, success/time, and requery measurements remain unknown/null.',
    cases: rows,
  };
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  if (bytes(raw) > 1024 * 1024) fail('input_too_large');
  return JSON.parse(raw);
}
async function main(args) {
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--selection'))) fail('usage');
  const { fixtures } = await import('./fixtures.mjs');
  const record = args[0] === '--selection' ? await readJson(args[1]) : null;
  console.log(JSON.stringify(evaluate(fixtures, record), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('Evaluation failed: check fixture and selection schemas.'); process.exitCode = 1; });
}
