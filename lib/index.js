/**
 * dsh-disk-ops — Host half.
 *
 * Registers:
 *   - the `/disk` command (scan / big / status / rules / clean / trash-empty),
 *   - the `disk_scan` and `disk_clean` agent tools,
 *   - the read-only `/disk-ops/*` JSON routes used by the panel,
 *   - one system-prompt line telling the model that deletion needs a plan and
 *     an explicit user confirmation.
 *
 * The panel is the primary surface; commands and tools are secondary.
 *
 * @module dsh-disk-ops
 */

import { posix } from 'node:path';
import { homedir } from 'node:os';
import { dataDir, diskSummary, ensureDataDirs, revealInFinder } from './core/platform.js';
import {
  computeSuggestions,
  describePath,
  findBigFiles,
  scanLevel,
  scanOverview,
} from './core/scan.js';
import {
  BUILTIN_RULES,
  SAFETY_LABEL,
  loadUserRules,
  mergeRules,
  rulesFilePath,
} from './core/rules.js';
import { PLAN_TTL_MS, createPlan, verifyPlan } from './core/plan.js';
import { emptyTrash, executePlan } from './core/trash.js';
import { formatBytes, parseSize } from './core/format.js';
import { expandHome, isInside } from './core/path-safety.js';
import { readAudit } from './core/audit.js';

export const name = 'disk-ops';
export const inject = ['tools', 'commands', 'systemPrompt', 'webServer', 'connection'];

/** Body cap for plan/clean routes. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  /** @type {Map<string, any>} */
  const plans = new Map();
  const started = Date.now();

  const prune = () => {
    const now = Date.now();
    for (const [id, plan] of plans) {
      if (Date.parse(plan.expires_at) < now) plans.delete(id);
    }
  };

  const registerPlan = (plan) => {
    prune();
    plans.set(plan.plan_id, plan);
    return plan;
  };

  ensureDataDirs().catch((error) => {
    ctx.logger?.warn?.(`disk-ops: cannot create data dir: ${messageOf(error)}`);
  });

  // ── system prompt ────────────────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.systemPrompt.context({
        name: 'disk-ops',
        order: 60,
        interpolate: false,
        text: () =>
          '本机磁盘插件已加载：需要查看磁盘占用或清理建议时先调用 `disk_scan`（只读）。' +
          '任何删除都必须先出计划、再由用户确认；`disk_clean` 的 commit 不能替用户做决定。',
      }),
    'disk-ops: system prompt',
  );

  // ── commands ─────────────────────────────────────────────────────────────
  ctx.effect(() => {
    const disposer = ctx.commands.register({
      definitionId: 'dsh-disk-ops/command',
      name: 'disk',
      description: '磁盘空间：扫描、下钻、大文件、清理计划与废纸篓',
      input: {
        hint: '[scan [path] | big | status | rules | clean [--confirm <token>] | trash-empty --confirm <count>]',
        attachments: false,
      },
      handler: (invocation) => runDiskCommand(ctx, invocation, plans, registerPlan),
    });
    return () => {
      try {
        disposer?.();
      } catch {
        /* disposal is best-effort */
      }
    };
  }, 'disk-ops: commands');

  // ── tools ────────────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'disk_scan',
    description:
      'Read-only disk inspection on this Mac: capacity, one level of a directory (allocated sizes), cleanup suggestions grouped by category/safety, and largest files. Use it before suggesting any cleanup. Paths outside the home directory are refused.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Absolute directory (or ~/...). Defaults to the home directory.' },
        refresh: { type: 'boolean', description: 'Ignore the 24h cache and rescan.' },
        suggestions: { type: 'boolean', description: 'Include the cleanup suggestion list (default true).' },
        big_files: { type: 'boolean', description: 'Include the large-file Top 50 (default false; use /disk big).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'text'],
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          path: { type: 'string' },
          scan_status: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const path = resolveScanPath(args.path);
      const level = path === homedir() ? await scanOverview({ refresh: args.refresh === true }) : await scanLevel(path, { refresh: args.refresh === true });
      const lines = [renderHeader(level), '', renderEntries(level.entries), ''];
      if (path === homedir() && args.suggestions !== false) {
        const suggestions = await computeSuggestions({ refresh: args.refresh === true });
        lines.push(renderSuggestions(suggestions, 8), '');
      }
      if (args.big_files === true) {
        const big = await findBigFiles({});
        lines.push(renderBigFiles(big.files, 10), '');
      }
      if (exec?.signal?.aborted === true) return { ok: false, text: '已取消。' };
      return { ok: true, text: lines.join('\n'), path: level.path, scan_status: level.scan_status };
    },
  });

  ctx.tools.register({
    name: 'disk_clean',
    description:
      'Two-phase cleanup. action=plan builds an immutable plan (items, sizes, expiry, confirmation token) from the cleanup suggestions or explicit paths — nothing is deleted. action=commit moves the confirmed plan to the Trash; it always asks the user through the question UI and refuses without an explicit confirmation. Permanent deletion is never available here.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['plan', 'commit'] },
        paths: { type: 'array', items: { type: 'string' }, description: 'plan: explicit paths; defaults to the suggestion list.' },
        plan_id: { type: 'string', description: 'commit: plan id returned by plan.' },
        token: { type: 'string', description: 'commit: confirmation token returned by plan.' },
        ids: { type: 'array', items: { type: 'number' }, description: 'commit: subset of item ids.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'text'],
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          plan_id: { type: 'string' },
          token: { type: 'string' },
          total: { type: 'number' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      if (args.action === 'plan') return planTool(ctx, args, registerPlan);
      return commitTool(ctx, args, plans, exec);
    },
  });

  // ── routes ───────────────────────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/disk-ops',
        handler: (req, res) => handleRoute(ctx, req, res, plans, registerPlan),
      }),
    'disk-ops: panel routes',
  );

  // Keep only recent audit entries handy for /disk status.
  void readAudit(1);

  // Prune expired plans when the plugin unloads and periodically.
  const timer = setInterval(prune, 60_000);
  timer.unref?.();
  ctx.effect(() => () => clearInterval(timer), 'disk-ops: plan pruning');

  ctx.logger?.info?.(`disk-ops: ready in ${dataDir()} (${Date.now() - started}ms)`);
}

