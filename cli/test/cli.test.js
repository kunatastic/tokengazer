import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunk, chunkByDay, isNewer, latestVersion, push, logout, scheduleCommand, writeConfig, readConfig } from '../src/cli.js';

function fakeHomeWithConfigAndCodexLog() {
  const home = mkdtempSync(join(tmpdir(), 'tg-'));
  writeConfig(home, { api_key: 'k', login: 'me', machine_id: 'mach-0001', host: 'https://h' });
  mkdirSync(join(home, '.codex/sessions/2026/10/30'), { recursive: true });
  writeFileSync(join(home, '.codex/sessions/2026/10/30/r.jsonl'), [
    JSON.stringify({ timestamp: '2026-10-30T07:24:09Z', type: 'turn_context', payload: { model: 'gpt-6-astra' } }),
    JSON.stringify({ timestamp: '2026-10-30T07:24:11Z', type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 1 }, last_token_usage: { input_tokens: 10, output_tokens: 2 } } } }),
  ].join('\n'));
  return home;
}

test('chunk splits into ≤500', () => assert.deepEqual(chunk(Array(1201).fill(0)).map((c) => c.length), [500, 500, 201]));

test('config is written with mode 600', () => {
  const home = fakeHomeWithConfigAndCodexLog();
  assert.equal(statSync(join(home, '.tokengazer/config.json')).mode & 0o777, 0o600);
  assert.equal(readConfig(home).login, 'me');
});

test('push sends chunks with bearer key', async () => {
  const home = fakeHomeWithConfigAndCodexLog(); const calls = [];
  const n = await push({ home, host: 'https://h', fetchImpl: async (u, o) => (calls.push([u, o]), new Response('{"stored":1}')) });
  assert.equal(calls[0][0], 'https://h/api/push');
  assert.equal(calls[0][1].headers.authorization, 'Bearer k');
  assert.equal(JSON.parse(calls[0][1].body).rows[0].tool, 'codex');
  assert.equal(n, 1);
});

test('push rejects on network error and leaves config unchanged', async () => {
  const home = fakeHomeWithConfigAndCodexLog(); const before = readFileSync(join(home, '.tokengazer/config.json'), 'utf8');
  await assert.rejects(push({ home, host: 'https://h', fetchImpl: async () => { throw new TypeError('fetch failed'); } }));
  assert.equal(readFileSync(join(home, '.tokengazer/config.json'), 'utf8'), before);
});

test('push rejects on non-200', async () => {
  const home = fakeHomeWithConfigAndCodexLog();
  await assert.rejects(push({ home, host: 'https://h', fetchImpl: async () => new Response('{"error":"bad day"}', { status: 400 }) }), /400/);
});

test('push without login rejects', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tg-'));
  await assert.rejects(push({ home, host: 'https://h', fetchImpl: async () => new Response('{}') }), /login/);
});

test('schedule: launchd hourly, pinned version, npx next to the current node (works under nvm)', () => {
  const s = scheduleCommand('darwin', '/Users/me/.nvm/versions/node/v24/bin/node', '/Users/me', '0.1.0');
  assert.equal(s.file, '/Users/me/Library/LaunchAgents/dev.tokengazer.push.plist');
  assert.match(s.content, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.match(s.content, /<string>\/Users\/me\/.nvm\/versions\/node\/v24\/bin\/npx<\/string>\s*<string>-y<\/string>\s*<string>tokengazer@0\.1\.0<\/string>\s*<string>push<\/string>/);
  assert.match(s.content, /<key>PATH<\/key><string>\/Users\/me\/.nvm\/versions\/node\/v24\/bin:\/usr\/bin:\/bin<\/string>/);
  assert.ok(!s.content.includes('@latest'));
});
test('schedule: linux crontab line, pinned and logged', () =>
  assert.equal(scheduleCommand('linux', '/opt/node/bin/node', '/home/me', '0.1.0').content,
    "0 * * * * PATH=/opt/node/bin:/usr/bin:/bin /opt/node/bin/npx -y tokengazer@0.1.0 push >>/home/me/.tokengazer/push.log 2>&1"));

test('chunkByDay never splits a day across chunks', () => {
  const rows = [...Array(400)].map((_, i) => ({ day: `2026-01-${String(1 + (i % 3)).padStart(2, '0')}` }));
  const chunks = chunkByDay(rows, 250);
  for (const c of chunks) assert.ok(c.length <= 250);
  const seen = new Map();
  chunks.forEach((c, i) => c.forEach((r) => { if (seen.has(r.day)) assert.equal(seen.get(r.day), i, r.day); seen.set(r.day, i); }));
  assert.equal(chunks.flat().length, 400);
});

test('logout keeps machine_id so re-login reuses the same server rows', async () => {
  const home = fakeHomeWithConfigAndCodexLog();
  await logout({ home, log: () => {}, unschedule: () => {} });
  assert.deepEqual(readConfig(home), { machine_id: 'mach-0001' });
});

test('isNewer compares semver numerically and ignores prerelease tags', () => {
  assert.equal(isNewer('0.1.10', '0.1.9'), true);
  assert.equal(isNewer('0.2.0', '0.10.0'), false);
  assert.equal(isNewer('0.1.1', '0.1.1'), false);
  assert.equal(isNewer('0.0.0-stage', '0.1.0'), false);
});

test('latestVersion returns the newer npm version, or null when current or offline', async () => {
  const npm = (version) => async () => ({ json: async () => ({ version }) });
  assert.equal(await latestVersion({ fetchImpl: npm('0.2.0'), current: '0.1.1' }), '0.2.0');
  assert.equal(await latestVersion({ fetchImpl: npm('0.1.1'), current: '0.1.1' }), null);
  assert.equal(await latestVersion({ fetchImpl: async () => { throw new Error('offline'); }, current: '0.1.1' }), null);
});
