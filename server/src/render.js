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

const REPO = 'https://github.com/kunatastic/tokengazer';
const EXAMPLE = 'kunatastic';

const SITE_STYLE = `<style>
@font-face{font-family:Geist;src:url('/fonts/geist-latin-wght-normal.woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
@font-face{font-family:"Geist Mono";src:url('/fonts/geist-mono-latin-wght-normal.woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
:root{color-scheme:dark;--bg:#0c0c0e;--panel:#131315;--line:#28282c;--fg:#f1f0ef;--dim:#a2a1aa;--hot:#f08450;--sans:Geist,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:"Geist Mono",${FONT}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:var(--bg);color:var(--fg);font:400 15px/1.65 var(--sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-optical-sizing:auto}a{color:inherit;text-decoration:none}button,input,textarea{font:inherit}button,a,input,textarea,summary{-webkit-tap-highlight-color:transparent}button{cursor:pointer}button:disabled{cursor:wait}::selection{background:#833e27;color:#fff}:focus-visible{outline:2px solid var(--hot);outline-offset:5px}.skip{position:absolute;top:-80px;left:16px;z-index:5;background:var(--hot);color:#111;padding:8px 16px}.skip:focus{top:12px}
.wrap{max-width:1120px;margin:auto;padding:0 28px}.site-header{height:88px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:24px}.brand{display:flex;align-items:center;gap:10px;font:600 19px var(--sans);letter-spacing:-.65px}.brand svg{width:27px;height:27px}.nav{display:flex;align-items:center;gap:28px;font-size:13px;color:var(--dim)}.nav a:hover,footer a:hover{color:var(--fg)}.nav .button{padding:8px 13px;color:var(--fg)}.button{display:inline-flex;justify-content:center;align-items:center;gap:10px;min-height:40px;padding:11px 19px;border:1px solid #353539;border-radius:8px;background:#1b1b1e;color:var(--fg);font-size:13px;font-weight:500;line-height:1.5;box-shadow:inset 0 1px 0 #ffffff06;transition:background .15s,border-color .15s,box-shadow .15s}.button:hover{background:#262629;border-color:#55545c}.button.primary{background:var(--hot);border-color:var(--hot);color:#20120c;box-shadow:inset 0 1px 0 #ffffff25,0 2px 8px #0003}.button.primary:hover{background:#ffa372;border-color:#ffa372}.arrow{font-size:17px;line-height:1}.muted{color:var(--dim)}.mono,code,pre,textarea{font-family:var(--mono)}code{font-size:.88em}h1,h2,h3,p{margin-top:0}h2{font-size:30px;line-height:1.25;letter-spacing:-1px;font-weight:520}h3{font-size:16px;letter-spacing:-.35px;font-weight:500}.eyebrow{display:inline-flex;align-items:center;gap:8px;font:400 10px var(--mono);letter-spacing:.09em;color:var(--dim)}.dot{width:6px;height:6px;border-radius:50%;background:var(--hot);box-shadow:0 0 10px #f0845040;display:inline-block}.hero{padding:68px 0 44px;text-align:center;background:radial-gradient(ellipse at 50% 0,#f0845009,transparent 65%)}.hero .eyebrow{padding:6px 11px;border:1px solid #3e2d25;border-radius:24px;background:#211710;color:#eab598}.old-quote{margin:0 0 25px;color:#a39aa0;font:400 15px/1.7 var(--mono);letter-spacing:-.4px}.old-quote s{text-decoration-color:#76646a;text-decoration-thickness:1px}.old-quote>span{display:block;margin-top:5px;font:400 10px/1.6 var(--mono);letter-spacing:.02em;color:#817b84}.hero h1{font-size:clamp(40px,6vw,66px);font-weight:550;letter-spacing:-2.9px;line-height:1.1;margin:25px auto 20px}.hero h1 em{font-style:normal;color:var(--hot)}.hero .lede{max-width:510px;margin:0 auto 26px;color:var(--dim);font-size:16px;line-height:1.75;letter-spacing:-.2px}.actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}.quick-command{display:inline-flex;align-items:center;gap:22px;border:1px solid #2b292d;border-radius:8px;padding:9px 10px 9px 16px;background:linear-gradient(180deg,#151416,#101012);box-shadow:inset 0 1px 0 #ffffff04;margin-top:20px;font-size:12px;color:#d0cdd2}.quick-command code{font-size:12px;font-weight:450;letter-spacing:-.25px}.quick-command .dollar{font:12px var(--mono);color:#77717a}.copy{border:0;background:transparent;color:var(--dim);padding:6px 8px;font:11px var(--mono);border-radius:4px;min-height:32px}.copy:hover{background:#ffffff0a;color:var(--fg)}.support{display:flex;justify-content:center;gap:21px;flex-wrap:wrap;margin-top:22px;font:11px var(--mono);color:var(--dim)}.support span{display:flex;gap:7px;align-items:center}.support .claude{color:#d99a7a}.support .codex{color:#d7d7dd}
.preview{border:1px solid #343035;border-radius:12px;background:var(--panel);box-shadow:0 15px 80px #0003;overflow:hidden;position:relative}.window-bar{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 19px;border-bottom:1px solid var(--line);font:11px var(--mono);color:var(--dim)}.window-label{display:flex;align-items:center;gap:12px}.window-dots{display:flex;gap:5px}.window-dots i{width:7px;height:7px;background:#3c393d;border-radius:50%}.window-dots i:first-child{background:#805343}.window-dots i:nth-child(2){background:#7c6843}.window-dots i:nth-child(3){background:#4e6b54}.live{display:flex;align-items:center;gap:6px;font-size:10px}.live .dot{background:#91b89b;box-shadow:none;width:5px;height:5px}.preview-body{padding:18px 21px}.preview img{display:block;width:100%;height:auto;border-radius:7px}.preview-link{display:block}.preview-caption{display:flex;justify-content:space-between;gap:16px;padding:0 23px 18px;color:var(--dim);font:11px/1.7 var(--mono)}.preview-caption a{color:#d9d6d4}.preview-caption a:hover{color:var(--hot)}
.section{padding:76px 0 0;scroll-margin-top:24px}.section-intro{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:25px}.section-intro h2{margin:9px 0 0}.section-intro>p{font-size:13px;max-width:300px;margin:0;color:var(--dim)}.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;list-style:none;margin:0;padding:0}.step{display:flex;flex-direction:column;padding:24px;border:1px solid var(--line);border-radius:10px;background:linear-gradient(130deg,#171719,#111113)}.step-num{font:11px var(--mono);display:flex;align-items:center;gap:10px;color:#d3a48c;margin-bottom:28px}.step-num:after{content:"";height:1px;flex:1;background:var(--line)}.step h3{margin-bottom:8px}.step p{flex:1;font-size:13px;color:var(--dim);margin-bottom:19px}.step code{font-size:12px;font-weight:450;letter-spacing:-.3px;color:#d2cfd5}.step .mini-code{padding:12px 13px;background:linear-gradient(180deg,#0f0e10,#0c0c0e);border:1px solid #2c292e;border-radius:7px;box-shadow:inset 0 1px 0 #ffffff03;display:block;overflow-x:auto;white-space:nowrap;line-height:1.6}.command-prefix{color:#77717a;margin-right:8px;user-select:none}.agent-callout{margin-top:22px;display:flex;align-items:center;gap:18px;padding:23px 25px;border:1px solid #443026;border-radius:10px;background:linear-gradient(115deg,#231811,#151315)}.agent-symbol{width:40px;height:40px;display:grid;place-items:center;flex-shrink:0;border:1px solid #61412f;border-radius:10px;color:var(--hot);font:20px var(--mono);background:#342116}.agent-callout h3{margin:0 0 3px}.agent-callout p{margin:0;color:var(--dim);font-size:13px}.agent-callout .button{margin-left:auto;white-space:nowrap}.privacy-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:10px;overflow:hidden}.privacy-box{padding:27px;background:#111113}.privacy-box+.privacy-box{border-left:1px solid var(--line)}.privacy-box h3{display:flex;align-items:center;gap:9px}.privacy-box h3 span{font:15px var(--mono);color:#91b89b}.privacy-box ul{list-style:none;padding:0;margin:0;color:var(--dim);font-size:13px}.privacy-box li{padding:4px 0}.privacy-box li:before{content:"—";margin-right:9px;color:#605d65}.privacy-note{color:var(--dim);font:11px/1.8 var(--mono);margin:13px 0 0}.bottom-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:65px}.faq h2,.lookup h2{font-size:23px;margin-bottom:24px}.faq details{border-bottom:1px solid var(--line);padding:15px 0}.faq summary{cursor:pointer;font-size:13px;list-style:none;display:flex;justify-content:space-between;gap:18px}.faq summary::-webkit-details-marker{display:none}.faq summary:after{content:"+";color:var(--dim);font:16px var(--mono)}.faq details[open] summary:after{content:"−"}.faq details p{color:var(--dim);font-size:13px;margin:12px 20px 0 0}.faq code{overflow-wrap:anywhere}.lookup{padding:25px;border:1px solid var(--line);border-radius:10px;background:#111113;align-self:start}.lookup h2{margin-bottom:9px}.lookup p{font-size:13px;color:var(--dim);margin-bottom:20px}.lookup label{font:10px var(--mono);color:var(--dim);display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em}.lookup form label{flex-basis:100%}.lookup form{display:flex;gap:7px;flex-wrap:wrap}.lookup input{flex:1;min-width:0;width:100%;background:#0c0c0e;border:1px solid #353539;border-radius:6px;color:var(--fg);padding:9px 10px;font:12px var(--mono)}.lookup form .button{padding:9px 12px}.lookup>a{display:block;font-size:12px;color:var(--hot);margin-top:15px}footer{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;border-top:1px solid var(--line);padding:26px 0 30px;margin-top:76px;font:11px var(--mono);color:var(--dim)}footer .brand{font-size:13px;letter-spacing:-.3px}footer .brand svg{width:20px;height:20px}footer nav{display:flex;gap:22px}
.profile-head{display:flex;justify-content:space-between;align-items:end;gap:20px;padding:44px 0 25px}.profile-head h1{font-size:35px;letter-spacing:-1.5px;margin:4px 0 5px}.profile-head p{font-size:13px;color:var(--dim);margin:0}.years{display:flex;gap:7px;flex-wrap:wrap}.years a{font:11px var(--mono);padding:7px 12px;border:1px solid var(--line);border-radius:6px;color:var(--dim)}.years [aria-current]{background:#302118;border-color:#61412f;color:var(--hot)}.profile-card{overflow-x:auto}.profile-card>svg{display:block;width:100%;height:auto;min-width:580px}.model-panel{margin-top:24px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#111113}.panel-head{display:flex;justify-content:space-between;align-items:center;padding:20px 23px;gap:15px;border-bottom:1px solid var(--line)}.panel-head h2{font-size:16px;letter-spacing:-.3px;margin:0}.panel-head span{font:10px var(--mono);color:var(--dim)}.table-scroll{overflow-x:auto}table.models{width:100%;border-collapse:collapse;font-size:12px;text-align:left;white-space:nowrap}.models th{font:10px var(--mono);color:var(--dim);font-weight:400;letter-spacing:.05em;text-transform:uppercase}.models td,.models th{padding:15px 23px;border-bottom:1px solid #242427}.models tbody tr:last-child td{border:0}.models td:nth-last-child(-n+2),.models th:nth-last-child(-n+2){text-align:right}.models td:nth-last-child(-n+2){font-family:var(--mono)}.models td:first-child{color:var(--dim)}.model-name{min-width:210px}.model-meter{height:3px;width:100%;background:#272023;margin-top:8px;border-radius:2px}.model-meter span{display:block;height:100%;background:var(--hot);border-radius:2px}.empty{padding:26px;color:var(--dim);font-size:13px;margin:0}.embed-section{margin-top:28px}.embed-section h2{font-size:18px;margin-bottom:8px}.embed-section>p{font-size:13px;color:var(--dim)}.code-box{display:flex;align-items:center;gap:16px;padding:16px;background:#131315;border:1px solid var(--line);border-radius:8px}.code-box code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font-size:11px}.profile-note{font-size:12px;color:var(--dim);margin:20px 0 0}
dialog{color:var(--fg);background:#151517;border:1px solid #403a36;border-radius:14px;width:min(620px,calc(100% - 28px));max-height:calc(100dvh - 40px);padding:28px;box-shadow:0 24px 100px #0008}dialog::backdrop{background:#000b;backdrop-filter:blur(6px)}body:has(dialog[open]){overflow:hidden}.dialog-head{display:flex;align-items:center;justify-content:space-between;gap:20px}.dialog-head .eyebrow{color:var(--hot)}.close{border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--dim);height:32px;width:32px;font-size:20px}.close:hover{background:#262629;color:var(--fg)}dialog h2{margin:18px 0 10px;font-size:30px}dialog .intro{color:var(--dim);font-size:13px;margin-bottom:20px}.setup-steps{display:flex;gap:12px;flex-wrap:wrap;font:10px/1.6 var(--mono);color:#c3bcc0;padding:0;list-style:none;margin:0 0 18px}.setup-steps b{color:var(--hot);font-weight:400;margin-right:5px}.prompt-label{font:10px var(--mono);color:var(--dim);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:9px}textarea{display:block;width:100%;resize:vertical;min-height:185px;max-height:340px;border:1px solid #343236;border-radius:8px;background:#0c0c0e;color:#cecad0;padding:15px;font-size:11px;line-height:1.8}dialog .setup-note{padding:12px 0;color:var(--dim);font-size:11px;line-height:1.8;margin:0}dialog .setup-note strong{color:#d6c0af;font-weight:500}dialog .primary{width:100%}.copy-status{font:11px/1.6 var(--mono);color:var(--hot);min-height:18px;margin:9px 0 0}.global-status{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#262020;border:1px solid #61412f;border-radius:7px;padding:10px 18px;z-index:5;font-size:12px;width:max-content;max-width:90vw}.global-status:empty{display:none}
@media(min-width:1400px){.hero{padding-top:82px}}@media(max-width:760px){.wrap{padding:0 20px}.site-header{height:72px}.nav{gap:15px}.nav .nav-link{display:none}.hero{padding:46px 0 32px}.old-quote{font-size:12px}.hero h1{letter-spacing:-1.8px;font-size:48px}.hero .lede{font-size:14px;max-width:440px}.section{padding-top:52px}.section-intro{display:block}.section-intro>p{margin-top:13px;max-width:none}.section-intro h2{font-size:27px}.steps{grid-template-columns:1fr}.step{padding:22px}.step-num{margin-bottom:15px}.agent-callout{flex-wrap:wrap;padding:20px}.agent-callout .button{margin-left:58px}.privacy-grid{grid-template-columns:1fr}.privacy-box+.privacy-box{border-left:0;border-top:1px solid var(--line)}.bottom-grid{grid-template-columns:1fr;gap:32px}.preview-body{overflow-x:auto;padding:12px}.preview img{min-width:600px}.window-bar{padding:0 12px;font-size:10px}.preview-caption{padding:0 13px 13px;font-size:10px}.preview-caption>span{display:none}.profile-head{align-items:start;flex-direction:column;padding-top:30px}.profile-head h1{font-size:30px}.panel-head{padding:17px}.panel-head span{max-width:140px;text-align:right;line-height:1.6}.models td,.models th{padding:13px 17px}footer{margin-top:52px;align-items:start}.lookup{padding:22px}}
@media(max-width:400px){.wrap{padding:0 16px}.brand{font-size:16px;gap:7px}.brand svg{width:23px;height:23px}.nav .button{font-size:11px;padding:7px 9px}.hero h1{font-size:40px}.support{gap:13px;font-size:10px}.agent-callout .button{margin-left:0;width:100%}.preview-caption{font-size:9px}.live{font-size:9px}dialog{padding:20px}.setup-steps{gap:8px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
</style>`;

