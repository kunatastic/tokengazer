import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { validateRows } from '../src/index.js';

const ok = { day: '2026-11-12', tool: 'claude', model: 'm', input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0, estimated: false };
test('accepts valid rows', () => assert.equal(validateRows([ok], '2026-11-12').ok, true));
test('accepts tomorrow (user timezone ahead of UTC)', () => assert.equal(validateRows([{ ...ok, day: '2026-11-13' }], '2026-11-12').ok, true));
for (const [name, bad] of [
  ['negative', { ...ok, input: -1 }], ['future', { ...ok, day: '2026-11-14' }], ['too old', { ...ok, day: '2022-12-31' }],
  ['over ceiling', { ...ok, output: 1e10 + 1 }], ['bad tool', { ...ok, tool: 'cursor' }], ['bad day', { ...ok, day: '12/11/2026' }],
  ['estimated not boolean', { ...ok, estimated: 'yes' }], ['non-integer', { ...ok, input: 1.5 }], ['empty model', { ...ok, model: '' }],
]) test(`rejects ${name}`, () => assert.equal(validateRows([bad], '2026-11-12').ok, false));
test('rejects more than 500 rows', () => assert.equal(validateRows(Array(501).fill(ok), '2026-11-12').ok, false));
test('rejects non-array', () => assert.equal(validateRows({}, '2026-11-12').ok, false));

// Minimal D1 stub: routes SQL by the table it reads.
const db = (users, usage) => ({
  prepare: (sql) => ({
    bind: (...args) => ({
      first: async () => (/FROM users/.test(sql) ? users.find((u) => u.login === args[0]) || null : null),
      all: async () => ({ results: /FROM usage/.test(sql) ? usage : [] }),
      run: async () => ({}),
    }),
  }),
});
const env = { DB: db([{ github_id: 1, login: 'kunatastic' }], [{ ...ok, day: new Date().toISOString().slice(0, 10), input: 5e9 }]) };
const get = (path) => handler.fetch(new Request(`https://h${path}`), env);

test('GET /<Login>.svg is case-insensitive and cached for an hour', async () => {
  const res = await get('/Kunatastic.svg');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  assert.match(await res.text(), /5\.0B TOKENS/);
});
test('GET unknown user svg → 200 not-tracking card', async () => {
  const res = await get('/nobody.svg');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /NOT TRACKING YET/);
});
test('GET /favicon.ico → 404', async () => assert.equal((await get('/favicon.ico')).status, 404));
test('GET /<login>.json returns rows', async () => {
  const body = await (await get('/kunatastic.json')).json();
  assert.equal(body.login, 'kunatastic');
  assert.equal(body.rows.length, 1);
});
test('GET /<login> returns html profile; unknown → 404', async () => {
  assert.match(await (await get('/kunatastic')).text(), /<!doctype html>/);
  assert.equal((await get('/nobody')).status, 404);
});
test('POST /api/push without key → 401', async () => {
  const res = await handler.fetch(new Request('https://h/api/push', { method: 'POST', body: '{"rows":[]}' }), env);
  assert.equal(res.status, 401);
});
test('GET / serves the landing page with install commands', async () => {
  const res = await get('/');
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await res.text(), /npx tokengazer login/);
});
test('GET /llms.txt describes the endpoints for this host', async () => {
  const body = await (await get('/llms.txt')).text();
  assert.match(body, /^# tokengazer/);
  assert.match(body, /https:\/\/h\/<github-username>\.svg/);
});
test('PUBLIC_HOST overrides the request origin in links', async () => {
  const res = await handler.fetch(new Request('https://h/llms.txt'), { ...env, PUBLIC_HOST: 'https://tokengazer.vercel.app' });
  assert.match(await res.text(), /https:\/\/tokengazer\.vercel\.app\/<github-username>\.svg/);
});
