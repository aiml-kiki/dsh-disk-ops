/**
 * macOS platform adapter: DSH paths, disk capacity, trash, Spotlight.
 * Everything shell-related lives here so another platform stays a copy of
 * this file rather than a rewrite of the scanner.
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/** @returns {string} */
export function homeDir() {
  return homedir();
}

/**
 * DSH home. The harness sets DSH_HOME; fall back to ~/.dsh for a bare CLI.
 * @returns {string}
 */
export function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return configured;
  return join(homeDir(), '.dsh');
}

/** @returns {string} */
/**
 * Directories macOS guards behind per-app privacy consent (TCC). Measuring
 * inside them pops a system modal, so the UI reports their size but refuses to
 * drill in — no Full Disk Access is ever requested.
 *
 * @param {string} target
 * @returns {boolean}
 */
export function isPrivatePath(target) {
  const home = homeDir();
  const guarded = [
    join(home, 'Library', 'Containers'),
    join(home, 'Library', 'Group Containers'),
    join(home, 'Library', 'Application Support', 'com.apple.TCC'),
    join(home, 'Library', 'Mail'),
    join(home, 'Library', 'Safari'),
  ];
  return guarded.some((root) => target === root || target.startsWith(root + '/'));
}

export function dataDir() {
  return join(dshHome(), 'disk-ops');
}

/** @returns {string} */
export function cacheDir() {
  return join(dataDir(), 'cache');
}

/** @returns {Promise<void>} */
export async function ensureDataDirs() {
  await mkdir(cacheDir(), { recursive: true });
}

/**
 * Capacity of the Data volume, matching Finder's "available" figure closely
 * enough for the panel header.
 *
 * @returns {Promise<{total:number, used:number, free:number, percent:number, source:string}>}
 */
export async function diskSummary() {
  const target = '/System/Volumes/Data';
  try {
    const { stdout } = await execFileAsync('df', ['-k', target], { timeout: 5000, maxBuffer: 64 * 1024 });
    const line = stdout.trim().split('\n').filter((row) => row.trim() !== '').at(-1) ?? '';
    const columns = line.trim().split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity ...
    const total = Number(columns[1]) * 1024;
    const used = Number(columns[2]) * 1024;
    const free = Number(columns[3]) * 1024;
    if (![total, used, free].every((value) => Number.isFinite(value))) throw new Error('df output unparsable');
    return {
      total,
      used,
      free,
      percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
      source: target,
    };
  } catch (error) {
    return { total: 0, used: 0, free: 0, percent: 0, source: `unavailable: ${messageOf(error)}` };
  }
}

/**
 * Read the size of a directory in bytes using `du` (allocated blocks).
 * Returns null when the budget expires.
 *
 * @param {string} path
 * @param {number} budgetMs
 * @returns {Promise<{size:number|null, status:'complete'|'partial'}>}
 */
export async function directorySize(path, budgetMs = 8000) {
  const result = await runWithBudget('du', ['-sk', '-x', path], budgetMs);
  if (result.timedOut) return { size: null, status: 'partial' };
  const first = result.stdout.trim().split('\n')[0] ?? '';
  const match = /^(\d+)\s/.exec(first);
  if (match === null) return { size: null, status: 'partial' };
  return { size: Number(match[1]) * 1024, status: 'complete' };
}

/**
 * Stream `du -d 1` for one level. Lines that finished before the budget are
 * kept, so a slow directory still renders partially instead of blank.
 *
 * @param {string} path
 * @param {number} budgetMs
 * @returns {Promise<{entries:Array<{path:string,size:number}>, total:number|null, status:'complete'|'partial'}>}
 */
export async function levelSizes(path, budgetMs = 8000) {
  const result = await runWithBudget('du', ['-d', '1', '-k', '-x', path], budgetMs);
  const entries = [];
  let total = null;
  for (const line of result.stdout.split('\n')) {
    const match = /^(\d+)\t(.+)$/.exec(line);
    if (match === null) continue;
    const size = Number(match[1]) * 1024;
    const rowPath = match[2];
    if (rowPath === path) total = size;
    else entries.push({ path: rowPath, size });
  }
  return { entries, total, status: result.timedOut ? 'partial' : 'complete' };
}

