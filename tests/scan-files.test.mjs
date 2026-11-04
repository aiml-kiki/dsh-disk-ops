import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanLevel } from '../lib/core/scan.js';

test('scanLevel sizes plain files that `du -d 1` omits', async () => {
  const previous = process.env.DSH_HOME;
  const harness = await mkdtemp(join(tmpdir(), 'disk-ops-home-'));
  const dir = await mkdtemp(join(tmpdir(), 'disk-ops-dir-'));
  process.env.DSH_HOME = harness;
  try {
    await writeFile(join(dir, 'payload.bin'), Buffer.alloc(1024 * 1024));
    const result = await scanLevel(dir, { refresh: true });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].name, 'payload.bin');
    assert.ok(result.entries[0].size >= 1024 * 1024 - 4096);
  } finally {
    process.env.DSH_HOME = previous;
    await rm(dir, { recursive: true, force: true });
    await rm(harness, { recursive: true, force: true });
  }
});
