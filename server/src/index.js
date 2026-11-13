import { summarize } from './stats.js';
import { logoSvg, renderCard, renderPage, renderStats } from './render.js';

const FIELDS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];
const MAX_ROWS = 500;
const CEILING = 10_000_000_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function validateRows(rows, todayUtc) {
  if (!Array.isArray(rows)) return { ok: false, error: 'rows must be an array' };
  if (rows.length > MAX_ROWS) return { ok: false, error: `at most ${MAX_ROWS} rows per push` };
  const latest = addDays(todayUtc, 1);
  for (const r of rows) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'row must be an object' };
    if (typeof r.day !== 'string' || !DAY_RE.test(r.day) || r.day < '2023-01-01' || r.day > latest) return { ok: false, error: `bad day ${r.day}` };
    if (r.tool !== 'claude' && r.tool !== 'codex') return { ok: false, error: `bad tool ${r.tool}` };
    if (typeof r.model !== 'string' || !r.model || r.model.length > 100) return { ok: false, error: 'bad model' };
    if (typeof r.estimated !== 'boolean') return { ok: false, error: 'estimated must be boolean' };
    for (const f of FIELDS) if (!Number.isInteger(r[f]) || r[f] < 0 || r[f] > CEILING) return { ok: false, error: `bad ${f}` };
  }
  return { ok: true, rows };
}

function track(env, event, login = '', detail = '', n = 1) {
  env.EVENTS?.writeDataPoint({ blobs: [event, login, detail], doubles: [n], indexes: [event] });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function machineFor(req, env) {
  const key = req.headers.get('authorization')?.match(/^Bearer (\w+)$/)?.[1];
  if (!key) return null;
  return env.DB.prepare('SELECT m.machine_id, m.github_id, u.login FROM machines m JOIN users u ON u.github_id = m.github_id WHERE m.api_key_hash = ?')
    .bind(await sha256(key)).first();
}

async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.machine_id !== 'string' || !/^[\w-]{8,64}$/.test(body.machine_id) || typeof body.github_token !== 'string') return json({ error: 'bad request' }, 400);
  const gh = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${body.github_token}`, 'user-agent': 'tokengazer', accept: 'application/vnd.github+json' },
  });
  if (!gh.ok) {
    track(env, 'login_failed');
    return json({ error: 'github auth failed' }, 401);
  }
  const { id, login: rawLogin } = await gh.json();
  const userLogin = String(rawLogin).toLowerCase();
  const existing = await env.DB.prepare('SELECT 1 FROM users WHERE github_id = ?').bind(id).first();
  const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    // A renamed account can leave its old login behind; free it for whoever owns it on GitHub now.
    env.DB.prepare("UPDATE users SET login = login || '~' || github_id WHERE login = ? AND github_id != ?").bind(userLogin, id),
    env.DB.prepare('INSERT INTO users (github_id, login) VALUES (?, ?) ON CONFLICT(github_id) DO UPDATE SET login = excluded.login').bind(id, userLogin),
    env.DB.prepare(`INSERT INTO machines (machine_id, github_id, api_key_hash) VALUES (?, ?, ?)
      ON CONFLICT(machine_id) DO UPDATE SET github_id = excluded.github_id, api_key_hash = excluded.api_key_hash`).bind(body.machine_id, id, await sha256(key)),
  ]);
  track(env, 'login', userLogin, existing ? 'returning' : 'new');
  return json({ api_key: key, login: userLogin });
}

async function push(req, env) {
  const m = await machineFor(req, env);
  if (!m) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  const v = validateRows(body?.rows, utcToday());
  if (!v.ok) return json({ error: v.error }, 400);
  const dayTools = [...new Set(v.rows.map((r) => `${r.day}|${r.tool}`))];
  // Measured rows only ever grow (Claude deletes old logs, so a later scan can see less);
  // estimates are replaced per (day, tool) and never land where a measured row exists.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage WHERE machine_id = ?1 AND estimated = 1 AND day || '|' || tool IN (SELECT value FROM json_each(?2))")
      .bind(m.machine_id, JSON.stringify(dayTools)),
    env.DB.prepare(`INSERT INTO usage (github_id, machine_id, day, tool, model, input, output, cache_read, cache_write, reasoning, estimated)
      SELECT ?1, ?2, j.value->>'day', j.value->>'tool', j.value->>'model', j.value->>'input', j.value->>'output',
             j.value->>'cache_read', j.value->>'cache_write', j.value->>'reasoning', j.value->>'estimated'
      FROM json_each(?3) j
      WHERE j.value->>'estimated' = 0
         OR NOT EXISTS (SELECT 1 FROM usage u WHERE u.machine_id = ?2 AND u.day = j.value->>'day' AND u.tool = j.value->>'tool' AND u.estimated = 0)
      ON CONFLICT (github_id, machine_id, day, tool, model) DO UPDATE SET
        input = MAX(input, excluded.input), output = MAX(output, excluded.output), cache_read = MAX(cache_read, excluded.cache_read),
        cache_write = MAX(cache_write, excluded.cache_write), reasoning = MAX(reasoning, excluded.reasoning)`)
      .bind(m.github_id, m.machine_id, JSON.stringify(v.rows)),
    env.DB.prepare("UPDATE machines SET last_push_at = datetime('now') WHERE machine_id = ?").bind(m.machine_id),
  ]);
  track(env, 'push', m.login, '', v.rows.length);
  return json({ stored: v.rows.length });
}

async function deleteMe(req, env) {
  const m = await machineFor(req, env);
  if (!m) return json({ error: 'unauthorized' }, 401);
  track(env, 'delete', m.login);
  await env.DB.batch(['usage', 'machines', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE github_id = ?`).bind(m.github_id)));
  return json({ deleted: true });
}

