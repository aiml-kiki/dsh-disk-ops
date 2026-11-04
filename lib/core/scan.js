/**
 * Scan orchestration: overview, drill-down, suggestions, large files.
 *
 * All sizes are allocated bytes (du), i.e. what `df` frees — not logical file
 * length. Partial results are labelled instead of guessed.
 */

import { lstat, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { directorySize, diskSummary, homeDir, isPrivatePath, largeFiles, levelSizes } from './platform.js';
import { CACHE_TTL_MS, cacheKey, readCacheRecord, writeCache } from './cache.js';
import {
  ageDays,
  expandRule,
  isDeletable,
  loadUserRules,
  matchPath,
  mergeRules,
  ruleBasePath,
} from './rules.js';

/** First paint budget for one level. */
export const SCAN_BUDGET_MS = 8000;
/** Suggestion budget, kept separate so the tree renders first. */
export const SUGGESTION_BUDGET_MS = 6000;
/** Spotlight budget for the Top-N list. */
export const BIG_FILE_BUDGET_MS = 5000;

/**
 * @typedef {object} Entry
 * @property {string} name
 * @property {string} path
 * @property {number|null} size
 * @property {boolean} is_dir
 * @property {'complete'|'partial'|'unavailable'} status
 */

/**
 * One level of the home directory: each child sized independently so a slow
 * child (Library) cannot hide the fast ones.
 *
 * @param {{refresh?:boolean, budgetMs?:number}} [options]
 * @returns {Promise<{path:string, entries:Entry[], total:number|null, scan_status:string, generated_at:string, cached?:boolean}>}
 */
export async function scanOverview(options = {}) {
  const home = homeDir();
  const key = cacheKey('overview', home, options.accurate === true ? 'accurate' : 'fast');
  if (options.refresh !== true) {
    const hit = await readCacheRecord(key);
    if (hit !== null) return { ...hit.record, cached: true, stale: hit.age > CACHE_TTL_MS };
  }

  const budget = options.budgetMs ?? SCAN_BUDGET_MS;
  const deadline = Date.now() + budget;
  const dirents = (await safeReaddir(home)).sort(byLikelySize);
  let partial = false;

  const entries = await mapLimit(dirents, 8, async (dirent) => {
    const path = posix.join(home, dirent.name);
    if (isPrivatePath(path)) {
      return {
        name: dirent.name,
        path,
        size: null,
        is_dir: dirent.isDirectory(),
        status: 'restricted',
        restricted: true,
      };
    }
    const remaining = Math.max(500, deadline - Date.now());
    if (remaining <= 500) partial = true;
    const { size, status } = dirent.isDirectory()
      ? await directorySize(path, remaining)
      : await fileSizeOf(path);
    if (status !== 'complete') partial = true;
    return {
      name: dirent.name,
      path,
      size,
      is_dir: dirent.isDirectory(),
      status,
    };
  });

  const known = entries.filter((entry) => typeof entry.size === 'number');
  const record = {
    generated_at: new Date().toISOString(),
    path: home,
    entries: entries.sort((a, b) => (b.size ?? -1) - (a.size ?? -1)),
    total: known.length > 0 ? known.reduce((sum, entry) => sum + entry.size, 0) : null,
    scan_status: partial ? 'partial' : 'complete',
  };
  await safeWriteCache(key, record);
  return record;
}

/**
 * One level below an arbitrary directory.
 *
 * @param {string} path
 * @param {{refresh?:boolean, budgetMs?:number}} [options]
 * @returns {Promise<{path:string, parent:string|null, entries:Entry[], total:number|null, scan_status:string, generated_at:string, cached?:boolean}>}
 */
export async function scanLevel(path, options = {}) {
  const target = posix.normalize(path);
  if (isPrivatePath(target)) {
    return {
      generated_at: new Date().toISOString(),
      path: target,
      parent: posix.dirname(target),
      entries: [],
      total: null,
      scan_status: 'restricted',
      note: 'macOS 隐私保护：不展开其他 App 的数据',
    };
  }

  const key = cacheKey('level', target);
  if (options.refresh !== true) {
    const hit = await readCacheRecord(key);
    if (hit !== null) return { ...hit.record, cached: true, stale: hit.age > CACHE_TTL_MS };
  }

  const budget = options.budgetMs ?? SCAN_BUDGET_MS;
  const { entries: sized, total, status } = await levelSizes(target, budget);
  const byPath = new Map(sized.map((entry) => [entry.path, entry.size]));
  const dirents = await safeReaddir(target);

  const entries = await mapLimit(dirents, 8, async (dirent) => {
    const childPath = posix.join(target, dirent.name);
    let size = byPath.get(childPath) ?? null;
    // BSD `du -d 1` reports directories only; regular files at this level
    // need their own allocated size or a file-only directory renders empty.
    if (size === null && !dirent.isDirectory()) {
      const info = await lstat(childPath).catch(() => null);
      if (info !== null && info.isFile()) size = info.blocks * 512;
    }
    const restricted = isPrivatePath(childPath);
    return {
      name: dirent.name,
      path: childPath,
      size,
      is_dir: dirent.isDirectory(),
      status: size === null ? 'partial' : 'complete',
      ...(restricted ? { restricted: true } : {}),
    };
  });
  // Sized entries missing from readdir (rare: deleted during scan) are skipped.
  const known = entries.filter((entry) => typeof entry.size === 'number');
  const record = {
    generated_at: new Date().toISOString(),
    path: target,
    parent: posix.dirname(target) === target ? null : posix.dirname(target),
    entries: entries.sort((a, b) => (b.size ?? -1) - (a.size ?? -1)),
    total: total ?? (known.length > 0 ? known.reduce((sum, entry) => sum + entry.size, 0) : null),
    scan_status: status,
  };
  await safeWriteCache(key, record);
  return record;
}

/**
 * @typedef {object} Suggestion
 * @property {string} id
 * @property {string} category
 * @property {string} path
 * @property {number|null} size
 * @property {'safe'|'probably'|'risky'|'irreversible'} safety
 * @property {'trash'|'report'|'trash-empty'} action
 * @property {string} [note]
 * @property {boolean} deletable
 * @property {'complete'|'partial'|'unavailable'} status
 * @property {number} [age_days]
 */

/**
 * @param {{refresh?:boolean, budgetMs?:number}} [options]
 * @returns {Promise<{suggestions:Suggestion[], reclaimable:number, scan_status:string, generated_at:string, warnings:string[], cached?:boolean}>}
 */
export async function computeSuggestions(options = {}) {
  const key = cacheKey('suggestions');
  if (options.refresh !== true) {
    const hit = await readCacheRecord(key);
    if (hit !== null) return { ...hit.record, cached: true, stale: hit.age > CACHE_TTL_MS };
  }

  const budget = options.budgetMs ?? SUGGESTION_BUDGET_MS;
  const deadline = Date.now() + budget;
  const user = await loadUserRules();
  const merged = mergeRules(user);
  const warnings = merged.warning === undefined ? [] : [merged.warning];

  /** @type {Array<{rule:import('./rules.js').Rule, kind:'children'|'dir'|'file', path:string}>} */
  const tasks = [];
  for (const rule of merged.rules) {
    if (rule.kind === 'children') {
      const base = ruleBasePath(rule);
      if (base !== undefined) tasks.push({ rule, kind: 'children', path: base });
      continue;
    }
    const paths = await expandRule(rule);
    for (const path of paths) {
      tasks.push({ rule, kind: rule.kind === 'ext' ? 'file' : 'dir', path });
    }
  }

  const batches = await mapLimit(tasks, 6, async (task) => {
    if (Date.now() >= deadline) return { partial: true, items: [] };
    const remaining = Math.max(300, Math.min(3000, deadline - Date.now()));
    if (task.kind === 'children') {
      const { entries, status } = await levelSizes(task.path, remaining);
      const items = entries
        .sort((a, b) => b.size - a.size)
        .slice(0, 60)
        .map((entry) => toSuggestion(task.rule, entry.path, entry.size, 'complete', Number.NaN, merged));
      return { partial: status !== 'complete', items };
    }
    if (task.kind === 'file') {
      const age = await ageDays(task.path);
      if (task.rule.minAgeDays !== undefined && age < task.rule.minAgeDays) return { partial: false, items: [] };
      const info = await fileSizeOf(task.path);
      if (info.size === null) return { partial: true, items: [] };
      return { partial: false, items: [toSuggestion(task.rule, task.path, info.size, 'complete', age, merged)] };
    }
    const { size, status } = await directorySize(task.path, remaining);
    return {
      partial: status !== 'complete',
      items: [toSuggestion(task.rule, task.path, size, status, await ageDays(task.path), merged)],
    };
  });

  let partial = batches.some((batch) => batch.partial);
  const collected = batches.flatMap((batch) => batch.items);

  // Drop nested suggestions: keep the shallowest path once so the same bytes
  // are never counted twice.
  const sorted = collected
    .filter((suggestion) => suggestion.action !== 'trash-empty')
    .sort((a, b) => a.path.length - b.path.length);
  const kept = [];
  for (const suggestion of sorted) {
    if (kept.some((parent) => suggestion.path === parent.path || suggestion.path.startsWith(`${parent.path}/`))) continue;
    kept.push(suggestion);
  }

  // Trash is a single special row, not a nested path.
  const trashRule = merged.rules.find((rule) => rule.action === 'trash-empty');
  if (trashRule !== undefined) {
    const base = ruleBasePath(trashRule);
    if (base !== undefined) {
      const remaining = Math.max(500, Math.min(3000, deadline - Date.now()));
      const { size, status } = await directorySize(base, remaining);
      if (status !== 'complete') partial = true;
      kept.push(toSuggestion(trashRule, base, size, status, await ageDays(base), merged));
    }
  }

  kept.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
  const reclaimable = kept
    .filter((suggestion) => suggestion.action === 'trash')
    .reduce((sum, suggestion) => sum + (suggestion.size ?? 0), 0);

  const record = {
    generated_at: new Date().toISOString(),
    suggestions: kept,
    reclaimable,
    scan_status: partial ? 'partial' : 'complete',
    warnings,
  };
  await safeWriteCache(key, record);
  return record;
}

/**
 * @param {import('./rules.js').Rule} rule
 * @param {string} path
 * @param {number|null} size
 * @param {'complete'|'partial'|'unavailable'} status
 * @param {number} age
 * @param {{ignore:string[], neverDelete:string[]}} merged
 * @returns {Suggestion}
 */
function toSuggestion(rule, path, size, status, age, merged) {
  return {
    id: rule.id,
    category: rule.category,
    path,
    size,
    safety: rule.safety,
    action: rule.action,
    note: rule.note,
    deletable: isDeletable(path, { neverDelete: merged.neverDelete }),
    status,
    age_days: Number.isFinite(age) ? Math.round(age) : undefined,
  };
}

/**
 * @param {{minBytes?:number, root?:string, budgetMs?:number}} [options]
 */
export async function findBigFiles(options = {}) {
  const minBytes = options.minBytes ?? 100 * 1024 * 1024;
  const root = options.root ?? homeDir();
  const files = await largeFiles(root, minBytes, { limit: 50, budgetMs: options.budgetMs ?? BIG_FILE_BUDGET_MS });
  return {
    generated_at: new Date().toISOString(),
    root,
    min_bytes: minBytes,
    files,
    scan_status: files.length === 0 ? 'partial' : 'complete',
  };
}

/**
 * Report the panel header needs.
 */
export async function summary() {
  return diskSummary();
}

/**
 * Match helper exposed for commands.
 * @param {string} path
 */
export async function describePath(path) {
  const user = await loadUserRules();
  const merged = mergeRules(user);
  const target = posix.normalize(path);
  const rule = matchPath(target, merged.rules, merged.ignore);
  return rule === undefined
    ? undefined
    : { rule_id: rule.id, category: rule.category, safety: rule.safety, action: rule.action, note: rule.note };
}

/**
 * Home children ordered so the dirs that usually dominate start first; this
 * keeps the first paint useful inside an 8-10s budget.
 * @param {import('node:fs').Dirent} a
 * @param {import('node:fs').Dirent} b
 */
function byLikelySize(a, b) {
  const order = ['Library', 'Downloads', 'Documents', 'Desktop', 'Movies', 'Pictures', 'Music', 'Public', 'Applications'];
  const rank = (dirent) => {
    const index = order.indexOf(dirent.name);
    if (index >= 0) return index;
    if (dirent.isDirectory()) return 100;
    return 200;
  };
  return rank(a) - rank(b);
}

/** @param {string} key @param {object} record */
async function safeWriteCache(key, record) {
  try {
    await writeCache(key, record);
  } catch {
    // A read-only home or a full disk must not break the scan itself.
  }
}

/** @param {string} path */
async function fileSizeOf(path) {
  try {
    const { stat } = await import('node:fs/promises');
    const info = await stat(path);
    return { size: info.size, status: 'complete' };
  } catch {
    return { size: null, status: 'unavailable' };
  }
}

/** @param {string} path */
async function safeReaddir(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Bounded-concurrency map.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T, index:number)=>Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