/**
 * Largest files under a root, via Spotlight. `mdfind` is metadata-only and
 * orders of magnitude faster than walking the tree for a Top-N list.
 *
 * @param {string} root
 * @param {number} minBytes
 * @param {{limit?:number, budgetMs?:number}} [options]
 * @returns {Promise<Array<{path:string,size:number}>>}
 */
export async function largeFiles(root, minBytes, options = {}) {
  const limit = options.limit ?? 50;
  const query = `kMDItemFSSize >= ${Math.max(0, Math.floor(minBytes))}`;
  const result = await runWithBudget('mdfind', ['-onlyin', root, query], options.budgetMs ?? 5000);
  const paths = result.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const sized = await Promise.all(
    paths.slice(0, limit * 4).map(async (path) => {
      try {
        const { stat } = await import('node:fs/promises');
        const info = await stat(path);
        if (!info.isFile()) return null;
        return { path, size: info.size };
      } catch {
        return null;
      }
    }),
  );
  return sized
    .filter((entry) => entry !== null && entry.size >= minBytes)
    .sort((a, b) => b.size - a.size)
    .slice(0, limit);
}

/**
 * Move paths to the Trash with Finder (keeps "Put Back"), falling back to
 * `mv ~/.Trash` when Automation permission is unavailable.
 *
 * @param {string[]} paths
 * @returns {Promise<Array<{path:string, ok:boolean, method:'finder'|'mv'|'none', message?:string}>>}
 */
export async function moveToTrash(paths) {
  const results = [];
  const script = [
    'set out to {}',
    'repeat with p in argv',
    '  try',
    '    tell application "Finder" to delete (POSIX file p as alias)',
    '    set end of out to "ok"',
    '  on error errMsg number errNum',
    '    set end of out to "err:" & errNum & ":" & errMsg',
    '  end try',
    'end repeat',
    'return out',
  ].join('\n');
  const args = ['-e', script].concat(paths);
  const finder = await runWithBudget('osascript', args, 20000);
  const lines = finder.timedOut ? [] : finder.stdout.split(', ').map((line) => line.trim());

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    const line = lines[index] ?? '';
    if (line === 'ok') {
      results.push({ path, ok: true, method: 'finder' });
      continue;
    }
    const fallback = await moveToTrashByRename(path);
    results.push({
      path,
      ok: fallback.ok,
      method: fallback.ok ? 'mv' : 'none',
      message: fallback.ok ? undefined : fallback.message ?? line,
    });
  }
  return results;
}

/**
 * @param {string} path
 * @returns {Promise<{ok:boolean, message?:string}>}
 */
async function moveToTrashByRename(path) {
  try {
    const { rename, mkdir, access } = await import('node:fs/promises');
    const { basename, join } = await import('node:path');
    const trash = join(homeDir(), '.Trash');
    await mkdir(trash, { recursive: true });
    const name = basename(path);
    let target = join(trash, name);
    let suffix = 1;
    for (;;) {
      try {
        await access(target);
        suffix += 1;
        target = join(trash, `${name} ${suffix}`);
      } catch {
        break;
      }
    }
    await rename(path, target);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * Reveal a path in Finder (`open -R`); the panel's "显示" action.
 *
 * @param {string} path
 * @returns {Promise<{ok:boolean, message?:string}>}
 */
export async function revealInFinder(path) {
  const result = await runWithBudget('open', ['-R', path], 4000);
  if (result.timedOut) return { ok: false, message: 'open timed out' };
  if (result.code !== 0) return { ok: false, message: (result.stderr || '').trim() || 'open failed' };
  return { ok: true };
}

/**
 * Spawn a command with a hard budget. Never throws: failures come back as
 * `code`/`message` so a scan can degrade instead of aborting.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {number} budgetMs
 * @returns {Promise<{stdout:string, stderr:string, timedOut:boolean, code:number|null, message?:string}>}
 */
export function runWithBudget(command, args, budgetMs) {
  return new Promise((resolve) => {
    const child = spawnProcess(command, args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, Math.max(1000, budgetMs));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut: false, code: null, message: messageOf(error) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const timedOut = child.killed || code === null;
      resolve({ stdout, stderr, timedOut, code });
    });
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function spawnProcess(command, args) {
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