async function loadUser(env, login) {
  const user = await env.DB.prepare('SELECT github_id, login FROM users WHERE login = ?').bind(login.toLowerCase()).first();
  if (!user) return null;
  const { results } = await env.DB.prepare(`SELECT day, tool, model, SUM(input) input, SUM(output) output, SUM(cache_read) cache_read,
      SUM(cache_write) cache_write, SUM(reasoning) reasoning, MIN(estimated) estimated
    FROM usage WHERE github_id = ? GROUP BY day, tool, model ORDER BY day`).bind(user.github_id).all();
  return { login: user.login, rows: results.map((r) => ({ ...r, estimated: Boolean(r.estimated) })) };
}

async function publicRoute(url, env) {
  const match = url.pathname.match(/^\/([a-z0-9-]{1,39})(\.svg|\.json)?$/i);
  if (!match) return new Response('not found', { status: 404 });
  const [, login, ext] = match;
  const user = await loadUser(env, login);
  const today = utcToday();
  if (ext === '.svg' || user) track(env, { '.svg': 'card_view', '.json': 'json_view' }[ext] || 'page_view', (user?.login ?? login).toLowerCase());
  if (ext === '.svg') {
    const svg = renderCard(user?.login ?? login, user ? summarize(user.rows, today) : null, today);
    return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }
  if (!user) return new Response('not found', { status: 404 });
  if (ext === '.json') return json(user, 200, { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
  const years = [...new Set(user.rows.map((r) => Number(r.day.slice(0, 4))))].sort((a, b) => b - a);
  const asked = Number(url.searchParams.get('year'));
  const year = years.includes(asked) ? asked : years[0] ?? Number(today.slice(0, 4));
  const html = renderPage(user.login, summarize(user.rows, today), years, year, url.origin);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

async function statsAuthorized(req, env) {
  const given = atob(req.headers.get('authorization')?.match(/^Basic (.+)$/)?.[1] || '').split(':').slice(1).join(':');
  return Boolean(env.STATS_PASSWORD) && (await sha256(given)) === (await sha256(env.STATS_PASSWORD));
}

async function analyticsSql(env, sql) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST', headers: { authorization: `Bearer ${env.CF_API_TOKEN}` }, body: sql,
  }).catch(() => null);
  return res?.ok ? (await res.json()).data : null;
}

async function stats(req, env) {
  if (!(await statsAuthorized(req, env))) {
    return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Basic realm="tokengazer stats"' } });
  }
  const one = (sql) => env.DB.prepare(sql).bind().first();
  const [users, machines, active, signups, events, topCards] = await Promise.all([
    one('SELECT COUNT(*) n FROM users'),
    one('SELECT COUNT(*) n FROM machines'),
    one("SELECT COUNT(DISTINCT github_id) n FROM machines WHERE last_push_at > datetime('now', '-7 days')"),
    env.DB.prepare("SELECT date(created_at) day, COUNT(*) n FROM users WHERE created_at > datetime('now', '-30 days') GROUP BY day ORDER BY day DESC").bind().all(),
    analyticsSql(env, "SELECT blob1 AS event, toDate(timestamp) AS day, SUM(_sample_interval) AS n FROM tokengazer_events WHERE timestamp > NOW() - INTERVAL '30' DAY GROUP BY event, day ORDER BY day DESC"),
    analyticsSql(env, "SELECT blob2 AS login, SUM(_sample_interval) AS n FROM tokengazer_events WHERE blob1 = 'card_view' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY login ORDER BY n DESC LIMIT 20"),
  ]);
  const html = renderStats({ users: users.n, machines: machines.n, active: active.n, signups: signups.results, events, topCards });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

const LANDING = `tokengazer — a GitHub-style contribution graph for the AI tokens you burn.

  npx tokengazer          show your local stats
  npx tokengazer login    publish /<github-username>.svg

Only daily token totals per tool and model are uploaded. Prompts, code and file paths never leave your machine.
`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    if (route === 'POST /api/login') return login(req, env);
    if (route === 'POST /api/push') return push(req, env);
    if (route === 'DELETE /api/me') return deleteMe(req, env);
    if (route === 'GET /favicon.svg') return new Response(logoSvg({ tile: true }), { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
    if (route === 'GET /stats') return stats(req, env);
    if (route === 'GET /') return new Response(LANDING, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (req.method === 'GET') return publicRoute(url, env);
    return new Response('not found', { status: 404 });
  },
};