const SITE_SCRIPT = `<script>
const dialog = document.getElementById('agent-dialog');
document.querySelectorAll('[data-agent]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
document.getElementById('close-agent').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
document.querySelectorAll('[data-copy],[data-copy-target]').forEach(button => button.addEventListener('click', async () => {
  const target = document.getElementById(button.dataset.copyTarget);
  const value = target ? (target.value ?? target.textContent) : button.dataset.copy;
  const status = document.getElementById(dialog.open ? 'agent-status' : 'copy-status');
  const label = button.textContent;
  button.disabled = true;
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = 'Copied!';
    status.textContent = target?.id === 'agent-prompt' ? 'Ready. Paste it into your coding agent.' : 'Copied to clipboard.';
  } catch {
    if (target) { const selection = getSelection(); const range = document.createRange(); range.selectNodeContents(target); selection.removeAllRanges(); selection.addRange(range); target.focus(); target.select?.(); }
    status.textContent = 'Clipboard unavailable. Select the text and copy it manually.';
  }
  setTimeout(() => { button.textContent = label; button.disabled = false; }, 1800);
  if (!dialog.open) setTimeout(() => { status.textContent = ''; }, 5000);
}));
const lookup = document.getElementById('profile-lookup');
lookup?.addEventListener('submit', event => {
  event.preventDefault();
  const input = lookup.elements.username;
  const username = input.value.trim().replace(/^@/, '');
  input.setCustomValidity(/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(username) ? '' : 'Enter a GitHub username (letters, numbers and hyphens, up to 39 characters).');
  if (input.reportValidity()) location.assign('/' + encodeURIComponent(username));
});
lookup?.elements.username.addEventListener('input', event => event.target.setCustomValidity(''));
</script>`;

