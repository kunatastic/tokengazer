import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeLines, parseCodexLines, aggregate, estimateClaude, scan } from '../src/logs.js';

const claudeLine = (id, req, ts, u, model = 'claude-opus-5-5') => JSON.stringify({
  type: 'assistant', requestId: req, timestamp: ts,
  message: { id, model, usage: u },
});
const u = { input_tokens: 2, output_tokens: 146, cache_creation_input_tokens: 45369, cache_read_input_tokens: 27693 };

test('claude: maps usage fields', () => {
  const [r] = parseClaudeLines([claudeLine('m1', 'r1', '2026-11-12T10:00:00Z', u)], new Set());
  assert.deepEqual(r, { ts: '2026-11-12T10:00:00Z', tool: 'claude', model: 'claude-opus-5-5',
    input: 2, output: 146, cache_read: 27693, cache_write: 45369, reasoning: 0 });
});
test('claude: dedupes message.id+requestId across calls via shared seen set', () => {
  const seen = new Set();
  const a = parseClaudeLines([claudeLine('m1', 'r1', '2026-11-12T10:00:00Z', u)], seen);
  const b = parseClaudeLines([claudeLine('m1', 'r1', '2026-11-12T10:00:00Z', u)], seen);
  assert.equal(a.length + b.length, 1);
});
test('claude: skips malformed lines, non-assistant lines, and all-zero usage', () => {
  const zero = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const out = parseClaudeLines(['{"type":"assist', '{"type":"user"}',
    claudeLine('m2', 'r2', '2026-11-12T10:00:00Z', zero)], new Set());
  assert.equal(out.length, 0);
});
test('claude: skips <synthetic> model', () =>
  assert.equal(parseClaudeLines([claudeLine('m9', 'r9', '2026-11-12T10:00:00Z', u, '<synthetic>')], new Set()).length, 0));

const codexLines = [
  JSON.stringify({ timestamp: '2026-10-30T07:24:09Z', type: 'turn_context', payload: { model: 'gpt-6-astra' } }),
  JSON.stringify({ timestamp: '2026-10-30T07:24:10Z', type: 'event_msg', payload: { type: 'token_count', info: null } }),
  JSON.stringify({ timestamp: '2026-10-30T07:24:11Z', type: 'event_msg', payload: { type: 'token_count', info: {
    total_token_usage: { input_tokens: 99999, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 },
    last_token_usage: { input_tokens: 32921, cached_input_tokens: 7808, output_tokens: 48, reasoning_output_tokens: 10 } } } }),
];
test('codex: uses last_token_usage, model from turn_context, skips null info', () => {
  assert.deepEqual(parseCodexLines(codexLines), [{ ts: '2026-10-30T07:24:11Z', tool: 'codex', model: 'gpt-6-astra',
    input: 32921, output: 48, cache_read: 7808, cache_write: 0, reasoning: 10 }]);
});
test('codex: skips re-emitted token_count with unchanged total', () => {
  assert.equal(parseCodexLines([...codexLines, codexLines[2]]).length, 1);
});
test('codex: token_usage_record wins when present', () => {
  const rec = JSON.stringify({ timestamp: '2026-10-30T08:00:00Z', type: 'token_usage_record', payload: { usage: { input_tokens: 5, cached_input_tokens: 1, output_tokens: 2, reasoning_output_tokens: 0 } } });
  assert.deepEqual(parseCodexLines([...codexLines, rec]).map((x) => x.input), [5]);
});

test('aggregate: buckets by local day (TZ=Asia/Kolkata) and sums per tool+model', () => {
  const base = { tool: 'claude', model: 'm', input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0 };
  const rows = aggregate([{ ...base, ts: '2026-11-12T20:00:00Z' }, { ...base, ts: '2026-11-13T01:00:00Z' }]);
  assert.deepEqual(rows, [{ ...base, day: '2026-11-13', input: 2, output: 2, estimated: false }]);
});

test('estimateClaude: median tokens/prompt, split by stats-cache models, only for days without logs', () => {
  const m = (day, n) => ({ day, tool: 'claude', model: 'claude-opus-5-5', input: 0, output: n, cache_read: 0, cache_write: 0, reasoning: 0, estimated: false });
  const rows = [m('2026-10-10', 100), m('2026-10-11', 300), m('2026-10-12', 1000)];
  const prompts = new Map([['2026-10-10', 1], ['2026-10-11', 1], ['2026-10-12', 1], ['2026-05-01', 10]]);
  const est = estimateClaude(rows, prompts, new Map([['2026-05-01', { 'claude-opus-4-6': 3, 'claude-sonnet-4-6': 1 }]]));
  assert.deepEqual(est.map((r) => [r.day, r.model, r.output, r.estimated]),
    [['2026-05-01', 'claude-opus-4-6', 2250, true], ['2026-05-01', 'claude-sonnet-4-6', 750, true]]);
});
test('estimateClaude: no measured days means no estimates', () =>
  assert.deepEqual(estimateClaude([], new Map([['2026-05-01', 3]]), new Map()), []));

test('scan: works when only one tool is installed', () => {
  const home = mkdtempSync(join(tmpdir(), 'tg-'));
  mkdirSync(join(home, '.codex/sessions/2026/10/30'), { recursive: true });
  writeFileSync(join(home, '.codex/sessions/2026/10/30/rollout.jsonl'), codexLines.join('\n'));
  assert.equal(scan(home).length, 1);
});
