# tokengazer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dependency Node CLI that reads local Claude Code + Codex logs and pushes daily token totals to a Cloudflare Worker, which serves an embeddable SVG heatmap card and a profile page per GitHub user.

**Architecture:** `cli/` parses logs into daily rows `{day, tool, model, input, output, cache_read, cache_write, reasoning}` and pushes them with a per-machine API key obtained via GitHub device-flow login. `server/` is one Worker on D1: it stores rows per machine, sums across machines on read, computes tokens/cost/streak, and renders SVG + HTML from pure functions.

**Tech Stack:** Node ≥ 18 (ESM, `node:test`, global `fetch`), Cloudflare Workers + D1 + `wrangler` (dev dependency only), plain JavaScript everywhere.

**Spec:** `docs/superpowers/specs/2026-11-13-tokengazer-design.md`

## Global Constraints

- CLI has **zero runtime dependencies**; server has none beyond `wrangler` as a devDependency.
- Never send prompts, code, paths, project names or session content — only the row fields above plus `machine_id`.
- GitHub OAuth requests **no scopes** (identity only); the server discards the GitHub token after reading `/user`.
- Tokens: Claude = `input + output + cache_read + cache_write`; Codex = `input + output` (cached ⊂ input, reasoning ⊂ output).
- Day bucket = the user's local date of the entry timestamp, `YYYY-MM-DD`.
- Usage PK `(github_id, machine_id, day, tool, model)`; reads sum across machines.
- Push rejects negative numbers, days in the future (> UTC today + 1) or before `2023-01-01`, and any single field > `10_000_000_000`.
- `GET /<login>.svg` → `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=3600`; unknown user → "not tracking yet" card with status 200.
- Card: last 365 days, 5 shades relative to busiest day, Mon/Wed/Fri labels, month labels, headline `<N> TOKENS OVER <D> ACTIVE DAYS`, split line `<a> Claude · <b> Codex`, stat cards Tokens / Cost / Active days / Streak, dark theme with orange scale, monospace system font stack only, small "tokengazer" mark.
- Mac (`launchd`) and Linux (`crontab`) only. Dark theme only.
- Default host `https://tokengazer.<account>.workers.dev`, overridable with env `TOKENGAZER_HOST`.

## Review Focus

- A half-written JSONL line (log being appended mid-session) must be skipped, not crash the scan — test in Task 1.
- A machine with only Codex (no `~/.claude`) or only Claude must scan fine and push what exists — test in Task 1.
- `/<Login>.svg` with different casing, or a non-user path like `/favicon.ico`, must return a valid card/404 rather than throw — test in Task 4.
- Hourly push with no network or server down must exit non-zero quietly without touching config — test in Task 5.
- Large histories (thousands of rows) must push in chunks of ≤ 500 rows so no single request is huge — test in Task 5.

---

### Task 1: Log parsing and daily aggregation (CLI)

**Files:**
- Create: `cli/package.json`, `cli/src/logs.js`
- Test: `cli/test/logs.test.js`

**Interfaces:**
- Produces:
  - `parseClaudeLines(lines: string[], seen: Set<string>) -> Usage[]`
  - `parseCodexLines(lines: string[]) -> Usage[]`
  - `aggregate(usages: Usage[]) -> Row[]`
  - `scan(home: string) -> Row[]` — walks `<home>/.claude/projects/**/*.jsonl` and `<home>/.codex/sessions/**/*.jsonl`
  - `Usage = { ts: string, tool: 'claude'|'codex', model: string, input, output, cache_read, cache_write, reasoning }` (numbers)
  - `Row = { day: 'YYYY-MM-DD', tool, model, input, output, cache_read, cache_write, reasoning }`

`package.json`: `"name": "tokengazer"`, `"type": "module"`, `"bin": {"tokengazer": "bin/tokengazer.js"}`, `"engines": {"node": ">=18"}`, `"scripts": {"test": "TZ=Asia/Kolkata node --test"}`.

- [ ] **Step 1: Write failing tests** in `cli/test/logs.test.js`:

