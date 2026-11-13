import { fmt } from './stats.js';

const W = 900;
const CELL = 12;
const STEP = 15;
const GRID_X = 64;
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const STYLE = `<style>
text{font-family:${FONT};fill:#8b8b8b;font-size:11px;letter-spacing:.12em}
.h{fill:#ededed;font-size:14px}.v{fill:#f5f5f5;font-size:24px;letter-spacing:0}.l{font-size:11px;letter-spacing:.04em}
.box{fill:none;stroke:#2a2a2a}.d0{fill:#1f1a17}.d1{fill:#4a2a19}.d2{fill:#7a3a1d}.d3{fill:#b04f22}.d4{fill:#e8692c}
.mark{fill:#e8692c;letter-spacing:.04em}
</style>`;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const RAMP = { '2,0': '#7a3a1d', '1,1': '#b04f22', '2,2': '#e8692c' };

function logoCells(light = false) {
  let out = '';
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) {
    out += `<rect x="${4 + x * 32}" y="${4 + y * 32}" width="28" height="28" rx="6" fill="${RAMP[`${x},${y}`] || (light ? '#e8e2dd' : '#2a211c')}"/>`;
  }
  return out;
}

export function logoSvg({ light = false, tile = false } = {}) {
  const bg = tile ? '<rect x="-8" y="-8" width="116" height="116" rx="26" fill="#111"/>' : '';
  const box = tile ? '-8 -8 116 116' : '0 0 100 100';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="${box}">${bg}${logoCells(light)}</svg>`;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]);

export function heatLevel(v, max) {
  return v ? Math.min(4, Math.ceil((4 * v) / max)) : 0;
}

const iso = (t) => new Date(t).toISOString().slice(0, 10);

function grid(s, today) {
  const end = Date.parse(`${today}T00:00:00Z`);
  const start = end - (new Date(end).getUTCDay() + 52 * 7) * 864e5;
  let max = 0;
  for (let t = start; t <= end; t += 864e5) max = Math.max(max, s.byDay.get(iso(t)) || 0);
  const cells = [];
  const months = [];
  let lastMonth = -1;
  for (let t = start, i = 0; t <= end; t += 864e5, i++) {
    const day = iso(t);
    const col = Math.floor(i / 7);
    const row = i % 7;
    const x = GRID_X + col * STEP;
    const m = new Date(t).getUTCMonth();
    if (row === 0 && m !== lastMonth) {
      if (col < 51) months.push(`<text x="${x}" y="226">${MONTHS[m]}</text>`);
      lastMonth = m;
    }
    const cls = `d${heatLevel(s.byDay.get(day) || 0, max)}`;
    cells.push(`<rect class="${cls}" x="${x}" y="${236 + row * STEP}" width="${CELL}" height="${CELL}" rx="2"><title>${day}: ${fmt(s.byDay.get(day) || 0)}</title></rect>`);
  }
  return months.join('') + cells.join('');
}

function stat(i, label, value) {
  const x = 24 + i * 216;
  return `<rect class="box" x="${x}" y="52" width="204" height="78" rx="6"/><text class="l" x="${x + 16}" y="76">${label}</text><text class="v" x="${x + 16}" y="112">${esc(value)}</text>`;
}

export function renderCard(login, s, today) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}"`;
  const mark = `<g class="logo" transform="translate(${W - 124},16) scale(.2)">${logoCells()}</g><text class="mark" x="${W - 24}" y="32" text-anchor="end">tokengazer</text>`;
  if (!s || !s.tokens) {
    return `${head} height="96" viewBox="0 0 ${W} 96" role="img" aria-label="@${esc(login)} is not tracking yet">${STYLE}<rect width="100%" height="100%" rx="10" fill="#111"/>${mark}<text class="h" x="24" y="32">@${esc(login)}</text><text x="24" y="70">NOT TRACKING YET · RUN npx tokengazer login</text></svg>`;
  }
  const headline = `${fmt(s.tokens)} TOKENS OVER ${s.activeDays} ACTIVE DAYS`;
  const label = `@${login}: ${headline}`;
  return `${head} height="380" viewBox="0 0 ${W} 380" role="img" aria-label="${esc(label)}">${STYLE}
<rect width="100%" height="100%" rx="10" fill="#111"/>${mark}<text class="h" x="24" y="32">@${esc(login)}</text>
${stat(0, 'Tokens', fmt(s.tokens))}${stat(1, 'Cost', `$${fmt(s.cost)}`)}${stat(2, 'Active days', String(s.activeDays))}${stat(3, 'Streak', `${s.streak}d`)}
<text class="h" x="24" y="170">${esc(headline)}</text>
<text x="24" y="192">${fmt(s.byTool.claude || 0)} Claude · ${fmt(s.byTool.codex || 0)} Codex</text>
<text x="24" y="${236 + STEP + 10}">MON</text><text x="24" y="${236 + 3 * STEP + 10}">WED</text><text x="24" y="${236 + 5 * STEP + 10}">FRI</text>
${grid(s, today)}
<text x="24" y="362">SHADE IS RELATIVE TO THE BUSIEST DAY</text>
<text x="${W - 146}" y="362" text-anchor="end">LESS</text>${[0, 1, 2, 3, 4].map((l) => `<rect class="d${l}" x="${W - 138 + l * 15}" y="352" width="${CELL}" height="${CELL}" rx="2"/>`).join('')}<text x="${W - 24}" y="362" text-anchor="end">MORE</text>
</svg>`;
}