const AGENT_PROMPT = `Set up TokenGazer on my machine to track my Claude Code and Codex token usage and publish my contribution card.

1. Check that this is macOS or Linux and Node.js 20 or newer with npm/npx is available. If a prerequisite is missing, explain what I need rather than installing system software without asking.
2. Run npx --yes tokengazer to show my local usage. Explain that login publishes daily totals per tool and model on a public GitHub-linked profile and installs an hourly upload job. Prompts, code, file paths and project names are not uploaded.
3. Run npx --yes tokengazer login in a persistent terminal session. Show me the GitHub verification URL and device code immediately, and keep the process running while I authorize it in my browser. Let me complete authorization myself. Never ask for my GitHub password or access token.
4. After login succeeds, run npx --yes tokengazer push and confirm it succeeds. If there are no usage logs, say so rather than claiming that data was uploaded. Show my profile URL and Markdown embed snippet from the CLI output, and explain that sync runs hourly.
5. Never print or share the contents of ~/.tokengazer/config.json or any API keys. If setup fails, show the error and the next step; do not claim the connection succeeded.

Do not edit my README or agent settings unless I ask. To disconnect later, I can run npx --yes tokengazer logout. Adding --delete also erases my published data.`;

function agentSetup() {
  return `<dialog id="agent-dialog" aria-labelledby="agent-title" aria-describedby="agent-description">
<div class="dialog-head"><span class="eyebrow">&gt;_ AGENT SETUP</span><button class="close" id="close-agent" type="button" aria-label="Close agent setup">×</button></div>
<h2 id="agent-title">Bring your agent along.</h2><p class="intro" id="agent-description">Paste this prompt into Claude Code, Codex, or a coding agent with terminal access on your machine. It takes care of setup.</p>
<ol class="setup-steps"><li><b>01</b> Copy the prompt</li><li><b>02</b> Paste into your agent</li><li><b>03</b> Authorize with GitHub</li></ol>
<label class="prompt-label" for="agent-prompt">Your setup prompt</label><textarea id="agent-prompt" readonly spellcheck="false">${esc(AGENT_PROMPT)}</textarea>
<p class="setup-note"><strong>You stay in control.</strong> You authorize GitHub in your browser. Only daily token totals become public. Setup adds hourly sync. Requires Node.js 20+ on macOS or Linux.</p>
<button type="button" class="button primary" data-copy-target="agent-prompt">Copy setup prompt <span aria-hidden="true">↗</span></button><p id="agent-status" class="copy-status" role="status"></p>
</dialog><p id="copy-status" class="global-status" role="status"></p>`;
}

