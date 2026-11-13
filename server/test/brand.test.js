import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoSvg } from '../src/render.js';
import { renderCard } from '../src/render.js';
import { summarize } from '../src/stats.js';
import handler from '../src/index.js';

const cells = (svg) => [...svg.matchAll(/<rect [^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);

test('logo: 3×3 grid, diagonal ramp to bright orange, six dim cells', () => {
  const fills = cells(logoSvg());
  assert.equal(fills.length, 9);
  assert.deepEqual(fills.filter((f) => f !== '#2a211c').sort(), ['#7a3a1d', '#b04f22', '#e8692c'].sort());
});
test('logo: light variant uses light dim cells', () => assert.equal(cells(logoSvg({ light: true })).filter((f) => f === '#e8e2dd').length, 6));

test('card carries the grid mark next to the name', () => {
  const s = summarize([{ day: '2026-11-12', tool: 'claude', model: 'x', input: 5, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, estimated: false }], '2026-11-12');
  for (const svg of [renderCard('k', s, '2026-11-12'), renderCard('k', null, '2026-11-12')]) {
    assert.match(svg, /<g class="logo"/);
    assert.match(svg, />tokengazer<\/text>/);
  }
});

test('GET /favicon.svg serves the logo', async () => {
  const res = await handler.fetch(new Request('https://h/favicon.svg'), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(cells(await res.text()).length, 9);
});