// ── command ────────────────────────────────────────────────────────────────

/**
 * @param {any} ctx
 * @param {{rawInput?:string, agent?:any}} invocation
 * @param {Map<string, any>} plans
 * @param {(plan:any)=>any} registerPlan
 */
async function runDiskCommand(ctx, invocation, plans, registerPlan) {
  const words = String(invocation.rawInput ?? '').trim().split(/\s+/).filter(Boolean);
  const sub = words[0] ?? 'scan';
  const rest = words.slice(1);
  const flags = new Set(rest.filter((word) => word.startsWith('--')));
  const positional = rest.filter((word) => !word.startsWith('--'));

  try {
    if (sub === 'scan') {
      const path = resolveScanPath(positional[0]);
      const level = path === homedir() ? await scanOverview({ refresh: flags.has('--refresh') }) : await scanLevel(path, { refresh: flags.has('--refresh') });
      const suggestions = path === homedir() ? await computeSuggestions({ refresh: flags.has('--refresh') }) : undefined;
      const text = [
        renderHeader(level),
        '',
        renderEntries(level.entries),
        suggestions === undefined ? '' : '',
        suggestions === undefined ? '' : renderSuggestions(suggestions, 10),
      ]
        .filter((line) => line !== '')
        .join('\n');
      return { kind: 'success', text };
    }

    if (sub === 'big') {
      const minIndex = rest.indexOf('--min');
      const minBytes = minIndex >= 0 && rest[minIndex + 1] !== undefined ? parseSize(rest[minIndex + 1]) : undefined;
      const big = await findBigFiles({ minBytes });
      return { kind: 'success', text: renderBigFiles(big.files, 20) };
    }

    if (sub === 'status') {
      const disk = await diskSummary();
      const user = await loadUserRules();
      const audit = await readAudit(5);
      const lines = [
        `磁盘：${formatBytes(disk.total)} 容量 · 已用 ${formatBytes(disk.used)} · 可用 ${formatBytes(disk.free)}（${disk.percent}%）`,
        `数据目录：${dataDir()}`,
        `规则文件：${rulesFilePath()}${user.warning === undefined ? '' : '（解析失败）'}`,
        `最近审计：${audit.length} 条`,
      ];
      return { kind: 'success', text: lines.join('\n') };
    }

    if (sub === 'rules') {
      const user = await loadUserRules();
      const merged = mergeRules(user);
      const lines = merged.rules.map((rule) => {
        const where = rule.kind === 'ext' ? (rule.dirs ?? []).join(', ') : rule.path;
        return `${SAFETY_LABEL[rule.safety]}\t${rule.action}\t${rule.category}\t${where}`;
      });
      if (merged.warning !== undefined) lines.unshift(`⚠ ${merged.warning}`);
      lines.push('', `规则文件：${rulesFilePath()}`);
      return { kind: 'success', text: lines.join('\n') };
    }

    if (sub === 'clean') {
      return runCleanCommand(rest, plans, registerPlan);
    }

    if (sub === 'trash-empty') {
      const confirmIndex = rest.indexOf('--confirm');
      const count = confirmIndex >= 0 ? Number(rest[confirmIndex + 1]) : Number.NaN;
      const result = await emptyTrash({ confirmCount: count });
      return { kind: result.ok ? 'success' : 'error', text: result.message };
    }

    return {
      kind: 'error',
      text: '用法：/disk scan [path] | big | status | rules | clean [--confirm <token>] | trash-empty --confirm <count>',
    };
  } catch (error) {
    return { kind: 'error', text: `磁盘命令失败：${messageOf(error)}` };
  }
}

