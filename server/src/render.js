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
.est{fill-opacity:.55;stroke:#e8692c;stroke-opacity:.7;stroke-dasharray:2 1.5}.mark{fill:#e8692c;letter-spacing:.04em}
</style>`;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
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
    const cls = `d${heatLevel(s.byDay.get(day) || 0, max)}${s.estimatedDays.has(day) ? ' est' : ''}`;
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
  const mark = `<text class="mark" x="${W - 24}" y="32" text-anchor="end">tokengazer</text>`;
  if (!s || !s.tokens) {
    return `${head} height="96" viewBox="0 0 ${W} 96" role="img" aria-label="@${esc(login)} is not tracking yet">${STYLE}<rect width="100%" height="100%" rx="10" fill="#111"/>${mark}<text class="h" x="24" y="32">@${esc(login)}</text><text x="24" y="70">NOT TRACKING YET · RUN npx tokengazer login</text></svg>`;
  }
  const approx = s.estimatedTokens ? '~' : '';
  const headline = s.estimatedTokens
    ? `~${fmt(s.tokens)} TOKENS · ${fmt(s.estimatedTokens)} ESTIMATED`
    : `${fmt(s.tokens)} TOKENS OVER ${s.activeDays} ACTIVE DAYS`;
  const label = `@${login}: ${headline}`;
  return `${head} height="380" viewBox="0 0 ${W} 380" role="img" aria-label="${esc(label)}">${STYLE}
<rect width="100%" height="100%" rx="10" fill="#111"/>${mark}<text class="h" x="24" y="32">@${esc(login)}</text>
${stat(0, 'Tokens', approx + fmt(s.tokens))}${stat(1, 'Cost', `${approx}$${fmt(s.cost)}`)}${stat(2, 'Active days', String(s.activeDays))}${stat(3, 'Streak', `${s.streak}d`)}
<text class="h" x="24" y="170">${esc(headline)}</text>
<text x="24" y="192">${fmt(s.byTool.claude || 0)} Claude · ${fmt(s.byTool.codex || 0)} Codex</text>
<text x="24" y="${236 + STEP + 10}">MON</text><text x="24" y="${236 + 3 * STEP + 10}">WED</text><text x="24" y="${236 + 5 * STEP + 10}">FRI</text>
${grid(s, today)}
<text x="24" y="362">${s.estimatedTokens ? 'DASHED DAYS ARE ESTIMATED FROM PROMPT HISTORY' : 'SHADE IS RELATIVE TO THE BUSIEST DAY'}</text>
<text x="${W - 132}" y="362" text-anchor="end">LESS</text>${[0, 1, 2, 3, 4].map((l) => `<rect class="d${l}" x="${W - 124 + l * 15}" y="352" width="${CELL}" height="${CELL}" rx="2"/>`).join('')}<text x="${W - 24}" y="362" text-anchor="end">MORE</text>
</svg>`;
}

export function renderPage(login, s, years, year, host) {
  const today = iso(Date.now());
  const yearEnd = `${year}-12-31`;
  const card = renderCard(login, s, yearEnd < today ? yearEnd : today);
  const embed = `[![tokens](${host}/${login}.svg)](${host}/${login})`;
  const rows = s.byModel.map((m) => `<tr><td>${esc(m.tool)}</td><td>${esc(m.model)}</td><td>${fmt(m.tokens)}</td><td>$${fmt(m.cost)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>@${esc(login)} · tokengazer</title>
<style>body{margin:0;background:#0a0a0a;color:#ddd;font:15px/1.5 ${FONT}}main{max-width:900px;margin:40px auto;padding:0 16px}
svg{max-width:100%;height:auto}a{color:#e8692c}nav a{margin-right:12px}nav a[aria-current]{color:#fff}
table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #222}
code{display:block;background:#151515;padding:12px;overflow-x:auto;border-radius:6px}small{color:#888}</style></head>
<body><main><nav>${years.map((y) => `<a href="?year=${y}"${y === year ? ' aria-current="page"' : ''}>${y}</a>`).join('')}</nav>
${card}
<h2>Models</h2><table><thead><tr><th>Tool</th><th>Model</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Embed</h2><code>${esc(embed)}</code>
<p><small>tokengazer only receives daily token totals per tool and model. Prompts, code and file paths never leave your machine.
Days before local logs were kept are estimated from prompt history and shown dashed. Get yours: <code>npx tokengazer login</code></small></p>
</main></body></html>`;
}
