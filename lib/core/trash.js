/**
 * Plan execution: re-verify each item, move it to the Trash, write the audit
 * trail. Trash only — permanent deletion lives in `emptyTrash`.
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { homeDir, moveToTrash } from './platform.js';
import { appendAudit } from './audit.js';
import { verifyPlanItem } from './plan.js';
import { assertDeletableReal } from './path-safety.js';

/**
 * @param {{plan_id:string, items:Array<any>}} plan
 * @param {{ids?:number[]}} [options]
 * @returns {Promise<{
 *   plan_id:string,
 *   trashed:Array<{path:string,size:number|null,method:string}>,
 *   skipped:Array<{path:string,reason:string}>,
 *   total:number
 * }>}
 */
export async function executePlan(plan, options = {}) {
  const wanted = Array.isArray(options.ids) && options.ids.length > 0 ? new Set(options.ids) : null;
  const runnable = [];
  const skipped = [];

  for (const item of plan.items) {
    if (wanted !== null && !wanted.has(item.id)) continue;
    const verified = await verifyPlanItem(item);
    if (!verified.ok) {
      skipped.push({ path: item.path, reason: verified.reason });
      continue;
    }
    runnable.push({ ...item, real: verified.real });
  }

  const moved = await moveToTrash(runnable.map((item) => item.real));
  const trashed = [];
  const records = [];

  for (let index = 0; index < runnable.length; index += 1) {
    const item = runnable[index];
    const result = moved[index];
    if (result.ok) {
      trashed.push({ path: item.path, size: item.size, method: result.method });
      records.push({
        ts: new Date().toISOString(),
        action: 'trash',
        path: item.path,
        size: item.size,
        method: result.method,
        plan_id: plan.plan_id,
        category: item.category,
        safety: item.safety,
        ok: true,
      });
    } else {
      skipped.push({ path: item.path, reason: result.message ?? '移入废纸篓失败' });
      records.push({
        ts: new Date().toISOString(),
        action: 'trash',
        path: item.path,
        size: item.size,
        method: result.method,
        plan_id: plan.plan_id,
        category: item.category,
        safety: item.safety,
        ok: false,
        error: result.message,
      });
    }
  }
  await appendAudit(records);
  return {
    plan_id: plan.plan_id,
    trashed,
    skipped,
    total: trashed.reduce((sum, item) => sum + (item.size ?? 0), 0),
  };
}

/**
 * Permanently delete everything directly inside ~/.Trash. Requires the exact
 * entry count as confirmation; refuses when the count does not match.
 *
 * @param {{confirmCount:number}} options
 * @returns {Promise<{ok:boolean, message:string, removed:number, freed:number}>}
 */
export async function emptyTrash(options) {
  const trash = posix.join(homeDir(), '.Trash');
  await assertDeletableReal(trash);
  let entries;
  try {
    entries = await readdir(trash, { withFileTypes: true });
  } catch {
    return { ok: false, message: '无法读取废纸篓', removed: 0, freed: 0 };
  }
  const wanted = Number(options.confirmCount);
  if (!Number.isInteger(wanted) || wanted !== entries.length) {
    return {
      ok: false,
      message: `确认数量不匹配：当前 ${entries.length} 项，确认数 ${Number.isFinite(wanted) ? wanted : '无效'}`,
      removed: 0,
      freed: 0,
    };
  }
  let freed = 0;
  let removed = 0;
  const records = [];
  for (const entry of entries) {
    const path = posix.join(trash, entry.name);
    let size = null;
    try {
      const info = await stat(path);
      size = info.size;
    } catch {
      /* ignore */
    }
    try {
      await rm(path, { recursive: true, force: true });
      removed += 1;
      if (typeof size === 'number') freed += size;
      records.push({ ts: new Date().toISOString(), action: 'trash-empty', path, size, ok: true });
    } catch (error) {
      records.push({
        ts: new Date().toISOString(),
        action: 'trash-empty',
        path,
        size,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await appendAudit(records);
  return { ok: true, message: `已永久删除 ${removed} 项`, removed, freed };
}