/**
 * @param {string[]} rest
 * @param {Map<string, any>} plans
 * @param {(plan:any)=>any} registerPlan
 */
async function runCleanCommand(rest, plans, registerPlan) {
  const confirmIndex = rest.indexOf('--confirm');
  const token = confirmIndex >= 0 ? rest[confirmIndex + 1] : undefined;
  if (token !== undefined) {
    const plan = [...plans.values()].find((candidate) => candidate.token === token);
    if (plan === undefined) return { kind: 'error', text: '没有匹配的清理计划，请先运行 /disk clean 生成计划。' };
    const valid = verifyPlan(plan, token);
    if (!valid.ok) return { kind: 'error', text: valid.reason };
    const result = await executePlan(plan, {});
    plans.delete(plan.plan_id);
    return { kind: 'success', text: renderExecution(result) };
  }

  const suggestions = await computeSuggestions({});
  const candidates = suggestions.suggestions
    .filter((suggestion) => suggestion.action === 'trash' && suggestion.deletable && (suggestion.size ?? 0) > 0)
    .map((suggestion) => ({ path: suggestion.path, size: suggestion.size }));
  if (candidates.length === 0) return { kind: 'success', text: '没有可清理项。' };
  const plan = registerPlan(await createPlan(candidates));
  return { kind: 'success', text: renderPlan(plan) };
}

// ── tools ──────────────────────────────────────────────────────────────────

/**
 * @param {any} ctx
 * @param {{paths?:string[]}} args
 * @param {(plan:any)=>any} registerPlan
 */
async function planTool(ctx, args, registerPlan) {
  let candidates;
  if (Array.isArray(args.paths) && args.paths.length > 0) {
    candidates = args.paths.map((path) => ({ path: resolveScanPath(path) }));
  } else {
    const suggestions = await computeSuggestions({});
    candidates = suggestions.suggestions
      .filter((suggestion) => suggestion.action === 'trash' && suggestion.deletable && (suggestion.size ?? 0) > 0)
      .map((suggestion) => ({ path: suggestion.path, size: suggestion.size }));
  }
  if (candidates.length === 0) return { ok: true, text: '没有可清理项。' };
  const plan = registerPlan(await createPlan(candidates));
  return {
    ok: true,
    text: renderPlan(plan),
    plan_id: plan.plan_id,
    token: plan.token,
    total: plan.total,
  };
}

/**
 * @param {any} ctx
 * @param {{plan_id?:string, token?:string, ids?:number[]}} args
 * @param {Map<string, any>} plans
 * @param {{agent?:any}} exec
 */
