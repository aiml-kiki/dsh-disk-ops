import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { BUILTIN_RULES, matchPath, mergeRules, isDeletable } from '../lib/core/rules.js';
import { assertDeletable, isInside, SafetyError } from '../lib/core/path-safety.js';
import { isPrivatePath } from '../lib/core/platform.js';
import { scanLevel } from '../lib/core/scan.js';

const home = homedir();
const merged = mergeRules({ rules: [], ignore: [], neverDelete: [], file: '' });

test('caches rule matches direct children only', () => {
  const direct = posix.join(home, 'Library', 'Caches', 'com.example.app');
  const nested = posix.join(direct, 'Cache.db');
  assert.equal(matchPath(direct, merged.rules, [])?.id, 'app-caches');
  assert.equal(matchPath(nested, merged.rules, []), undefined);
});

test('prefix rules match nested paths', () => {
  const nested = posix.join(home, 'Library', 'Logs', 'DiagnosticReports', 'crash.ips');
  assert.equal(matchPath(nested, merged.rules, [])?.id, 'crash-reports');
});

test('installer rule matches by extension and parent', () => {
  const dmg = posix.join(home, 'Downloads', 'old.dmg');
  const zip = posix.join(home, 'Downloads', 'old.zip');
  assert.equal(matchPath(dmg, merged.rules, [])?.id, 'installers');
  assert.equal(matchPath(zip, merged.rules, []), undefined);
});

test('ignore list suppresses matches', () => {
  const keep = posix.join(home, 'Library', 'Caches', 'keep-me');
  assert.equal(matchPath(keep, merged.rules, [keep]), undefined);
});

test('user rule replaces builtin by id', () => {
  const custom = mergeRules({
    rules: [{ ...BUILTIN_RULES[0], action: 'report' }],
    ignore: [],
    neverDelete: [],
    file: '',
  });
  const target = posix.join(home, 'Library', 'Caches', 'x');
  assert.equal(matchPath(target, custom.rules, [])?.action, 'report');
});

test('protected paths refuse deletion', () => {
  assert.throws(() => assertDeletable(home), (error) => error instanceof SafetyError && error.code === 'root-itself');
  assert.throws(
    () => assertDeletable(posix.join(home, 'Documents', 'notes')),
    (error) => error instanceof SafetyError && error.code === 'protected',
  );
  assert.throws(
    () => assertDeletable('/tmp/whatever'),
    (error) => error instanceof SafetyError && error.code === 'outside-roots',
  );
});

test('isDeletable honours neverDelete', () => {
  const cache = posix.join(home, 'Library', 'Caches', 'x');
  assert.equal(isDeletable(cache), true);
  assert.equal(isDeletable(cache, { neverDelete: [cache] }), false);
});

test('isInside is lexical and separator-safe', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true);
  assert.equal(isInside('/a/b', '/a/bc'), false);
  assert.equal(isInside('/a/b', '/a/b'), true);
});

test('TCC directories are identified and refused without scanning', async () => {
  assert.equal(isPrivatePath(posix.join(home, 'Library', 'Containers', 'com.example')), true);
  assert.equal(isPrivatePath(posix.join(home, 'Library', 'Caches')), false);
  const result = await scanLevel(posix.join(home, 'Library', 'Containers'));
  assert.equal(result.scan_status, 'restricted');
  assert.equal(result.entries.length, 0);
});
