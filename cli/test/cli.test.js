import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunk, push, scheduleCommand, writeConfig, readConfig } from '../src/cli.js';

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

test('schedule: launchd hourly via login shell', () => {
  const s = scheduleCommand('darwin', '/bin/zsh', '/Users/me');
  assert.equal(s.file, '/Users/me/Library/LaunchAgents/dev.tokengazer.push.plist');
  assert.match(s.content, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.match(s.content, /<string>\/bin\/zsh<\/string>\s*<string>-lc<\/string>\s*<string>npx -y tokengazer@latest push<\/string>/);
});
test('schedule: linux crontab line', () =>
  assert.equal(scheduleCommand('linux', '/bin/bash', '/home/me').content, "0 * * * * /bin/bash -lc 'npx -y tokengazer@latest push' >/dev/null 2>&1"));
