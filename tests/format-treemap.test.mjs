import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatBytesCompact, parseSize } from '../lib/core/format.js';
import { layoutTreemap } from '../lib/core/treemap.js';

test('formatBytes uses 1024 units', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(10 * 1024 ** 2), '10.0 MB');
  assert.equal(formatBytes(100 * 1024 ** 3), '100 GB');
  assert.equal(formatBytes(null), '—');
});

test('formatBytesCompact drops the space', () => {
  assert.equal(formatBytesCompact(1024), '1.00KB');
});

test('parseSize accepts units and bare bytes', () => {
  assert.equal(parseSize('100MB'), 100 * 1024 ** 2);
  assert.equal(parseSize('1.5 GB'), 1.5 * 1024 ** 3);
  assert.equal(parseSize(2048), 2048);
  assert.throws(() => parseSize('ten MB'), /cannot parse size/);
});

test('treemap covers the rectangle without overlap', () => {
  const items = [
    { key: 'a', value: 52 },
    { key: 'b', value: 31 },
    { key: 'c', value: 12 },
    { key: 'd', value: 5 },
  ];
  const rect = { x: 0, y: 0, w: 100, h: 50 };
  const laid = layoutTreemap(items, rect);
  assert.equal(laid.length, 4);

  const area = laid.reduce((sum, node) => sum + node.w * node.h, 0);
  assert.ok(Math.abs(area - rect.w * rect.h) < 1e-6, `area ${area}`);

  for (const node of laid) {
    assert.ok(node.x >= -1e-9 && node.y >= -1e-9);
    assert.ok(node.x + node.w <= rect.w + 1e-6);
    assert.ok(node.y + node.h <= rect.h + 1e-6);
    assert.ok(node.w > 0 && node.h > 0);
  }

  for (let i = 0; i < laid.length; i += 1) {
    for (let j = i + 1; j < laid.length; j += 1) {
      const a = laid[i];
      const b = laid[j];
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(overlapW <= 1e-6 || overlapH <= 1e-6, `overlap ${a.key}/${b.key}`);
    }
  }
});

test('treemap keeps relative areas', () => {
  const items = [{ key: 'big', value: 75 }, { key: 'small', value: 25 }];
  const laid = layoutTreemap(items, { x: 0, y: 0, w: 200, h: 100 });
  const big = laid.find((node) => node.key === 'big');
  const small = laid.find((node) => node.key === 'small');
  assert.ok(big.w * big.h > small.w * small.h * 2.9);
});

test('treemap ignores empty input and zero values', () => {
  assert.deepEqual(layoutTreemap([], { x: 0, y: 0, w: 10, h: 10 }), []);
  assert.deepEqual(layoutTreemap([{ key: 'z', value: 0 }], { x: 0, y: 0, w: 10, h: 10 }), []);
  assert.deepEqual(layoutTreemap([{ key: 'z', value: 1 }], { x: 0, y: 0, w: 0, h: 10 }), []);
});
