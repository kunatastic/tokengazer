const claude = (input, output, cache_read = input / 10) => ({ input, output, cache_read, cache_write: input * 1.25 });

// USD per 1M tokens, API list prices as of 2026-11 (OpenAI rates from openai.com/api/pricing). ponytail: Haiku 5.5's >100K-prompt tier and GPT long-context tiers ignored.
export const PRICES = {
  'claude-fable-5-2': claude(8, 40, 0.2),
  'claude-fable-5': claude(10, 50),
  'claude-mythos-5-2': claude(8, 40, 0.2),
  'claude-mythos-5': claude(10, 50),
  'claude-opus-5-5': claude(4, 20, 0.2),
  'claude-opus-5': claude(5, 25),
  'claude-opus-4': claude(5, 25),
  'claude-sonnet-5-5': claude(2, 10, 0.1),
  'claude-sonnet-5': claude(2, 10),
  'claude-sonnet-4': claude(3, 15),
  'claude-haiku-5-5': claude(0.1, 0.5),
  'claude-haiku-4': claude(1, 5),
  'gpt-6-astra': { input: 10, output: 50, cache_read: 1, cache_write: 0 },
  'gpt-6.1-sol': { input: 2, output: 10, cache_read: 0.1, cache_write: 0 },
  'gpt-6.1-terra': { input: 1, output: 5, cache_read: 0.05, cache_write: 0 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0 },
};

export function tokensOf(r) {
  return r.tool === 'codex' ? r.input + r.output : r.input + r.output + r.cache_read + r.cache_write;
}

function priceFor(model, prices) {
  let best = null;
  for (const prefix of Object.keys(prices)) if (model.startsWith(prefix) && (!best || prefix.length > best.length)) best = prefix;
  return best && prices[best];
}

export function costOf(r, prices = PRICES) {
  const p = priceFor(r.model, prices);
  if (!p) return 0;
  const input = r.tool === 'codex' ? r.input - r.cache_read : r.input;
  return (input * p.input + r.output * p.output + r.cache_read * p.cache_read + r.cache_write * p.cache_write) / 1e6;
}

const prevDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

export function summarize(rows, today) {
  const s = { tokens: 0, estimatedTokens: 0, cost: 0, byTool: { claude: 0, codex: 0 }, byDay: new Map(), estimatedDays: new Set(), byModel: [] };
  const measuredDays = new Set();
  const models = new Map();
  for (const r of rows) {
    const t = tokensOf(r);
    const c = costOf(r);
    if (!t) continue;
    s.tokens += t;
    s.cost += c;
    s.byTool[r.tool] = (s.byTool[r.tool] || 0) + t;
    s.byDay.set(r.day, (s.byDay.get(r.day) || 0) + t);
    if (r.estimated) s.estimatedTokens += t;
    else measuredDays.add(r.day);
    const key = `${r.tool}|${r.model}`;
    const m = models.get(key) || { tool: r.tool, model: r.model, tokens: 0, cost: 0 };
    m.tokens += t;
    m.cost += c;
    models.set(key, m);
  }
  for (const day of s.byDay.keys()) if (!measuredDays.has(day)) s.estimatedDays.add(day);
  s.byModel = [...models.values()].sort((a, b) => b.tokens - a.tokens);
  s.activeDays = s.byDay.size;
  let day = s.byDay.has(today) ? today : prevDay(today);
  s.streak = 0;
  while (s.byDay.has(day)) { s.streak++; day = prevDay(day); }
  return s;
}

export function fmt(n) {
  for (const [div, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (n >= div) {
      const v = n / div;
      return (v >= 100 ? Math.round(v) : v.toFixed(1)) + unit;
    }
  }
  return String(Math.round(n));
}