export function renderPage(login, s, years, year, host) {
  const today = iso(Date.now());
  const yearEnd = `${year}-12-31`;
  const card = renderCard(login, s, yearEnd < today ? yearEnd : today);
  const embed = `[![tokens](${host}/${login}.svg)](${host}/${login})`;
  const rows = s.byModel.map((m) => `<tr><td>${esc(m.tool)}</td><td>${esc(m.model)}</td><td>${fmt(m.tokens)}</td><td>$${fmt(m.cost)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>@${esc(login)} · tokengazer</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>body{margin:0;background:#0a0a0a;color:#ddd;font:15px/1.5 ${FONT}}main{max-width:900px;margin:40px auto;padding:0 16px}
svg{max-width:100%;height:auto}a{color:#e8692c}nav a{margin-right:12px}nav a[aria-current]{color:#fff}
table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #222}
code{display:block;background:#151515;padding:12px;overflow-x:auto;border-radius:6px}small{color:#888}</style></head>
<body><main><nav>${years.map((y) => `<a href="?year=${y}"${y === year ? ' aria-current="page"' : ''}>${y}</a>`).join('')}</nav>
${card}
<h2>Models</h2><table><thead><tr><th>Tool</th><th>Model</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Embed</h2><code>${esc(embed)}</code>
<p><small>tokengazer only receives daily token totals per tool and model. Prompts, code and file paths never leave your machine.
Days before local logs were kept are estimated from prompt history. Get yours: <code>npx tokengazer login</code></small></p>
</main></body></html>`;
}

const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;

export function renderStats({ users, machines, active, signups, events, topCards }) {
  const missing = '<p><small>Analytics Engine unavailable (needs CF_ACCOUNT_ID and CF_API_TOKEN).</small></p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>tokengazer stats</title><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>body{margin:0;background:#0a0a0a;color:#ddd;font:14px/1.5 ${FONT}}main{max-width:900px;margin:40px auto;padding:0 16px}
table{border-collapse:collapse;margin:8px 0 24px}td,th{text-align:left;padding:4px 12px 4px 0;border-bottom:1px solid #222}th{color:#888;font-weight:normal}small{color:#888}</style></head>
<body><main><h1>tokengazer stats</h1>
<table><tr><th>Users</th><td>${users}</td></tr><tr><th>Machines</th><td>${machines}</td></tr><tr><th>Active uploaders (7d)</th><td>${active}</td></tr></table>
<h2>Signups (30d)</h2>${table(['Day', 'Signups'], signups.map((r) => [r.day, r.n]))}
<h2>Events (30d)</h2>${events ? table(['Day', 'Event', 'Count'], events.map((r) => [r.day, r.event, r.n])) : missing}
<h2>Most viewed cards (7d)</h2>${topCards ? table(['Login', 'Views'], topCards.map((r) => [r.login, r.n])) : missing}
<p><small>Card views are approximate: GitHub's image proxy caches cards for up to an hour.</small></p>
</main></body></html>`;
}

const REPO = 'https://github.com/kunatastic/tokengazer';
const EXAMPLE = 'kunatastic';

export function renderLanding(host) {
  const title = 'tokengazer · a contribution graph for your AI tokens';
  const desc = 'A GitHub-style contribution graph for the tokens you burn in Claude Code and Codex. Embed it in your README, resume or portfolio. Only daily totals leave your machine.';
  const cmd = (c, note) => `<div class="cmd"><code>$ ${c}</code><button type="button" data-copy="${c}" aria-label="Copy ${c}">copy</button><span>${note}</span></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="canonical" href="${host}/"><link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<meta property="og:type" content="website"><meta property="og:url" content="${host}/"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}">
<style>
:root{--bg:#0a0a0a;--panel:#111;--line:#222;--fg:#ddd;--dim:#8b8b8b;--hot:#e8692c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 ${FONT}}
main,header,footer{max-width:900px;margin:0 auto;padding:0 16px}a{color:var(--hot)}
header{display:flex;align-items:center;justify-content:space-between;padding-top:24px}header a{text-decoration:none}
.brand{display:flex;align-items:center;gap:10px;color:var(--hot);letter-spacing:.04em}.brand svg{width:24px;height:24px}
h1{font-size:clamp(28px,6vw,44px);line-height:1.15;margin:64px 0 16px;color:#f5f5f5;letter-spacing:-.01em}h1 em{font-style:normal;color:var(--hot)}
h2{font-size:13px;letter-spacing:.12em;color:var(--dim);font-weight:normal;margin:72px 0 16px;text-transform:uppercase}
.lede{color:var(--dim);max-width:620px;margin:0 0 32px}
.cmd{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:8px 0}
.cmd code{color:#f5f5f5;flex:1 1 auto;min-width:0;overflow-x:auto;white-space:nowrap}.cmd span{color:var(--dim);font-size:13px;flex-basis:100%}
button{font:inherit;font-size:12px;background:none;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:2px 10px;cursor:pointer}button:hover{color:var(--fg);border-color:var(--dim)}
.card{display:block;margin:40px 0 0}.card img{width:100%;height:auto;display:block;border-radius:10px}.cap{color:var(--dim);font-size:13px;margin-top:8px}
ol{list-style:none;padding:0;margin:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
ol li{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px}ol b{display:block;color:#f5f5f5;font-weight:normal;margin-bottom:4px}ol b::before{color:var(--hot)}
ol li:nth-child(1) b::before{content:"01  "}ol li:nth-child(2) b::before{content:"02  "}ol li:nth-child(3) b::before{content:"03  "}ol p{margin:0;color:var(--dim);font-size:14px}
.cols{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.cols div{border:1px solid var(--line);border-radius:8px;padding:16px}
.cols h3{margin:0 0 8px;font-size:14px;font-weight:normal;color:#f5f5f5}.cols ul{margin:0;padding-left:18px;color:var(--dim);font-size:14px}
pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow-x:auto;font-size:13px;color:#f5f5f5;margin:8px 0}
form{display:flex;gap:8px;flex-wrap:wrap}input{font:inherit;flex:1 1 220px;background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:10px 12px}
form button{font-size:14px;padding:10px 16px;color:var(--bg);background:var(--hot);border-color:var(--hot)}form button:hover{color:var(--bg);filter:brightness(1.1)}
details{border-bottom:1px solid var(--line);padding:12px 0}summary{cursor:pointer;color:#f5f5f5}details p{color:var(--dim);margin:8px 0 0;font-size:14px}
footer{color:var(--dim);font-size:13px;padding-top:72px;padding-bottom:40px;display:flex;gap:16px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--hot);outline-offset:2px}
</style></head><body>
<header><a class="brand" href="/">${logoSvg().replace('<svg ', '<svg aria-hidden="true" ')}tokengazer</a><a href="${REPO}">GitHub</a></header>
<main>
<h1>Your GitHub graph counts commits.<br><em>This one counts tokens.</em></h1>
<p class="lede">A contribution graph for the AI tokens you burn in Claude Code and Codex. One command to see your numbers, one more to put the card in your README.</p>
${cmd('npx tokengazer', 'See your stats locally. Nothing is uploaded.')}
${cmd('npx tokengazer login', 'Sign in with GitHub, publish your card, refresh hourly.')}
<a class="card" href="/${EXAMPLE}"><img src="/${EXAMPLE}.svg" width="900" height="380" alt="Example tokengazer card for @${EXAMPLE}: tokens, cost, active days, streak and a year-long heat map"></a>
<p class="cap">Live card for @${EXAMPLE}. Shade is relative to the busiest day.</p>

<h2>How it works</h2>
<ol>
<li><b>Run it</b><p>tokengazer reads Claude Code and Codex session logs on your machine and adds up tokens per day and model.</p></li>
<li><b>Sign in</b><p><code>login</code> uses GitHub device flow with no scopes and installs an hourly job to keep your card fresh.</p></li>
<li><b>Embed it</b><p>Paste the snippet anywhere Markdown renders: your profile README, portfolio, resume.</p></li>
</ol>
<pre>[![tokens](${host}/&lt;you&gt;.svg)](${host}/&lt;you&gt;)</pre>

<h2>Privacy</h2>
<div class="cols">
<div><h3>Uploaded</h3><ul><li>Day, tool, model</li><li>Input, output, cache and reasoning token counts</li><li>Whether the day was estimated</li></ul></div>
<div><h3>Never leaves your machine</h3><ul><li>Prompts and responses</li><li>Code, file paths, project names</li><li>Your GitHub token (read once, discarded)</li></ul></div>
</div>

<h2>Look someone up</h2>
<form action="/" onsubmit="event.preventDefault();var u=this.u.value.trim().replace(/^@/,'');if(u)location.href='/'+encodeURIComponent(u)">
<input name="u" placeholder="github-username" aria-label="GitHub username" autocomplete="off" spellcheck="false" required><button>View card</button></form>

<h2>FAQ</h2>
<details><summary>Where do the numbers come from?</summary><p>Claude Code: <code>~/.claude/projects/**/*.jsonl</code>, counting input, output, cache reads and cache writes. Codex: <code>~/.codex/sessions/**/*.jsonl</code>, counting input and output.</p></details>
<details><summary>Why are some days "estimated"?</summary><p>Claude Code deletes session logs after 30 days. For older days tokengazer multiplies your prompt count from <code>~/.claude/history.jsonl</code> by your median tokens per prompt. To keep exact history, add <code>"cleanupPeriodDays": 3650</code> to <code>~/.claude/settings.json</code>.</p></details>
<details><summary>Is the cost what I paid?</summary><p>No. It's the API list-price equivalent of those tokens, not what your subscription costs.</p></details>
<details><summary>How do I delete my data?</summary><p><code>npx tokengazer logout --delete</code> removes the hourly job, your local key and everything stored on the server.</p></details>
<details><summary>Can I build my own view?</summary><p>Yes. <code>/&lt;you&gt;.json</code> returns your daily rows with CORS enabled.</p></details>
</main>
<footer><span>MIT licensed</span><a href="${REPO}">Source</a><a href="/llms.txt">llms.txt</a></footer>
<script>document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.textContent='copied';setTimeout(()=>b.textContent='copy',1500)}))</script>
</body></html>`;
}

export function renderLlms(host) {
  return `# tokengazer

> A GitHub-style contribution graph for the AI tokens a developer uses in Claude Code and OpenAI Codex. A CLI reads local session logs, uploads only daily token totals per tool and model, and the server renders an embeddable SVG card for each GitHub username.

Prompts, code, file paths and project names never leave the user's machine. GitHub sign-in uses device flow with no scopes; the server reads the username once and discards the token.

## Usage

- \`npx tokengazer\`: print local stats. Nothing is uploaded.
- \`npx tokengazer login\`: GitHub device login, installs an hourly upload job (launchd on macOS, crontab on Linux), first push.
- \`npx tokengazer push\`: upload now.
- \`npx tokengazer logout [--delete]\`: remove the hourly job and local key; \`--delete\` also erases the user's data from the server.

Embed snippet (Markdown):

\`\`\`md
[![tokens](${host}/<github-username>.svg)](${host}/<github-username>)
\`\`\`

## Public endpoints

- [${host}/<github-username>.svg](${host}/${EXAMPLE}.svg): embeddable card, cached 1h. Unknown users get a "not tracking yet" card.
- [${host}/<github-username>](${host}/${EXAMPLE}): HTML profile with per-model breakdown; \`?year=YYYY\` selects a year.
- [${host}/<github-username>.json](${host}/${EXAMPLE}.json): \`{ login, rows: [{ day, tool, model, input, output, cache_read, cache_write, reasoning, estimated }] }\`, CORS enabled.

## How tokens are counted

- Claude Code: \`~/.claude/projects/**/*.jsonl\`. Tokens = input + output + cache reads + cache writes.
- Codex: \`~/.codex/sessions/**/*.jsonl\` (and \`.jsonl.zst\` on Node >= 22.15). Tokens = input + output.
- Estimated history: Claude Code deletes session logs after 30 days. Older days are estimated as prompt count (from \`~/.claude/history.jsonl\`) times median tokens per prompt, split by model using \`~/.claude/stats-cache.json\`. Rows carry an \`estimated\` flag. Setting \`"cleanupPeriodDays": 3650\` in \`~/.claude/settings.json\` keeps exact history.
- Cost is the API list-price equivalent, not subscription spend.

## Links

- [Source code and README](${REPO}): MIT licensed.
- [npm package](https://www.npmjs.com/package/tokengazer)
`;
}