```js
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

test('aggregate: buckets by local day (TZ=Asia/Kolkata) and sums per tool+model', () => {
  const base = { tool: 'claude', model: 'm', input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0 };
  const rows = aggregate([{ ...base, ts: '2026-11-12T20:00:00Z' }, { ...base, ts: '2026-11-13T01:00:00Z' }]);
  assert.deepEqual(rows, [{ ...base, day: '2026-11-13', input: 2, output: 2 }]);
});

test('scan: works when only one tool is installed', () => {
  const home = mkdtempSync(join(tmpdir(), 'tg-'));
  mkdirSync(join(home, '.codex/sessions/2026/10/30'), { recursive: true });
  writeFileSync(join(home, '.codex/sessions/2026/10/30/rollout.jsonl'), codexLines.join('\n'));
  assert.equal(scan(home).length, 1);
});
```

- [ ] **Step 2: Run** `cd cli && npm test` — Expected: FAIL, `logs.js` exports missing.
- [ ] **Step 3: Implement `cli/src/logs.js`.** Wrap each `JSON.parse` in try/catch and skip. Codex: carry the latest `payload.model` seen in the file (default `'unknown'`). `aggregate` key = `day|tool|model`; local day from `Date#getFullYear/getMonth/getDate`. `scan` uses `readdirSync(dir, { recursive: true })` filtered to `.jsonl`; a missing root yields `[]`. One `seen` set per `scan` call.
- [ ] **Step 4: Run** `cd cli && npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `git add cli && git commit -m "cli: parse Claude and Codex logs into daily rows"`

---

### Task 2: Stats and pricing (server, pure)

**Files:**
- Create: `server/package.json`, `server/src/stats.js`
- Test: `server/test/stats.test.js`

**Interfaces:**
- Consumes: `Row` shape from Task 1 (from D1, summed across machines).
- Produces:
  - `tokensOf(row: Row) -> number` — the Global Constraints rule per tool
  - `costOf(row: Row, prices = PRICES) -> number` (USD)
  - `PRICES: { [modelPrefix: string]: { input, output, cache_read, cache_write } }` — USD per 1M tokens; longest matching prefix wins; no match → cost 0
  - `summarize(rows: Row[], today: string) -> Summary`
  - `Summary = { tokens, cost, activeDays, streak, byTool: { claude, codex }, byDay: Map<string, number>, byModel: [{ tool, model, tokens, cost }] }`
  - `fmt(n: number) -> string` — `3_000_000_000 → '3.0B'`, `950_000_000 → '950M'`, `12_300 → '12.3K'`, `999 → '999'`

`server/package.json`: `"type": "module"`, `"scripts": {"test": "node --test", "dev": "wrangler dev", "deploy": "wrangler deploy"}`, devDependency `wrangler`.

- [ ] **Step 1: Write failing tests** in `server/test/stats.test.js`:

```js
const P = { 'claude-opus': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 }, 'gpt-6': { input: 2, output: 10, cache_read: 0.2, cache_write: 0 } };
const row = (o) => ({ day: '2026-11-12', tool: 'claude', model: 'claude-opus-5-5', input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, ...o });