function siteHeader() {
  return `<a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="brand" href="/" aria-label="tokengazer home">${logoSvg().replace('<svg ', '<svg aria-hidden="true" ')}tokengazer</a><nav class="nav" aria-label="Main navigation"><a class="nav-link" href="/#how-it-works">How it works</a><a class="nav-link" href="${REPO}">GitHub <span aria-hidden="true">↗</span></a><button class="button" type="button" data-agent>Add your agent <span class="arrow" aria-hidden="true">+</span></button></nav></header>`;
}

function siteFooter() {
  return `<footer><a class="brand" href="/">${logoSvg().replace('<svg ', '<svg aria-hidden="true" ')}tokengazer</a><span>Built for the way you build.</span><nav aria-label="Footer"><a href="${REPO}">Source ↗</a><a href="/llms.txt">llms.txt</a><span>MIT licensed</span></nav></footer>`;
}

export function renderPage(login, s, years, year, host) {
  const today = iso(Date.now());
  const yearEnd = `${year}-12-31`;
  const card = renderCard(login, s, yearEnd < today ? yearEnd : today);
  const embed = `[![tokens](${host}/${login}.svg)](${host}/${login})`;
  const rows = s.byModel.map((m) => `<tr><td>${m.tool === 'claude' ? 'Claude Code' : esc(m.tool === 'codex' ? 'Codex' : m.tool)}</td><td class="model-name">${esc(m.model)}<div class="model-meter" aria-hidden="true"><span style="width:${s.tokens ? (m.tokens / s.tokens * 100).toFixed(2) : 0}%"></span></div></td><td>${fmt(m.tokens)}</td><td>$${fmt(m.cost)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>@${esc(login)} · tokengazer</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>${SITE_STYLE}</head>
<body><div class="wrap">${siteHeader()}<main id="main">
<div class="profile-head"><div><span class="eyebrow"><span class="dot"></span> DEVELOPER ACTIVITY</span><h1>@${esc(login)}</h1><p>Your tokens, tools, and the work behind them.</p></div><nav class="years" aria-label="Activity year">${years.map((y) => `<a href="?year=${y}"${y === year ? ' aria-current="page"' : ''}>${y}</a>`).join('')}</nav></div>
<div class="preview"><div class="window-bar"><span class="window-label"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span> token activity</span><span class="live">${year} heatmap · all-time totals</span></div><div class="preview-body profile-card">${card}</div></div>
<section class="model-panel" aria-labelledby="models-title"><div class="panel-head"><h2 id="models-title">Model breakdown</h2><span>All-time · API list-price equivalent</span></div>${rows ? `<div class="table-scroll"><table class="models"><thead><tr><th scope="col">Tool</th><th scope="col">Model</th><th scope="col">Tokens</th><th scope="col">Est. cost</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">No model usage yet. Run <code>npx tokengazer push</code> after your next coding session.</p>'}</section>
<section class="embed-section" aria-labelledby="embed-title"><h2 id="embed-title">Take your graph with you.</h2><p>One snippet for your GitHub README, portfolio, or wherever you share your work.</p><div class="code-box"><code id="embed-code">${esc(embed)}</code><button type="button" class="copy" data-copy-target="embed-code">Copy Markdown</button></div></section>
<p class="profile-note">Prompts, code and file paths never leave your machine. Only daily token totals per tool and model are published. Days before local logs were kept are estimated from prompt history. Cost reflects API list prices, not subscription spend.</p>
</main>${siteFooter()}</div>${agentSetup()}${SITE_SCRIPT}</body></html>`;
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

export function renderLanding(host) {
  const safeHost = esc(host);
  const title = 'tokengazer · a contribution graph for your AI tokens';
  const desc = 'See the work behind your AI workflow. Track Claude Code and Codex tokens, share your contribution graph, and connect with one agent prompt.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="canonical" href="${safeHost}/"><link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<meta property="og:type" content="website"><meta property="og:url" content="${safeHost}/"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}"><link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>${SITE_STYLE}</head>
<body><div class="wrap">${siteHeader()}<main id="main">
<section class="hero" aria-labelledby="hero-title"><p class="old-quote"><s>Talk is cheap. Show me the code.</s><span>— Linus Torvalds</span></p>
<h1 id="hero-title">Code is cheap.<br><em>Show me the prompt.</em></h1>
<p class="lede">A contribution graph for your Claude Code and Codex tokens. See your usage. Find your rhythm. Put it in your README.</p>
<div class="actions"><button type="button" class="button primary" data-agent><span aria-hidden="true">&gt;_</span> Add your agent <span class="arrow" aria-hidden="true">↗</span></button><a class="button" href="#how-it-works">Set up with the CLI <span class="arrow" aria-hidden="true">→</span></a></div>
<div class="quick-command"><span class="dollar" aria-hidden="true">$</span><code id="local-command">npx tokengazer</code><button class="copy" type="button" data-copy-target="local-command" aria-label="Copy npx tokengazer">Copy</button></div>
<div class="support"><span><span class="claude" aria-hidden="true">✳</span> Claude Code</span><span><span class="codex" aria-hidden="true">⌘</span> OpenAI Codex</span><span><span aria-hidden="true">◇</span> Local-first. Open source.</span></div></section>
<section class="preview" aria-label="Live contribution card preview"><div class="window-bar"><span class="window-label"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span> tokengazer / ${EXAMPLE}</span><span class="live"><span class="dot"></span> Live profile</span></div><div class="preview-body"><a class="preview-link" href="/${EXAMPLE}"><img src="/${EXAMPLE}.svg" width="900" height="380" alt="Live token activity for @${EXAMPLE}: tokens, estimated API cost, active days, streak and contribution heatmap"></a></div><div class="preview-caption"><a href="/${EXAMPLE}">Explore @${EXAMPLE}'s profile <span aria-hidden="true">↗</span></a><span>Your next contribution graph starts here.</span></div></section>
<section class="section" id="how-it-works" aria-labelledby="how-title"><div class="section-intro"><div><span class="eyebrow">01 / GET STARTED</span><h2 id="how-title">From terminal to timeline.</h2></div><p>No SDK. No code changes. Just the session logs your tools already create.</p></div>
<ol class="steps"><li class="step"><span class="step-num">01 / INSPECT</span><h3>Meet your token footprint.</h3><p>Read your local Claude Code and Codex logs. See your stats before uploading anything.</p><code class="mini-code"><span class="command-prefix" aria-hidden="true">$</span>npx tokengazer</code></li><li class="step"><span class="step-num">02 / CONNECT</span><h3>Make it yours.</h3><p>Sign in with GitHub to publish your card. An hourly job keeps your numbers fresh.</p><code class="mini-code"><span class="command-prefix" aria-hidden="true">$</span>npx tokengazer login</code></li><li class="step"><span class="step-num">03 / SHARE</span><h3>Show your side of the work.</h3><p>Copy your Markdown snippet into a README, portfolio, or anywhere you tell your story.</p><code class="mini-code">[![tokens](…/you.svg)](…/you)</code></li></ol>
<div class="agent-callout"><span class="agent-symbol" aria-hidden="true">&gt;_</span><div><h3>Your agent can handle the setup.</h3><p>One prompt. Your existing coding agent. You're connected.</p></div><button type="button" class="button" data-agent>Get the setup prompt <span aria-hidden="true">↗</span></button></div>
<p class="privacy-note">Node.js 20+ · macOS &amp; Linux · No global install needed</p></section>
<section class="section" id="privacy" aria-labelledby="privacy-title"><div class="section-intro"><div><span class="eyebrow">02 / PRIVATE BY DESIGN</span><h2 id="privacy-title">Your work stays yours.</h2></div><p>Share your activity without sharing what you're working on.</p></div><div class="privacy-grid"><div class="privacy-box"><h3><span aria-hidden="true">↗</span> What gets published</h3><ul><li>Day, tool, and model</li><li>Input, output, cache, and reasoning token totals</li><li>Whether a day's usage was estimated</li></ul></div><div class="privacy-box"><h3><span aria-hidden="true">◇</span> What stays on your machine</h3><ul><li>Your prompts and AI responses</li><li>Code, file paths, and project names</li><li>Your original session logs</li></ul></div></div><p class="privacy-note">GitHub device sign-in asks for no scopes. Your GitHub token is used once to identify you, then discarded.</p></section>
<div class="section bottom-grid"><section class="faq" aria-labelledby="faq-title"><h2 id="faq-title">A few things to know.</h2><details><summary>Where do the numbers come from?</summary><p>Token counts come from Claude Code logs in <code>~/.claude/projects/</code> and Codex logs in <code>~/.codex/sessions/</code>. TokenGazer reads them locally and groups totals by day and model.</p></details><details><summary>Why are some days estimated?</summary><p>Claude Code deletes session logs after 30 days. Older days are estimated from prompt history and your median tokens per prompt. To retain exact history, set <code>"cleanupPeriodDays": 3650</code> in <code>~/.claude/settings.json</code>.</p></details><details><summary>Is the cost what I actually paid?</summary><p>Cost is the API list-price equivalent of your tokens, not your subscription spend or an invoice.</p></details><details><summary>How do I disconnect or delete my data?</summary><p><code>npx tokengazer logout</code> removes hourly sync and your local key. Add <code>--delete</code> to also erase your published data from the server.</p></details><details><summary>Can I build my own view?</summary><p>Yes. <code>/${esc('<github-username>')}.json</code> returns daily usage rows with CORS enabled. The project is open source under the MIT license.</p></details></section>
<section class="lookup" aria-labelledby="lookup-title"><span class="eyebrow">EXPLORE THE GRAPH</span><h2 id="lookup-title">Find a developer.</h2><p>Already connected? Your public profile is one GitHub username away.</p><form id="profile-lookup" action="/"><label for="username">GitHub username</label><input id="username" name="username" placeholder="e.g. ${EXAMPLE}" autocomplete="off" spellcheck="false" autocapitalize="none" maxlength="40" required><button class="button" type="submit">View profile <span aria-hidden="true">→</span></button></form><a href="/${EXAMPLE}">Or explore a live profile ↗</a></section></div>
<section class="embed-section section" aria-label="Example embed snippet"><div class="code-box"><code id="embed-code">${esc(`[![tokens](${host}/<you>.svg)](${host}/<you>)`)}</code><button class="copy" type="button" data-copy-target="embed-code">Copy template</button></div><p class="privacy-note">Replace &lt;you&gt; with your GitHub username after connecting.</p></section>
</main>${siteFooter()}</div>${agentSetup()}${SITE_SCRIPT}</body></html>`;
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