async function commitTool(ctx, args, plans, exec) {
  const plan = args.plan_id === undefined ? undefined : plans.get(args.plan_id);
  if (plan === undefined) return { ok: false, text: '找不到该计划，请重新生成。' };
  const valid = verifyPlan(plan, String(args.token ?? ''));
  if (!valid.ok) return { ok: false, text: valid.reason };

  const question = ctx.get?.('userQuestions');
  if (question === undefined || typeof question.ask !== 'function' || exec?.agent === undefined) {
    return { ok: false, text: '没有可用的用户确认通道，拒绝执行。' };
  }
  let answer;
  try {
    answer = await question.ask({
      agent: exec.agent,
      questions: [
        {
          id: 'disk-clean',
          header: '确认移入废纸篓',
          question: `将把 ${plan.items.length} 项（${formatBytes(plan.total)}）移到废纸篓。确认执行？`,
          options: [
            { label: '确认', description: '移入废纸篓，可在 Finder 中放回' },
            { label: '取消', description: '不执行任何删除' },
          ],
        },
      ],
    });
  } catch {
    return { ok: false, text: '用户确认超时或失败，未删除。' };
  }
  const selected = answer?.answers?.[0]?.selected?.[0];
  if (selected !== '确认') return { ok: false, text: '用户未确认，未删除。' };

  const result = await executePlan(plan, { ids: args.ids });
  plans.delete(plan.plan_id);
  return { ok: true, text: renderExecution(result) };
}

// ── routes ─────────────────────────────────────────────────────────────────

/**
 * @param {any} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Map<string, any>} plans
 * @param {(plan:any)=>any} registerPlan
 */
async function handleRoute(ctx, req, res, plans, registerPlan) {
  try {
    const rejection = ctx.connection?.requestRejection?.(req);
    if (rejection !== undefined) return sendJson(res, 403, { ok: false, error: 'forbidden' });

    const url = new URL(req.url ?? '/', 'http://dsh.internal');
    const route = url.pathname.slice('/disk-ops'.length).replace(/^\/+/, '');

    if (req.method === 'GET' && route === 'report') {
      const path = resolveScanPath(url.searchParams.get('path') ?? undefined);
      const refresh = url.searchParams.get('refresh') === '1';
      const disk = await diskSummary();
      const level = path === homedir() ? await scanOverview({ refresh }) : await scanLevel(path, { refresh });
      return sendJson(res, 200, {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        disk,
        path: level.path,
        parent: level.parent ?? (path === homedir() ? null : posix.dirname(path)),
        entries: level.entries,
        total: level.total,
        scan_status: level.scan_status,
        note: level.note ?? null,
        cached: level.cached === true,
        stale: level.stale === true,
      });
    }

    if (req.method === 'GET' && route === 'suggestions') {
      const refresh = url.searchParams.get('refresh') === '1';
      const result = await computeSuggestions({ refresh });
      return sendJson(res, 200, { schema_version: 1, ...result });
    }

    if (req.method === 'GET' && route === 'big') {
      const min = url.searchParams.get('min');
      const scope = url.searchParams.get('path');
      const root = scope === null ? undefined : resolveScanPath(scope);
      const result = await findBigFiles({
        minBytes: min === null ? undefined : parseSize(min),
        root,
        budgetMs: 4000,
      });
      return sendJson(res, 200, { schema_version: 1, ...result });
    }

    if (req.method === 'GET' && route === 'status') {
      const disk = await diskSummary();
      return sendJson(res, 200, { schema_version: 1, generated_at: new Date().toISOString(), disk, data_dir: dataDir() });
    }

    if (req.method === 'POST' && route === 'plan') {
      const body = await readJsonBody(req);
      let candidates;
      if (Array.isArray(body.items) && body.items.length > 0) {
        candidates = body.items.map((item) => ({
          path: resolveScanPath(item.path),
          size: typeof item.size === 'number' ? item.size : undefined,
        }));
      } else if (Array.isArray(body.paths) && body.paths.length > 0) {
        candidates = body.paths.map((path) => ({ path: resolveScanPath(path) }));
      } else {
        candidates = (await computeSuggestions({})).suggestions
          .filter((suggestion) => suggestion.action === 'trash' && suggestion.deletable && (suggestion.size ?? 0) > 0)
          .map((suggestion) => ({ path: suggestion.path, size: suggestion.size }));
      }
      const plan = registerPlan(await createPlan(candidates, { manual: body.manual === true }));
      return sendJson(res, 200, { ok: true, plan });
    }

    if (req.method === 'POST' && route === 'reveal') {
      const body = await readJsonBody(req);
      const path = resolveScanPath(body.path);
      const result = await revealInFinder(path);
      return sendJson(res, result.ok ? 200 : 500, { ok: result.ok, error: result.message });
    }

    if (req.method === 'POST' && route === 'clean') {
      const body = await readJsonBody(req);
      const plan = plans.get(String(body.plan_id ?? ''));
      if (plan === undefined) return sendJson(res, 200, { ok: false, error: 'plan-not-found' });
      const valid = verifyPlan(plan, String(body.token ?? ''));
      if (!valid.ok) return sendJson(res, 200, { ok: false, error: valid.reason });
      const result = await executePlan(plan, { ids: Array.isArray(body.ids) ? body.ids : undefined });
      plans.delete(plan.plan_id);
      return sendJson(res, 200, { ok: true, result });
    }

    return sendJson(res, 404, { ok: false, error: 'not-found' });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: messageOf(error) });
  }
}

