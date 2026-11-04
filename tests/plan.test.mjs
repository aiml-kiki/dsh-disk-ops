import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createPlan, verifyPlan, verifyPlanItem } from '../lib/core/plan.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, '..', '.tmp-test', 'plan');
const policy = { roots: [fixtureRoot], protected: [] };
const rules = [
  { id: 'test-root', category: '测试', kind: 'prefix', path: fixtureRoot, safety: 'safe', action: 'trash' },
];

test('plan records identity and re-verifies it', async () => {
  const dir = join(fixtureRoot, 'junk');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'a.bin'), 'hello');

  const plan = await createPlan([{ path: dir, size: 5 }], { policy, rules });
  assert.equal(plan.items.length, 1);
  assert.match(plan.token, /^[0-9a-f]{8}$/);
  assert.ok(Date.parse(plan.expires_at) > Date.now());
  assert.equal(verifyPlan(plan, plan.token).ok, true);
  assert.equal(verifyPlan(plan, 'deadbeef').ok, false);

  const verified = await verifyPlanItem(plan.items[0], policy);
  assert.equal(verified.ok, true);

  await utimes(dir, new Date(2000, 0, 1), new Date(2000, 0, 1));
  const changed = await verifyPlanItem(plan.items[0], policy);
  assert.equal(changed.ok, false);

  await rm(fixtureRoot, { recursive: true, force: true });
});

test('plan skips paths that no rule covers', async () => {
  const plan = await createPlan([{ path: join(fixtureRoot, 'not-covered') }], {
    policy,
    rules: [],
  });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.equal(typeof plan.skipped[0].reason, 'string');
});

test('expired plan is refused', async () => {
  const dir = join(fixtureRoot, 'junk2');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'a.bin'), 'x');
  const plan = await createPlan([{ path: dir }], { policy, rules });
  const expired = { ...plan, expires_at: new Date(Date.now() - 1000).toISOString() };
  assert.equal(verifyPlan(expired, plan.token).ok, false);
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('manual plan accepts an uncovered path as risky', async () => {
  const dir = join(fixtureRoot, 'manual');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'a.bin'), 'x');

  const plan = await createPlan([{ path: dir, size: 1 }], { policy, rules: [], manual: true });
  assert.equal(plan.manual, true);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].rule_id, 'manual');
  assert.equal(plan.items[0].safety, 'risky');

  const protectedPlan = await createPlan([{ path: dir }], {
    policy: { roots: [fixtureRoot], protected: [dir] },
    rules: [],
    manual: true,
  });
  assert.equal(protectedPlan.items.length, 0);
  await rm(fixtureRoot, { recursive: true, force: true });
});
