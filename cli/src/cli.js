import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as config from './config.js';
import { scan } from './logs.js';

export const DEFAULT_HOST = process.env.TOKENGAZER_HOST || config.HOST;
export const GITHUB_CLIENT_ID = process.env.TOKENGAZER_GITHUB_CLIENT_ID || config.GITHUB_CLIENT_ID;
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const JOB_MARKER = 'tokengazer@';
const LABEL = 'dev.tokengazer.push';

const configPath = (home) => join(home, '.tokengazer/config.json');

export function readConfig(home) {
  try { return JSON.parse(readFileSync(configPath(home), 'utf8')); } catch { return null; }
}

export function writeConfig(home, config) {
  mkdirSync(join(home, '.tokengazer'), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(home), JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(configPath(home), 0o600);
}

export function chunk(rows, size = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export function chunkByDay(rows, size = 500) {
  const byDay = new Map();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) || []), r]);
  const out = [];
  let current = [];
  for (const group of byDay.values()) {
    if (current.length && current.length + group.length > size) { out.push(current); current = []; }
    current = current.concat(group);
  }
  if (current.length) out.push(current);
  return out;
}

export async function push({ home, host, fetchImpl = fetch }) {
  const config = readConfig(home);
  if (!config?.api_key) throw new Error('not logged in — run: npx tokengazer login');
  const base = host || config.host || DEFAULT_HOST;
  let stored = 0;
  for (const rows of chunkByDay(scan(home))) {
    const res = await fetchImpl(`${base}/api/push`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.api_key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
    if (!res.ok) throw new Error(`push failed: ${res.status} ${await res.text()}`);
    stored += (await res.json()).stored;
  }
  return stored;
}

// Absolute npx next to the node that ran login: the hourly job has no shell profile, so nvm-style PATHs are missing.
export function scheduleCommand(platform, nodePath, home, version = VERSION) {
  const bin = dirname(nodePath);
  const path = `${bin}:/usr/bin:/bin`;
  const log = join(home, '.tokengazer/push.log');
  const args = [join(bin, 'npx'), '-y', `tokengazer@${version}`, 'push'];
  if (platform === 'darwin') {
    return {
      file: join(home, 'Library/LaunchAgents', `${LABEL}.plist`),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
${args.map((a) => `    <string>${a}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path}</string></dict>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`,
    };
  }
  return { content: `0 * * * * PATH=${path} ${args.join(' ')} >>${log} 2>&1` };
}

const run = (cmd, args, input) => {
  try { return execFileSync(cmd, args, { input, stdio: ['pipe', 'pipe', 'ignore'] }).toString(); } catch { return ''; }
};

export function installSchedule(home) {
  const s = scheduleCommand(process.platform, process.execPath, home);
  if (s.file) {
    mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
    writeFileSync(s.file, s.content);
    run('launchctl', ['unload', s.file]);
    run('launchctl', ['load', '-w', s.file]);
  } else {
    const current = run('crontab', ['-l']);
    const others = current.split('\n').filter((l) => l && !l.includes(JOB_MARKER));
    run('crontab', ['-'], `${[...others, s.content].join('\n')}\n`);
  }
}

export function removeSchedule(home) {
  const s = scheduleCommand(process.platform, process.execPath, home);
  if (s.file) {
    run('launchctl', ['unload', s.file]);
    rmSync(s.file, { force: true });
  } else {
    const current = run('crontab', ['-l']);
    if (current.includes(JOB_MARKER)) run('crontab', ['-'], current.split('\n').filter((l) => !l.includes(JOB_MARKER)).join('\n'));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function githubPost(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return res.json();
}

async function githubDeviceToken(log) {
  const code = await githubPost('https://github.com/login/device/code', { client_id: GITHUB_CLIENT_ID });
  if (!code.device_code) throw new Error(`GitHub device login unavailable: ${code.error_description || code.error}`);
  log(`\n  Open ${code.verification_uri} and enter code: ${code.user_code}\n`);
  spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [code.verification_uri], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  let interval = code.interval || 5;
  const deadline = Date.now() + (code.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const t = await githubPost('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID, device_code: code.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (t.access_token) return t.access_token;
    if (t.error === 'slow_down') interval = t.interval || interval + 5;
    else if (t.error !== 'authorization_pending') throw new Error(`GitHub login failed: ${t.error_description || t.error}`);
  }
  throw new Error('GitHub login timed out');
}

function cleanupTip(home) {
  try {
    const days = JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8')).cleanupPeriodDays;
    if (days >= 365) return null;
  } catch {}
  return 'Tip: Claude Code deletes session logs after 30 days. To keep exact history, add "cleanupPeriodDays": 3650 to ~/.claude/settings.json.';
}

export async function login({ home, host = DEFAULT_HOST, log = console.log }) {
  const githubToken = await githubDeviceToken(log);
  const machine_id = readConfig(home)?.machine_id || randomUUID();
  const res = await fetch(`${host}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ github_token: githubToken, machine_id }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const { api_key, login: user } = await res.json();
  writeConfig(home, { api_key, login: user, machine_id, host });
  log(`✓ Signed in as @${user}`);
  installSchedule(home);
  log('✓ Auto-refresh every hour');
  log(`✓ Pushed ${await push({ home })} daily rows`);
  const tip = cleanupTip(home);
  if (tip) log(`\n  ${tip}`);
  log(`\n  Paste this into your README:\n  [![tokens](${host}/${user}.svg)](${host}/${user})\n`);
}

export async function logout({ home, deleteData = false, log = console.log, unschedule = removeSchedule }) {
  const config = readConfig(home);
  if (deleteData && config?.api_key) {
    const res = await fetch(`${config.host || DEFAULT_HOST}/api/me`, { method: 'DELETE', headers: { authorization: `Bearer ${config.api_key}` } });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
    log('✓ Deleted your data from the server');
  }
  unschedule(home);
  // Keep machine_id: a new id on re-login would add a second copy of this machine's history.
  if (config?.machine_id) writeConfig(home, { machine_id: config.machine_id });
  log('✓ Logged out');
}

const tokensOf = (r) => (r.tool === 'codex' ? r.input + r.output : r.input + r.output + r.cache_read + r.cache_write);
const fmt = (n) => {
  for (const [d, u] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (n >= d) return (n / d >= 100 ? Math.round(n / d) : (n / d).toFixed(1)) + u;
  return String(Math.round(n));
};

export function summary(home) {
  const rows = scan(home);
  const sum = (f) => rows.filter(f).reduce((a, r) => a + tokensOf(r), 0);
  const days = new Set(rows.map((r) => r.day));
  const est = sum((r) => r.estimated);
  const lines = [
    `  ${est ? '~' : ''}${fmt(sum(() => true))} tokens over ${days.size} active days${est ? ` (${fmt(est)} estimated from prompt history)` : ''}`,
    `  ${fmt(sum((r) => r.tool === 'claude'))} Claude · ${fmt(sum((r) => r.tool === 'codex'))} Codex`,
    '',
    ...[...days].sort().slice(-7).map((d) => `  ${d}  ${fmt(sum((r) => r.day === d)).padStart(6)}`),
  ];
  const config = readConfig(home);
  lines.push('', config?.api_key ? `  Profile: ${config.host}/${config.login}` : '  Publish your graph: npx tokengazer login');
  return lines.join('\n');
}
