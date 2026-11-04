/**
 * Cleanup rules: what is reclaimable, how safe it is, and what may happen to
 * it. Built-in table plus an optional user override file.
 *
 * The rule file is JSON on purpose: the plugin ships with zero third-party
 * dependencies, so there is no YAML parser available in the Host process.
 * Schema:
 *
 *   {
 *     "rules": [{ "id", "category", "kind": "prefix|children|ext",
 *                 "path", "dirs", "exts", "safety", "action",
 *                 "minAgeDays", "note" }],
 *     "ignore": ["~/Library/Caches/Foo"],
 *     "neverDelete": ["~/Development/keep-me"]
 *   }
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, posix } from 'node:path';
import { homedir } from 'node:os';
import { expandHome, isInside, protectedPaths } from './path-safety.js';
import { dataDir } from './platform.js';

/** Rank allows "worst safety wins" when several rules match. */
export const SAFETY_RANK = Object.freeze({ safe: 1, probably: 2, risky: 3, irreversible: 4 });

/** Human labels used by the panel legend. */
export const SAFETY_LABEL = Object.freeze({
  safe: '安全',
  probably: '谨慎',
  risky: '只报告',
  irreversible: '不可逆',
});

/** @typedef {'safe'|'probably'|'risky'|'irreversible'} Safety */
/** @typedef {'trash'|'report'|'trash-empty'} RuleAction */

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} category
 * @property {'prefix'|'children'|'ext'} kind
 * @property {string} [path]
 * @property {string[]} [dirs]
 * @property {string[]} [exts]
 * @property {Safety} safety
 * @property {RuleAction} action
 * @property {number} [minAgeDays]
 * @property {string} [note]
 */

/** @type {ReadonlyArray<Rule>} */
export const BUILTIN_RULES = Object.freeze([
  { id: 'app-caches', category: '应用缓存', kind: 'children', path: '~/Library/Caches', safety: 'safe', action: 'trash', note: '跳过 ignore 与 24 小时内活跃项' },
  { id: 'logs', category: '日志', kind: 'prefix', path: '~/Library/Logs', safety: 'safe', action: 'trash' },
  { id: 'crash-reports', category: '崩溃报告', kind: 'prefix', path: '~/Library/Logs/DiagnosticReports', safety: 'safe', action: 'trash' },
  { id: 'trash', category: '废纸篓', kind: 'prefix', path: '~/.Trash', safety: 'irreversible', action: 'trash-empty', note: '清空后不可恢复' },
  { id: 'xcode-derived', category: 'Xcode 派生数据', kind: 'prefix', path: '~/Library/Developer/Xcode/DerivedData', safety: 'safe', action: 'trash' },
  { id: 'xcode-device-support', category: 'iOS DeviceSupport', kind: 'prefix', path: '~/Library/Developer/Xcode/iOS DeviceSupport', safety: 'probably', action: 'trash', note: '下次连接设备会重建' },
  { id: 'simulator-caches', category: '模拟器缓存', kind: 'prefix', path: '~/Library/Developer/CoreSimulator/Caches', safety: 'probably', action: 'report' },
  { id: 'npm-cache', category: 'npm 缓存', kind: 'prefix', path: '~/.npm/_cacache', safety: 'safe', action: 'trash' },
  { id: 'pnpm-store', category: 'pnpm store', kind: 'prefix', path: '~/Library/pnpm/store', safety: 'safe', action: 'trash' },
  { id: 'homebrew-cache', category: 'Homebrew 缓存', kind: 'prefix', path: '~/Library/Caches/Homebrew', safety: 'safe', action: 'trash' },
  { id: 'pip-cache', category: 'pip 缓存', kind: 'prefix', path: '~/Library/Caches/pip', safety: 'safe', action: 'trash' },
  { id: 'yarn-cache', category: 'Yarn 缓存', kind: 'prefix', path: '~/Library/Caches/Yarn', safety: 'safe', action: 'trash' },
  { id: 'go-build-cache', category: 'Go 构建缓存', kind: 'prefix', path: '~/Library/Caches/go-build', safety: 'safe', action: 'trash' },
  { id: 'gradle-cache', category: 'Gradle 缓存', kind: 'prefix', path: '~/.gradle/caches', safety: 'probably', action: 'trash', note: '删除后需重新下载依赖' },
  { id: 'maven-repo', category: 'Maven 仓库', kind: 'prefix', path: '~/.m2/repository', safety: 'probably', action: 'trash', note: '删除后需重新下载依赖' },
  { id: 'cocoapods-cache', category: 'CocoaPods 缓存', kind: 'prefix', path: '~/Library/Caches/CocoaPods', safety: 'probably', action: 'trash' },
  { id: 'ios-backup', category: 'iOS 备份', kind: 'prefix', path: '~/Library/Application Support/MobileSync/Backup', safety: 'risky', action: 'report', note: '含设备数据，只报告' },
  { id: 'installers', category: '安装包', kind: 'ext', dirs: ['~/Downloads', '~/Desktop'], exts: ['.dmg', '.pkg', '.mpkg', '.iso', '.xip'], safety: 'probably', action: 'trash', minAgeDays: 30, note: '30 天以上' },
  { id: 'simulator-devices', category: '模拟器设备', kind: 'prefix', path: '~/Library/Developer/CoreSimulator/Devices', safety: 'risky', action: 'report', note: '删除会丢失模拟器内数据' },
]);

/**
 * @param {unknown} value
 * @returns {value is Rule}
 */
