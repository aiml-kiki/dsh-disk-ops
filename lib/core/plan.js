/**
 * Cleanup plans: "show me exactly what would be deleted", then execute only
 * that same set after the user confirms.
 *
 * A plan is immutable and short-lived. Every item records identity (dev/inode,
 * mtime, size) at plan time; commit re-stats and refuses anything that moved.
 */

import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { assertDeletableReal } from './path-safety.js';
import { isDeletable, loadUserRules, matchPath, mergeRules } from './rules.js';

/** Plans expire quickly so a stale confirmation cannot delete later files. */
export const PLAN_TTL_MS = 10 * 60 * 1000;

/**
 * @typedef {object} PlanItem
 * @property {number} id
 * @property {string} path
 * @property {number|null} size
 * @property {boolean} is_dir
 * @property {number} mtime_ms
 * @property {number} ino
 * @property {number} dev
 * @property {string} rule_id
 * @property {string} category
 * @property {string} safety
 */

/**
 * Build a plan from candidate paths. Candidates that no longer match a
 * `trash` rule, are protected, or cannot be stat'ed are reported in `skipped`
 * and never enter `items`.
 *
 * @param {Array<{path:string, size?:number|null}>} candidates
 * @returns {Promise<{
 *   plan_id:string, token:string, created_at:string, expires_at:string,
 *   items:PlanItem[], skipped:Array<{path:string, reason:string}>, total:number
 * }>}
 */
export async function createPlan(candidates, options = {}) {
  const user = await loadUserRules();
  const merged =
    Array.isArray(options.rules)
      ? { rules: options.rules, ignore: options.ignore ?? [], neverDelete: options.neverDelete ?? [] }
      : mergeRules(user);
  const policy = options.policy ?? {};
  const manual = options.manual === true;
  /** @type {PlanItem[]} */
  const items = [];
  /** @type {Array<{path:string, reason:string}>} */
  const skipped = [];

  for (const candidate of candidates) {
    const path = posix.normalize(candidate.path);
    const rule = matchPath(path, merged.rules, merged.ignore);
    if (rule === undefined && !manual) {
      skipped.push({ path, reason: '没有匹配的清理规则' });
      continue;
    }
    if (rule !== undefined && rule.action !== 'trash' && !manual) {
      skipped.push({ path, reason: `规则 ${rule.id} 只报告，不删除` });
      continue;
    }
    if (!isDeletable(path, { neverDelete: merged.neverDelete, ...policy })) {
      skipped.push({ path, reason: '在保护名单内' });
      continue;
    }
    try {
      await assertDeletableReal(path, policy);
    } catch (error) {
      skipped.push({ path, reason: messageOf(error) });
      continue;
    }
    try {
      const info = await stat(path);
      items.push({
        id: items.length + 1,
        path,
        size: typeof candidate.size === 'number' ? candidate.size : info.size,
        is_dir: info.isDirectory(),
        mtime_ms: Math.round(info.mtimeMs),
        ino: info.ino,
        dev: info.dev,
        rule_id: rule === undefined ? 'manual' : rule.id,
        category: rule === undefined ? '手动选择' : rule.category,
        safety: rule === undefined ? 'risky' : rule.safety,
      });
    } catch (error) {
      skipped.push({ path, reason: `无法读取：${messageOf(error)}` });
    }
  }

  const created = new Date();
  const expires = new Date(created.getTime() + PLAN_TTL_MS);
  const digest = digestItems(items);
  return {
    plan_id: digest.slice(0, 12),
    token: digest.slice(0, 8),
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
    items,
    skipped,
    manual,
    total: items.reduce((sum, item) => sum + (item.size ?? 0), 0),
  };
}

/**
 * Stable hash over identity fields; any change to an item changes the token.
 *
 * @param {PlanItem[]} items
 * @returns {string}
 */
export function digestItems(items) {
  const canonical = items
    .map((item) => `${item.path}\u0000${item.ino}\u0000${item.dev}\u0000${item.mtime_ms}\u0000${item.size ?? ''}`)
    .join('\u0001');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify a plan is still valid as a whole (not expired, token matches).
 *
 * @param {{expires_at:string, token:string, items:PlanItem[]}} plan
 * @param {string} token
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function verifyPlan(plan, token) {
  if (Date.parse(plan.expires_at) < Date.now()) return { ok: false, reason: '计划已过期，请重新扫描' };
  if (plan.token !== token) return { ok: false, reason: '确认串不匹配' };
  return { ok: true };
}

/**
 * Re-stat one item at commit time. Anything that changed is skipped.
 *
 * @param {PlanItem} item
 * @returns {Promise<{ok:true, real:string}|{ok:false, reason:string}>}
 */
export async function verifyPlanItem(item, policy = {}) {
  try {
    const real = await assertDeletableReal(item.path, policy);
    const info = await stat(real);
    if (info.ino !== item.ino || info.dev !== item.dev) return { ok: false, reason: '文件已变化（inode）' };
    if (!item.is_dir && info.size !== item.size) return { ok: false, reason: '文件已变化（大小）' };
    if (Math.round(info.mtimeMs) !== item.mtime_ms) return { ok: false, reason: '文件已变化（时间）' };
    return { ok: true, real };
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
