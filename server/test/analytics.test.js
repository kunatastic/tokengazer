import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import handler from '../src/index.js';
import { memoryD1 } from './d1.js';

afterEach(() => mock.restoreAll());

function setup() {
  const DB = memoryD1();
  DB.exec(`INSERT INTO users (github_id, login) VALUES (1, 'me');
    INSERT INTO machines (machine_id, github_id, api_key_hash) VALUES ('mach-0001', 1, '${createHash('sha256').update('k').digest('hex')}');`);
  const points = [];
  const env = { DB, EVENTS: { writeDataPoint: (p) => points.push(p) }, STATS_PASSWORD: 'pw', CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'tok' };
  const call = (path, init) => handler.fetch(new Request(`https://h${path}`, init), env);
  const events = () => points.map((p) => p.blobs.slice(0, 3).join(' '));
  return { env, call, events, DB };
}
const row = { day: '2026-01-01', tool: 'claude', model: 'm', input: 1, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, estimated: false };

test('records card, page and json views tagged with the lowercased login', async () => {
  const t = setup();
  await t.call('/Me.svg');
  await t.call('/me');
  await t.call('/me.json');
  await t.call('/nobody.svg');
  assert.deepEqual(t.events(), ['card_view me ', 'page_view me ', 'json_view me ', 'card_view nobody ']);
});

test('does not record 404s, the landing page or /stats', async () => {
  const t = setup();
  await t.call('/favicon.ico');
  await t.call('/');
  await t.call('/stats');
  assert.deepEqual(t.events(), []);
});

test('records push with row count and sets last_push_at', async () => {
  const t = setup();
  await t.call('/api/push', { method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify({ rows: [row, { ...row, tool: 'codex' }] }) });
  assert.deepEqual(t.events(), ['push me ']);
  assert.equal(t.env.EVENTS && (await t.DB.prepare('SELECT 1 FROM machines WHERE last_push_at IS NOT NULL').first()) !== null, true);
});

test('records login as new, then returning, and failed logins', async () => {
  const t = setup();
  mock.method(globalThis, 'fetch', async (url, init) =>
    init.headers.authorization === 'Bearer good' ? Response.json({ id: 2, login: 'Newbie' }) : new Response('', { status: 401 }));
  const login = (token) => t.call('/api/login', { method: 'POST', body: JSON.stringify({ github_token: token, machine_id: 'mach-0002' }) });
  await login('good');
  await login('good');
  await login('bad');
  assert.deepEqual(t.events(), ['login newbie new', 'login newbie returning', 'login_failed  ']);
});

test('records delete', async () => {
  const t = setup();
  await t.call('/api/me', { method: 'DELETE', headers: { authorization: 'Bearer k' } });
  assert.deepEqual(t.events(), ['delete me ']);
});

test('/stats requires the password', async () => {
  const t = setup();
  const res = await t.call('/stats');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /^Basic/);
  const wrong = await t.call('/stats', { headers: { authorization: `Basic ${btoa('x:nope')}` } });
  assert.equal(wrong.status, 401);
});

test('/stats is disabled when no password is configured', async () => {
  const t = setup();
  delete t.env.STATS_PASSWORD;
  assert.equal((await t.call('/stats', { headers: { authorization: `Basic ${btoa('x:')}` } })).status, 401);
});

test('/stats shows signups, active uploaders and event counts', async () => {
  const t = setup();
  t.DB.exec("UPDATE machines SET last_push_at = datetime('now')");
  const sql = [];
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/acc/analytics_engine/sql');
    assert.equal(init.headers.authorization, 'Bearer tok');
    sql.push(init.body);
    return Response.json({ data: init.body.includes('GROUP BY event, day') ? [{ event: 'card_view', day: '2026-11-13', n: 42 }] : [{ login: 'me', n: 42 }] });
  });
  const res = await t.call('/stats', { headers: { authorization: `Basic ${btoa('admin:pw')}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.match(html, /Users<\/th><td>1</);
  assert.match(html, /Active uploaders \(7d\)<\/th><td>1</);
  assert.match(html, /card_view/);
  assert.match(html, />42</);
  assert.ok(sql.every((q) => q.includes('tokengazer_events')));
});