function isRule(value) {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  if (typeof candidate.id !== 'string' || candidate.id === '') return false;
  if (typeof candidate.category !== 'string' || candidate.category === '') return false;
  if (candidate.kind !== 'prefix' && candidate.kind !== 'children' && candidate.kind !== 'ext') return false;
  if (typeof candidate.safety !== 'string' || !(candidate.safety in SAFETY_RANK)) return false;
  if (candidate.action !== 'trash' && candidate.action !== 'report' && candidate.action !== 'trash-empty') return false;
  if (candidate.kind === 'ext') {
    return Array.isArray(candidate.dirs) && Array.isArray(candidate.exts);
  }
  return typeof candidate.path === 'string' && candidate.path !== '';
}

/**
 * Default user config path.
 * @returns {string}
 */
export function rulesFilePath() {
  return posix.join(dataDir(), 'rules.json');
}

/**
 * Load the user override. Missing file is not an error; a malformed file is
 * reported and ignored as a whole, never partially applied.
 *
 * @returns {Promise<{rules:Rule[], ignore:string[], neverDelete:string[], file:string, warning?:string}>}
 */
export async function loadUserRules() {
  const file = rulesFilePath();
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { rules: [], ignore: [], neverDelete: [], file };
  }
  try {
    const parsed = JSON.parse(raw);
    const rules = Array.isArray(parsed?.rules) ? parsed.rules.filter(isRule) : [];
    const ignore = Array.isArray(parsed?.ignore) ? parsed.ignore.filter((entry) => typeof entry === 'string') : [];
    const neverDelete = Array.isArray(parsed?.neverDelete)
      ? parsed.neverDelete.filter((entry) => typeof entry === 'string')
      : [];
    return { rules, ignore, neverDelete, file };
  } catch (error) {
    return {
      rules: [],
      ignore: [],
      neverDelete: [],
      file,
      warning: `rules.json 解析失败，已忽略用户规则：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Built-in rules plus user rules; a user rule with the same id replaces the
 * built-in one.
 *
 * @param {Awaited<ReturnType<typeof loadUserRules>>} user
 * @returns {{rules:Rule[], ignore:string[], neverDelete:string[], warning?:string}}
 */
export function mergeRules(user) {
  const byId = new Map(BUILTIN_RULES.map((rule) => [rule.id, rule]));
  for (const rule of user.rules) byId.set(rule.id, rule);
  return {
    rules: [...byId.values()],
    ignore: user.ignore.map(expandHome),
    neverDelete: user.neverDelete.map(expandHome),
    warning: user.warning,
  };
}

/** @param {Rule} rule */
export function ruleBasePath(rule) {
  if (rule.kind === 'ext') return undefined;
  return rule.path === undefined ? undefined : expandHome(rule.path);
}

/**
 * Match one absolute path against the rule table. Most specific base wins;
 * on a tie the stricter safety level wins.
 *
 * @param {string} absolutePath
 * @param {Rule[]} rules
 * @param {string[]} ignore
 * @returns {Rule|undefined}
 */
export function matchPath(absolutePath, rules, ignore = []) {
  const target = posix.normalize(absolutePath);
  if (ignore.some((prefix) => isInside(prefix, target))) return undefined;

  let best;
  let bestScore = -1;
  for (const rule of rules) {
    const base = ruleBasePath(rule);
    let matched = false;
    let score = 0;
    if (rule.kind === 'ext') {
      const parent = posix.dirname(target);
      const dir = (rule.dirs ?? []).map(expandHome).find((candidate) => candidate === parent);
      if (dir !== undefined && (rule.exts ?? []).includes(extname(target).toLowerCase())) {
        matched = true;
        score = dir.length;
      }
    } else if (rule.kind === 'children') {
      if (base !== undefined && posix.dirname(target) === base) {
        matched = true;
        score = base.length + 1;
      }
    } else if (base !== undefined && (target === base || isInside(base, target))) {
      matched = true;
      score = base.length;
    }
    if (!matched) continue;
    const rank = SAFETY_RANK[rule.safety];
    if (score > bestScore || (score === bestScore && rank > SAFETY_RANK[best?.safety ?? 'safe'])) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Concrete existing paths a rule currently applies to.
 *
 * @param {Rule} rule
 * @returns {Promise<string[]>}
 */
export async function expandRule(rule) {
  if (rule.kind === 'prefix') {
    const base = ruleBasePath(rule);
    if (base === undefined) return [];
    return (await exists(base)) ? [base] : [];
  }
  if (rule.kind === 'children') {
    const base = ruleBasePath(rule);
    if (base === undefined) return [];
    const entries = await safeReaddir(base);
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => posix.join(base, entry.name));
  }
  const dirs = (rule.dirs ?? []).map(expandHome);
  const exts = (rule.exts ?? []).map((ext) => ext.toLowerCase());
  const found = [];
  for (const dir of dirs) {
    const entries = await safeReaddir(dir);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!exts.includes(extname(entry.name).toLowerCase())) continue;
      found.push(posix.join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Filter candidate paths to those allowed to be deleted: not protected, not
 * ignored, not explicitly kept.
 *
 * @param {string} path
 * @param {{neverDelete?:string[]}} [options]
 * @returns {boolean}
 */
export function isDeletable(path, options = {}) {
  const target = posix.normalize(path);
  const roots = options.roots ?? [homedir()];
  if (!roots.some((root) => isInside(root, target))) return false;
  if (roots.some((root) => posix.normalize(root) === target)) return false;
  if ((options.protected ?? protectedPaths()).some((prefix) => isInside(prefix, target))) return false;
  if ((options.neverDelete ?? []).some((prefix) => isInside(prefix, target))) return false;
  return true;
}

/** @param {string} path */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
 * Age in days from mtime, or Infinity when unknown.
 * @param {string} path
 */
export async function ageDays(path) {
  try {
    const info = await stat(path);
    return (Date.now() - info.mtimeMs) / 86_400_000;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