test('tokensOf: claude counts cache, codex does not double count', () => {
  assert.equal(tokensOf(row({ input: 1, output: 2, cache_read: 3, cache_write: 4 })), 10);
  assert.equal(tokensOf(row({ tool: 'codex', input: 100, cache_read: 40, output: 10, reasoning: 5 })), 110);
});
test('costOf: codex bills uncached input at input rate, cached at cache_read rate', () => {
  const c = costOf(row({ tool: 'codex', model: 'gpt-6-astra', input: 1e6, cache_read: 4e5, output: 1e6 }), P);
  assert.ok(Math.abs(c - 11.28) < 1e-9);
});
test('costOf: unknown model costs 0', () => assert.equal(costOf(row({ model: 'mystery', input: 1e6 }), P), 0));
test('summarize: streak counts back from today, or from yesterday if today is empty', () => {
  const rows = ['2026-11-10', '2026-11-11', '2026-11-12'].map((day) => row({ day, input: 1 }));
  assert.equal(summarize(rows, '2026-11-13').streak, 3);
  assert.equal(summarize(rows, '2026-11-14').streak, 0);
});
test('summarize: totals and split', () => {
  const s = summarize([row({ input: 5 }), row({ tool: 'codex', model: 'gpt-6', input: 3 })], '2026-11-12');
  assert.deepEqual([s.tokens, s.activeDays, s.byTool.claude, s.byTool.codex], [8, 1, 5, 3]);
});
test('fmt', () => assert.deepEqual([3e9, 9.5e8, 12300, 999].map(fmt), ['3.0B', '950M', '12.3K', '999']));
```

- [ ] **Step 2: Run** `cd server && npm test` — Expected: FAIL.
- [ ] **Step 3: Implement `server/src/stats.js`.** Fill `PRICES` from the official Anthropic and OpenAI pricing pages at build time (rates per 1M tokens) for the models in your own logs (`claude-opus-5-*`, `claude-sonnet-5-*`, `claude-haiku-5-*`, `claude-fable-5-*`, `gpt-6*`). Codex cost = `(input - cache_read) * in + cache_read * cr + output * out`. `fmt` uses one decimal below 100 of a unit (`3.0B`, `12.3K`), none at ≥ 100 (`950M`).
- [ ] **Step 4: Run** `cd server && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "server: token, cost and streak stats"`

---

### Task 3: SVG card and profile page (server, pure)

**Files:**
- Create: `server/src/render.js`
- Test: `server/test/render.test.js`

**Interfaces:**
- Consumes: `summarize`, `fmt` from Task 2.
- Produces:
  - `renderCard(login: string, s: Summary | null, today: string) -> string` (SVG; `null` → "not tracking yet" card)
  - `renderPage(login: string, s: Summary, years: number[], year: number, host: string) -> string` (HTML)
  - `heatLevel(v: number, max: number) -> 0|1|2|3|4` — `0` if `v === 0`, else `Math.ceil(4 * v / max)`

- [ ] **Step 1: Write failing tests:**

```js
test('heatLevel', () => assert.deepEqual([0, 1, 50, 100].map((v) => heatLevel(v, 100)), [0, 1, 2, 4]));
test('card: headline, split, stat labels, 365+ cells, escapes login', () => {
  const s = summarize([{ day: '2026-11-12', tool: 'claude', model: 'x', input: 3e9, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }], '2026-11-12');
  const svg = renderCard('a<b', s, '2026-11-12');
  assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /3\.0B TOKENS OVER 1 ACTIVE DAYS/);
  assert.match(svg, /3\.0B Claude · 0 Codex/);
  for (const l of ['Tokens', 'Cost', 'Active days', 'Streak']) assert.ok(svg.includes(l));
  assert.ok((svg.match(/<rect class="d/g) || []).length >= 365);
  assert.ok(!svg.includes('a<b') && svg.includes('a&lt;b'));
  assert.ok(!/@import|url\(http/.test(svg));
});
test('card: null summary renders not-tracking card', () => assert.match(renderCard('x', null, '2026-11-12'), /not tracking yet/i));
test('page: contains card, year links, model breakdown and privacy note', () => {
  const s = summarize([], '2026-11-12');
  const html = renderPage('kunatastic', s, [2026, 2025], 2026, 'https://h');
  assert.match(html, /href="\?year=2025"/);
  assert.match(html, /never/i);
});
```

- [ ] **Step 2: Run** `cd server && npm test` — Expected: FAIL.
- [ ] **Step 3: Implement `server/src/render.js`.** Grid = 53 week-columns × 7 rows (Sun…Sat), ending at the week containing `today`; each cell `<rect class="d<level>">`; colors in one `<style>` block: background `#111`, level 0 `#1f1a17`, levels 1–4 an orange ramp ending `#e8692c`. Font stack `ui-monospace, SFMono-Regular, Menlo, monospace`. Page reuses the card markup for the selected year's 365 days (`renderCard` with `today` = Dec 31 of that year, or real today for the current year), then a table of `byModel`, and the privacy note: "tokengazer only receives daily token totals per tool and model. Prompts, code and file paths never leave your machine."
- [ ] **Step 4: Run** `cd server && npm test` — Expected: PASS. Also write the card to a file and open it in a browser to eyeball it against the reference screenshot.
- [ ] **Step 5: Commit** `git add server && git commit -m "server: render SVG card and profile page"`

---

### Task 4: Worker routes and D1 storage

**Files:**
- Create: `server/wrangler.toml`, `server/schema.sql`, `server/src/index.js`
- Test: `server/test/validate.test.js`

**Interfaces:**
- Consumes: `summarize`, `renderCard`, `renderPage`.
- Produces (HTTP contract the CLI uses):
  - `POST /api/login` body `{ github_token, machine_id }` → `200 { api_key, login }`; `401` if GitHub `/user` fails
  - `POST /api/push` `Authorization: Bearer <api_key>` body `{ rows: Row[] }` (≤ 500) → `200 { stored: n }`; `400 { error }`; `401`
  - `DELETE /api/me` Bearer → deletes the user, all machines and usage → `200`
  - `GET /<login>.svg`, `GET /<login>[?year=YYYY]`, `GET /` → short landing text with install command
  - `validateRows(rows: unknown, todayUtc: string) -> { ok: true, rows } | { ok: false, error: string }` exported for tests

`schema.sql`: tables exactly as in the spec; `users.login` stored lowercase with a unique index; `machines.api_key_hash` = hex SHA-256 of the key (`crypto.subtle`); API key = 32 random bytes hex.

- [ ] **Step 1: Write failing tests** for `validateRows`:

```js
const ok = { day: '2026-11-12', tool: 'claude', model: 'm', input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0 };
test('accepts valid rows', () => assert.equal(validateRows([ok], '2026-11-12').ok, true));
for (const [name, bad] of [
  ['negative', { ...ok, input: -1 }], ['future', { ...ok, day: '2026-11-14' }], ['too old', { ...ok, day: '2022-12-31' }],
  ['over ceiling', { ...ok, output: 1e10 + 1 }], ['bad tool', { ...ok, tool: 'cursor' }], ['bad day', { ...ok, day: '12/11/2026' }],
]) test(`rejects ${name}`, () => assert.equal(validateRows([bad], '2026-11-12').ok, false));
test('rejects more than 500 rows', () => assert.equal(validateRows(Array(501).fill(ok), '2026-11-12').ok, false));
```

Plus a route test with an in-memory stub: `handler.fetch(new Request('https://h/Kunatastic.svg'), env)` where `env.DB` is a minimal stub returning one user `kunatastic` → 200 SVG; `/favicon.ico` → 404; `/nobody.svg` → 200 not-tracking card.

- [ ] **Step 2: Run** `cd server && npm test` — Expected: FAIL.
- [ ] **Step 3: Implement `server/src/index.js`.** Login: `GET https://api.github.com/user` with the token (`User-Agent: tokengazer`), upsert `users` by `id` (refresh `login`), upsert `machines` by `machine_id` with a fresh key, return the key once. Push: look up machine by key hash, validate, then a single `env.DB.batch` of `INSERT ... ON CONFLICT DO UPDATE` per row. Reads: `SELECT day, tool, model, SUM(...) ... GROUP BY day, tool, model` for the user; lookup login with `lower()`. SVG headers per Global Constraints; page `Cache-Control: public, max-age=300`.
- [ ] **Step 4: Run** `cd server && npm test` — Expected: PASS. Then `npx wrangler d1 execute tokengazer --local --file schema.sql && npm run dev`, and `curl -s localhost:8787/nobody.svg | head -c 200` shows an `<svg`.
- [ ] **Step 5: Commit** `git add server && git commit -m "server: D1 storage, push/login API and public routes"`

---

### Task 5: CLI commands — stats, login, push, logout, schedule

**Files:**
- Create: `cli/bin/tokengazer.js`, `cli/src/cli.js`
- Test: `cli/test/cli.test.js`

**Interfaces:**
- Consumes: `scan` (Task 1); HTTP contract (Task 4).
- Produces:
  - `chunk(rows: Row[], size = 500) -> Row[][]`
  - `push({ home, host, fetchImpl = fetch }) -> Promise<number>` (rows stored; throws on any non-200, leaves config untouched)
  - `scheduleCommand(platform: string, shell: string) -> { file?: string, content: string }` — launchd plist or crontab line
  - Config at `~/.tokengazer/config.json` `{ api_key, login, machine_id, host }`, written with mode `0o600`

Commands in `bin/tokengazer.js`: no args → print local summary (total tokens, Claude/Codex split, active days, last 7 days) and, if no config, `Run: npx tokengazer login`; `login`; `push`; `logout [--delete]`.

- [ ] **Step 1: Write failing tests:**

```js
test('chunk splits into ≤500', () => assert.deepEqual(chunk(Array(1201).fill(0)).map((c) => c.length), [500, 500, 201]));
test('push sends chunks with bearer key', async () => {
  const home = fakeHomeWithConfigAndCodexLog(); const calls = [];
  const n = await push({ home, host: 'https://h', fetchImpl: async (u, o) => (calls.push([u, o]), new Response('{"stored":1}')) });
  assert.equal(calls[0][0], 'https://h/api/push');
  assert.equal(calls[0][1].headers.authorization, 'Bearer k');
  assert.equal(n, 1);
});
test('push rejects on network error and leaves config unchanged', async () => {
  const home = fakeHomeWithConfigAndCodexLog(); const before = readFileSync(join(home, '.tokengazer/config.json'), 'utf8');
  await assert.rejects(push({ home, host: 'https://h', fetchImpl: async () => { throw new TypeError('fetch failed'); } }));
  assert.equal(readFileSync(join(home, '.tokengazer/config.json'), 'utf8'), before);
});
test('schedule: launchd hourly via login shell', () => {
  const s = scheduleCommand('darwin', '/bin/zsh');
  assert.match(s.file, /Library\/LaunchAgents\/dev\.tokengazer\.push\.plist$/);
  assert.match(s.content, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.ok(s.content.includes('npx -y tokengazer@latest push'));
});
test('schedule: linux crontab line', () =>
  assert.equal(scheduleCommand('linux', '/bin/bash').content, "0 * * * * /bin/bash -lc 'npx -y tokengazer@latest push' >/dev/null 2>&1"));
```

- [ ] **Step 2: Run** `cd cli && npm test` — Expected: FAIL.
- [ ] **Step 3: Implement `cli/src/cli.js` and `cli/bin/tokengazer.js`.** Login uses GitHub device flow directly from the CLI: `POST https://github.com/login/device/code` (`client_id`, no scope) → print `user_code` + open `verification_uri` (`open` on macOS, `xdg-open` on Linux, ignore failure) → poll `https://github.com/login/oauth/access_token` at the given `interval`, handling `authorization_pending` and `slow_down` → `POST /api/login` → write config → install schedule (`launchctl load -w` / append to `crontab -l` if absent) → run one `push` → print `[![tokens](<host>/<login>.svg)](<host>/<login>)`. `GITHUB_CLIENT_ID` is a constant in `cli.js` (public by design). `push` exits with code 1 and a one-line stderr message on failure. `logout` removes the schedule and config; `--delete` calls `DELETE /api/me` first.
- [ ] **Step 4: Run** `cd cli && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git add cli && git commit -m "cli: login, push, logout and hourly schedule"`

---

### Task 6: Deploy and end-to-end check

**Files:**
- Create: `README.md` (install command, embed snippet, privacy note from Task 3, `logout --delete`)
- Modify: `cli/src/cli.js` (real `GITHUB_CLIENT_ID`, default host)

- [ ] **Step 1: Owner creates a GitHub OAuth App** (Settings → Developer settings → OAuth Apps), name `tokengazer`, homepage = the workers.dev URL, **Enable Device Flow** checked. Put its client ID in `cli/src/cli.js`. No client secret is needed.
- [ ] **Step 2: Deploy:** `cd server && npx wrangler d1 create tokengazer` → put the id in `wrangler.toml` → `npx wrangler d1 execute tokengazer --remote --file schema.sql` → `npm run deploy`. Expected: a `https://tokengazer.<account>.workers.dev` URL; set it as the CLI default host.
- [ ] **Step 3: End to end from a local checkout:** `node cli/bin/tokengazer.js login` → approve in browser → Expected: embed snippet printed; `curl -sI <host>/<login>.svg` shows `200` and `image/svg+xml`; totals on the card match `node cli/bin/tokengazer.js` output.
- [ ] **Step 4: Embed check:** paste the snippet into a GitHub gist's README.md preview. Expected: the card renders through GitHub's image proxy.
- [ ] **Step 5: Schedule check:** `launchctl list | grep tokengazer` shows the job. (Publishing to npm happens after this passes: `cd cli && npm publish`.)
- [ ] **Step 6: Commit** `git add README.md cli && git commit -m "Deploy config and README"`
