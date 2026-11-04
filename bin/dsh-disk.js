#!/usr/bin/env node
/**
 * dsh-disk — the standalone CLI. Shares the exact core with the plugin and the
 * panel, so `dsh-disk scan` and the panel can never disagree about sizes.
 *
 * Usage:
 *   dsh-disk scan [path] [--refresh] [--json]
 *   dsh-disk suggestions [--json]
 *   dsh-disk big [--min 100MB] [--json]
 *   dsh-disk status [--json]
 *   dsh-disk rules [--json]
 *   dsh-disk clean [--json] [--confirm <token>]
 *   dsh-disk trash-empty --confirm <count>
 */

import { homedir } from 'node:os';
import { posix } from 'node:path';
import { computeSuggestions, findBigFiles, scanLevel, scanOverview, summary } from '../lib/core/scan.js';
import { emptyTrash, executePlan } from '../lib/core/trash.js';
import { createPlan, verifyPlan } from '../lib/core/plan.js';
import { formatBytes } from '../lib/core/format.js';
import { dataDir } from '../lib/core/platform.js';
import { SAFETY_LABEL, loadUserRules, mergeRules, rulesFilePath } from '../lib/core/rules.js';
import { expandHome, isInside } from '../lib/core/path-safety.js';

const argv = process.argv.slice(2);
const sub = argv[0] ?? 'scan';
const flags = new Set(argv.filter((word) => word.startsWith('--')));
const flagsWithValue = new Set(['--min', '--confirm', '--top']);
const positional = argv.filter((word, index) => {
  if (index === 0) return false;
  if (word.startsWith('--')) return false;
  const previous = argv[index - 1];
  return !flagsWithValue.has(previous);
});
const json = flags.has('--json');

try {
  if (sub === 'scan') {
    const path = positional[0] === undefined ? homedir() : resolvePath(positional[0]);
    const level = path === homedir() ? await scanOverview({ refresh: flags.has('--refresh') }) : await scanLevel(path, { refresh: flags.has('--refresh') });
    if (json) {
      printJson(level);
    } else {
      console.log(`${level.path} · ${formatBytes(level.total)}${level.scan_status === 'complete' ? '' : '（部分）'}`);
      for (const entry of level.entries.slice(0, 30)) {
        console.log(`${entry.is_dir ? '▸' : '·'} ${formatBytes(entry.size).padStart(10)}  ${entry.name}${entry.status === 'complete' ? '' : ' ·部分'}`);
      }
    }
    process.exit(0);
  }

  if (sub === 'suggestions') {
    const result = await computeSuggestions({ refresh: flags.has('--refresh') });
    if (json) {
      printJson(result);
    } else {
      console.log(`可回收约 ${formatBytes(result.reclaimable)}${result.scan_status === 'complete' ? '' : '（部分）'}`);
      for (const item of result.suggestions) {
        console.log(`${SAFETY_LABEL[item.safety]} · ${item.action} ${formatBytes(item.size).padStart(10)}  ${item.category} · ${item.path}`);
      }
    }
    process.exit(0);
  }

  if (sub === 'big') {
    const min = valueOf('--min');
    const result = await findBigFiles({ minBytes: min === undefined ? undefined : Number(min) });
    if (json) {
      printJson(result);
    } else {
      for (const file of result.files) console.log(`${formatBytes(file.size).padStart(10)}  ${file.path}`);
    }
    process.exit(0);
  }

  if (sub === 'status') {
    const disk = await summary();
    const payload = { disk, data_dir: dataDir(), rules_file: rulesFilePath() };
    if (json) {
      printJson(payload);
    } else {
      console.log(`磁盘：${formatBytes(disk.total)} 容量 · 已用 ${formatBytes(disk.used)} · 可用 ${formatBytes(disk.free)}（${disk.percent}%）`);
      console.log(`数据目录：${payload.data_dir}`);
      console.log(`规则文件：${payload.rules_file}`);
    }
    process.exit(0);
  }

  if (sub === 'rules') {
    const user = await loadUserRules();
    const merged = mergeRules(user);
    if (json) {
      printJson(merged.rules);
    } else {
      if (merged.warning !== undefined) console.log(`⚠ ${merged.warning}`);
      for (const rule of merged.rules) {
        const where = rule.kind === 'ext' ? (rule.dirs ?? []).join(', ') : rule.path;
        console.log(`${SAFETY_LABEL[rule.safety]}  ${rule.action.padEnd(10)} ${rule.category.padEnd(14)} ${where}`);
      }
    }
    process.exit(0);
  }

  if (sub === 'clean') {
    const suggestions = await computeSuggestions({});
    const candidates = suggestions.suggestions
      .filter((item) => item.action === 'trash' && item.deletable && (item.size ?? 0) > 0)
      .map((item) => ({ path: item.path, size: item.size }));
    const plan = await createPlan(candidates);
    const token = valueOf('--confirm');
    if (token === undefined) {
      if (json) {
        printJson(plan);
      } else {
        console.log(`清理计划 ${plan.plan_id}：${plan.items.length} 项 · ${formatBytes(plan.total)}`);
        console.log(`确认串：${plan.token}（10 分钟内有效）`);
        for (const item of plan.items.slice(0, 40)) {
          console.log(`${String(item.id).padStart(3)}  ${formatBytes(item.size).padStart(10)}  ${item.path}`);
        }
        console.log(`\n执行：dsh-disk clean --confirm ${plan.token}`);
      }
      process.exit(0);
    }
    if (!verifyPlan(plan, token).ok) {
      console.error('确认串不匹配或已过期，未执行。');
      process.exit(2);
    }
    const result = await executePlan(plan, {});
    if (json) {
      printJson(result);
    } else {
      console.log(`已移入废纸篓：${result.trashed.length} 项 · 释放 ${formatBytes(result.total)}`);
      for (const item of result.skipped) console.log(`跳过 ${item.path} — ${item.reason}`);
    }
    process.exit(0);
  }

  if (sub === 'trash-empty') {
    const count = Number(valueOf('--confirm'));
    const result = await emptyTrash({ confirmCount: count });
    console.log(result.message);
    process.exit(result.ok ? 0 : 2);
  }

  console.error(`未知子命令：${sub}`);
  process.exit(64);
} catch (error) {
  console.error(`dsh-disk: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

/**
 * @param {string} raw
 * @returns {string}
 */
function resolvePath(raw) {
  const absolute = posix.normalize(expandHome(raw));
  if (!posix.isAbsolute(absolute) || !isInside(homedir(), absolute)) {
    throw new Error(`只允许家目录内的路径：${raw}`);
  }
  return absolute;
}

/**
 * @param {string} name
 * @returns {string|undefined}
 */
function valueOf(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** @param {unknown} value */
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
