import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf, costOf, summarize, fmt, PRICES } from '../src/stats.js';

const P = { 'claude-opus': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 }, 'gpt-6': { input: 2, output: 10, cache_read: 0.2, cache_write: 0 } };
const row = (o) => ({ day: '2026-11-12', tool: 'claude', model: 'claude-opus-5-5', input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, estimated: false, ...o });

test('tokensOf: claude counts cache, codex does not double count', () => {
  assert.equal(tokensOf(row({ input: 1, output: 2, cache_read: 3, cache_write: 4 })), 10);
  assert.equal(tokensOf(row({ tool: 'codex', input: 100, cache_read: 40, output: 10, reasoning: 5 })), 110);
});
test('costOf: claude bills each field at its rate', () =>
  assert.ok(Math.abs(costOf(row({ input: 1e6, output: 1e6, cache_read: 1e6, cache_write: 1e6 }), P) - 36.75) < 1e-9));
test('costOf: codex bills uncached input at input rate, cached at cache_read rate', () => {
  const c = costOf(row({ tool: 'codex', model: 'gpt-6-astra', input: 1e6, cache_read: 4e5, output: 1e6 }), P);
  assert.ok(Math.abs(c - 11.28) < 1e-9);
});
test('costOf: longest prefix wins', () => {
  const p = { ...P, 'claude-opus-5': { input: 1, output: 0, cache_read: 0, cache_write: 0 } };
  assert.equal(costOf(row({ input: 1e6 }), p), 1);
});
test('costOf: unknown model costs 0', () => assert.equal(costOf(row({ model: 'mystery', input: 1e6 }), P), 0));
test('PRICES covers the models in use', () => {
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'gpt-6-astra'])
    assert.ok(costOf(row({ model: m, tool: m.startsWith('gpt') ? 'codex' : 'claude', input: 1e6 })) > 0, m);
  assert.ok(Object.keys(PRICES).length > 0);
});
test('summarize: streak counts back from today, or from yesterday if today is empty', () => {
  const rows = ['2026-11-10', '2026-11-11', '2026-11-12'].map((day) => row({ day, input: 1 }));
  assert.equal(summarize(rows, '2026-11-13').streak, 3);
  assert.equal(summarize(rows, '2026-11-12').streak, 3);
  assert.equal(summarize(rows, '2026-11-14').streak, 0);
});
test('summarize: totals and split', () => {
  const s = summarize([row({ input: 5 }), row({ tool: 'codex', model: 'gpt-6', input: 3 })], '2026-11-12');
  assert.deepEqual([s.tokens, s.activeDays, s.byTool.claude, s.byTool.codex], [8, 1, 5, 3]);
  assert.equal(s.byDay.get('2026-11-12'), 8);
});
test('summarize: estimated tokens counted and tracked', () => {
  const s = summarize([row({ input: 5 }), row({ day: '2026-05-01', input: 7, estimated: true })], '2026-11-12');
  assert.deepEqual([s.tokens, s.estimatedTokens, [...s.estimatedDays]], [12, 7, ['2026-05-01']]);
});
test('summarize: byModel sorted by tokens desc', () => {
  const s = summarize([row({ input: 1 }), row({ model: 'claude-sonnet-5-5', input: 9 })], '2026-11-12');
  assert.deepEqual(s.byModel.map((m) => m.model), ['claude-sonnet-5-5', 'claude-opus-5-5']);
});
test('fmt', () => assert.deepEqual([3e9, 9.5e8, 12300, 999, 0].map(fmt), ['3.0B', '950M', '12.3K', '999', '0']));
