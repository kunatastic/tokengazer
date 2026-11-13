import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/stats.js';
import { renderCard, renderPage, heatLevel } from '../src/render.js';

const r = { tool: 'claude', model: 'x', output: 0, cache_read: 0, cache_write: 0, reasoning: 0, estimated: false };

test('heatLevel', () => assert.deepEqual([0, 1, 50, 100].map((v) => heatLevel(v, 100)), [0, 1, 2, 4]));

test('card: headline, split, stat labels, 365+ cells, escapes login', () => {
  const s = summarize([{ ...r, day: '2026-11-12', input: 3e9 }], '2026-11-12');
  const svg = renderCard('a<b', s, '2026-11-12');
  assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /3\.0B TOKENS OVER 1 ACTIVE DAYS/);
  assert.match(svg, /3\.0B Claude · 0 Codex/);
  assert.ok(!svg.includes('ESTIMATED'));
  for (const l of ['Tokens', 'Cost', 'Active days', 'Streak']) assert.ok(svg.includes(l), l);
  assert.ok((svg.match(/<rect class="d/g) || []).length >= 365);
  assert.ok(!svg.includes('a<b') && svg.includes('a&lt;b'));
  assert.ok(!/@import|url\(http/.test(svg));
});

test('card: estimated days render exactly like measured ones', () => {
  const s = summarize([{ ...r, day: '2026-11-12', input: 2.5e9 }, { ...r, day: '2026-11-01', input: 9.7e9, estimated: true }], '2026-11-12');
  const svg = renderCard('k', s, '2026-11-12');
  assert.match(svg, /12\.2B TOKENS OVER 2 ACTIVE DAYS/);
  assert.ok(!/~|ESTIMATED|DASHED| est"|stroke-dasharray/.test(svg));
});

test('card: busiest day gets top shade', () => {
  const s = summarize([{ ...r, day: '2026-11-12', input: 100 }, { ...r, day: '2026-11-11', input: 1 }], '2026-11-12');
  const svg = renderCard('k', s, '2026-11-12');
  const cells = (l) => (svg.match(new RegExp(`class="d${l}"[^>]*><title>`, 'g')) || []).length;
  assert.deepEqual([cells(4), cells(1)], [1, 1]);
});

test('card: null summary renders not-tracking card', () => assert.match(renderCard('x', null, '2026-11-12'), /not tracking yet/i));

test('page: contains card, year links, model breakdown and privacy note', () => {
  const s = summarize([{ ...r, day: '2026-11-12', input: 5, model: 'claude-opus-5-5' }], '2026-11-12');
  const html = renderPage('kunatastic', s, [2026, 2025], 2026, 'https://h');
  assert.match(html, /<svg/);
  assert.match(html, /href="\?year=2025"/);
  assert.match(html, /claude-opus-5-5/);
  assert.match(html, /never leave your machine/i);
  assert.match(html, /https:\/\/h\/kunatastic\.svg/);
});

test('card: legend squares keep clear of the LESS and MORE labels', () => {
  const s = summarize([{ ...r, day: '2026-11-12', input: 5 }], '2026-11-12');
  const svg = renderCard('k', s, '2026-11-12');
  const xs = [...svg.matchAll(/<rect class="d\d" x="(\d+)" y="352"/g)].map((m) => Number(m[1]));
  const less = Number(svg.match(/<text x="(\d+)" y="362" text-anchor="end">LESS/)[1]);
  const more = Number(svg.match(/<text x="(\d+)" y="362" text-anchor="end">MORE/)[1]);
  const labelWidth = 4 * 11 * 0.72; // 4 monospace glyphs at 11px with .12em letter-spacing
  assert.equal(xs.length, 5);
  assert.ok(less + 6 <= xs[0], `LESS ends at ${less}, first square at ${xs[0]}`);
  assert.ok(xs[4] + 12 + 6 <= more - labelWidth, `last square ends at ${xs[4] + 12}, MORE starts at ${more - labelWidth}`);
});