// ── rendering ──────────────────────────────────────────────────────────────

function renderHeader(level) {
  const status = level.scan_status === 'complete' ? '' : `（部分结果${level.cached === true ? '，缓存' : ''}）`;
  return `${level.path} · ${formatBytes(level.total)}${status}`;
}

function renderEntries(entries) {
  const rows = entries.slice(0, 30).map((entry) => {
    const size = entry.size === null ? '—' : formatBytes(entry.size);
    const mark = entry.status === 'complete' ? '' : ' ·部分';
    return `${entry.is_dir ? '▸' : '·'} ${size.padStart(10)}  ${entry.name}${mark}`;
  });
  return rows.length === 0 ? '（无子项或无法读取）' : rows.join('\n');
}

function renderSuggestions(result, limit) {
  if (result.suggestions.length === 0) return '没有命中清理规则的可回收项。';
  const rows = result.suggestions.slice(0, limit).map((suggestion) => {
    const size = suggestion.size === null ? '—' : formatBytes(suggestion.size);
    const mark = suggestion.action === 'trash' ? '可清' : suggestion.action === 'trash-empty' ? '清空' : '只报告';
    return `${SAFETY_LABEL[suggestion.safety]} · ${mark.padEnd(3)} ${size.padStart(10)}  ${suggestion.category} · ${suggestion.path}`;
  });
  return [
    `可回收约 ${formatBytes(result.reclaimable)}${result.scan_status === 'complete' ? '' : '（部分）'}`,
    ...rows,
  ].join('\n');
}

function renderBigFiles(files, limit) {
  if (files.length === 0) return '没有找到超过阈值的大文件（或 Spotlight 不可用）。';
  return files
    .slice(0, limit)
    .map((file) => `${formatBytes(file.size).padStart(10)}  ${file.path}`)
    .join('\n');
}

function renderPlan(plan) {
  const lines = [
    `清理计划 ${plan.plan_id}：${plan.items.length} 项 · ${formatBytes(plan.total)}`,
    `确认串：${plan.token}（${new Date(plan.expires_at).toLocaleTimeString()} 前有效）`,
    '',
    ...plan.items.slice(0, 30).map((item) => `${String(item.id).padStart(3)}  ${formatBytes(item.size).padStart(10)}  ${item.path}`),
  ];
  if (plan.skipped.length > 0) {
    lines.push('', '跳过：', ...plan.skipped.slice(0, 10).map((item) => `  ${item.path} — ${item.reason}`));
  }
  lines.push('', `确认执行：/disk clean --confirm ${plan.token}`);
  return lines.join('\n');
}

function renderExecution(result) {
  const lines = [`已移入废纸篓：${result.trashed.length} 项 · 释放 ${formatBytes(result.total)}`];
  if (result.skipped.length > 0) {
    lines.push('跳过：', ...result.skipped.slice(0, 10).map((item) => `  ${item.path} — ${item.reason}`));
  }
  return lines.join('\n');
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * @param {string|undefined} raw
 * @returns {string}
 */
function resolveScanPath(raw) {
  const home = homedir();
  if (raw === undefined || raw === '') return home;
  const absolute = posix.normalize(expandHome(raw));
  if (!posix.isAbsolute(absolute)) throw new Error(`路径必须是绝对路径或 ~/ 开头：${raw}`);
  if (!isInside(home, absolute)) throw new Error(`只允许扫描家目录内的路径：${raw}`);
  return absolute;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      raw += chunk.toString();
    });
    req.on('end', () => {
      if (raw.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export { BUILTIN_RULES, PLAN_TTL_MS, describePath };
