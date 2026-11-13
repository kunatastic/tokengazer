import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const FIELDS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning'];

const parse = (line) => {
  try { return JSON.parse(line); } catch { return null; }
};

export function parseClaudeLines(lines, seen) {
  const out = [];
  for (const line of lines) {
    const e = parse(line);
    const m = e?.message;
    if (e?.type !== 'assistant' || !m?.usage || m.model === '<synthetic>') continue;
    const key = `${m.id}:${e.requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const u = m.usage;
    const row = {
      ts: e.timestamp, tool: 'claude', model: m.model,
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, reasoning: 0,
    };
    if (row.input + row.output + row.cache_read + row.cache_write > 0) out.push(row);
  }
  return out;
}

const codexUsage = (ts, model, u) => ({
  ts, tool: 'codex', model,
  input: u.input_tokens || 0, output: u.output_tokens || 0,
  cache_read: u.cached_input_tokens || 0, cache_write: u.cache_write_input_tokens || 0,
  reasoning: u.reasoning_output_tokens || 0,
});

export function parseCodexLines(lines) {
  const entries = lines.map(parse).filter(Boolean);
  const hasRecords = entries.some((e) => e.type === 'token_usage_record');
  const out = [];
  let model = 'unknown';
  let prevTotal = null;
  for (const e of entries) {
    const p = e.payload || {};
    if (e.type === 'turn_context' && p.model) model = p.model;
    if (hasRecords) {
      if (e.type === 'token_usage_record' && p.usage) out.push(codexUsage(e.timestamp, model, p.usage));
    } else if (p.type === 'token_count' && p.info?.last_token_usage) {
      const total = JSON.stringify(p.info.total_token_usage);
      if (total === prevTotal) continue;
      prevTotal = total;
      out.push(codexUsage(e.timestamp, model, p.info.last_token_usage));
    }
  }
  return out;
}

export function localDay(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function aggregate(usages) {
  const rows = new Map();
  for (const { ts, ...u } of usages) {
    const day = localDay(ts);
    if (day.includes('NaN')) continue;
    const key = `${day}|${u.tool}|${u.model}`;
    const row = rows.get(key) || { tool: u.tool, model: u.model, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, day, estimated: false };
    for (const f of FIELDS) row[f] += u[f];
    rows.set(key, row);
  }
  return [...rows.values()];
}

// ponytail: one median tokens-per-prompt for all history; ignores model/effort drift over time
export function estimateClaude(rows, promptsByDay, modelsByDay) {
  const claude = rows.filter((r) => r.tool === 'claude' && !r.estimated);
  const perDay = new Map();
  const mix = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const modelTotals = new Map();
  for (const r of claude) {
    const t = r.input + r.output + r.cache_read + r.cache_write;
    perDay.set(r.day, (perDay.get(r.day) || 0) + t);
    modelTotals.set(r.model, (modelTotals.get(r.model) || 0) + t);
    for (const f of FIELDS) mix[f] += r[f];
  }
  const ratios = [...perDay].filter(([d]) => promptsByDay.get(d)).map(([d, t]) => t / promptsByDay.get(d)).sort((a, b) => a - b);
  const mixTotal = mix.input + mix.output + mix.cache_read + mix.cache_write;
  if (!ratios.length || !mixTotal) return [];
  const perPrompt = ratios[Math.floor(ratios.length / 2)];
  const topModel = [...modelTotals].sort((a, b) => b[1] - a[1])[0][0];

  const out = [];
  for (const [day, prompts] of [...promptsByDay].sort()) {
    if (perDay.has(day)) continue;
    const split = modelsByDay.get(day) || { [topModel]: 1 };
    const weight = Object.values(split).reduce((a, b) => a + b, 0) || 1;
    for (const [model, w] of Object.entries(split)) {
      const part = (prompts * perPrompt * w) / weight;
      const row = { day, tool: 'claude', model, reasoning: 0, estimated: true };
      for (const f of ['input', 'output', 'cache_read', 'cache_write']) row[f] = Math.round((part * mix[f]) / mixTotal);
      out.push(row);
    }
  }
  return out;
}

function readLines(file) {
  try {
    let buf = readFileSync(file);
    if (file.endsWith('.zst')) {
      if (!zlib.zstdDecompressSync) return [];
      buf = zlib.zstdDecompressSync(buf);
    }
    return buf.toString('utf8').split('\n');
  } catch {
    return [];
  }
}

function files(root, test) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true }).filter((f) => test(String(f))).map((f) => join(root, String(f)));
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function scan(home) {
  const seen = new Set();
  const usages = [];
  for (const f of files(join(home, '.claude/projects'), (n) => n.endsWith('.jsonl'))) usages.push(...parseClaudeLines(readLines(f), seen));
  for (const f of files(join(home, '.codex/sessions'), (n) => /\.jsonl(\.zst)?$/.test(n))) usages.push(...parseCodexLines(readLines(f)));
  const rows = aggregate(usages);

  const prompts = new Map();
  for (const line of readLines(join(home, '.claude/history.jsonl'))) {
    const ts = parse(line)?.timestamp;
    if (typeof ts !== 'number') continue;
    const day = localDay(ts);
    prompts.set(day, (prompts.get(day) || 0) + 1);
  }
  const stats = readJson(join(home, '.claude/stats-cache.json'));
  const models = new Map((stats?.dailyModelTokens || []).map((d) => [d.date, d.tokensByModel]));
  return [...rows, ...estimateClaude(rows, prompts, models)];
}
