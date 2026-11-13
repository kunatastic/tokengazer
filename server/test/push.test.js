import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import handler from '../src/index.js';
import { memoryD1 } from './d1.js';

function setup() {
  const DB = memoryD1();
  DB.exec(`INSERT INTO users (github_id, login) VALUES (1, 'me');
    INSERT INTO machines (machine_id, github_id, api_key_hash) VALUES ('mach-0001', 1, '${createHash('sha256').update('k').digest('hex')}');`);
  const env = { DB };
  const push = async (...rows) => {
    const res = await handler.fetch(new Request('https://h/api/push', { method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify({ rows }) }), env);
    assert.equal(res.status, 200, await res.clone().text());
  };
  const rows = async () => (await (await handler.fetch(new Request('https://h/me.json'), env)).json()).rows
    .map((r) => `${r.day} ${r.tool} ${r.model} ${r.input}${r.estimated ? ' est' : ''}`);
  return { push, rows };
}
const r = (tool, input, estimated = false, day = '2026-01-01', model = tool) =>
  ({ day, tool, model, input, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, estimated });

test('push: rows of one day split across two pushes are both kept', async () => {
  const t = setup();
  await t.push(r('claude', 100));
  await t.push(r('codex', 50));
  assert.deepEqual(await t.rows(), ['2026-01-01 claude claude 100', '2026-01-01 codex codex 50']);
});

test('push: claude estimate never replaces measured claude when codex is measured that day', async () => {
  const t = setup();
  await t.push(r('claude', 100));
  await t.push(r('codex', 50), r('claude', 999, true));
  assert.deepEqual(await t.rows(), ['2026-01-01 claude claude 100', '2026-01-01 codex codex 50']);
});

test('push: a smaller measured value never shrinks a stored day', async () => {
  const t = setup();
  await t.push(r('claude', 100));
  await t.push(r('claude', 40));
  assert.deepEqual(await t.rows(), ['2026-01-01 claude claude 100']);
});

test('push: measured replaces an earlier estimate for that day and tool', async () => {
  const t = setup();
  await t.push(r('claude', 999, true, '2026-01-01', 'old-model'));
  await t.push(r('claude', 100));
  assert.deepEqual(await t.rows(), ['2026-01-01 claude claude 100']);
});

test('push: a newer estimate replaces the older one', async () => {
  const t = setup();
  await t.push(r('claude', 50, true, '2026-01-01', 'a'));
  await t.push(r('claude', 70, true, '2026-01-01', 'b'));
  assert.deepEqual(await t.rows(), ['2026-01-01 claude b 70 est']);
});
