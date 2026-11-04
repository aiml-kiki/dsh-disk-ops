/**
 * Small JSON cache in $DSH_HOME/disk-ops/cache. Writes are atomic (tmp+rename)
 * so a killed scan never leaves a truncated file behind.
 */

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheDir, ensureDataDirs } from './platform.js';

/** Default freshness window. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {...string} parts
 * @returns {string}
 */
export function cacheKey(...parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}

/**
 * Read a cache entry regardless of age. The panel renders it immediately and
 * refreshes in the background, so a stale entry is still useful.
 *
 * @param {string} key
 * @returns {Promise<{record:any, age:number}|null>}
 */
export async function readCacheRecord(key) {
  try {
    const raw = await readFile(join(cacheDir(), `${key}.json`), 'utf8');
    const record = JSON.parse(raw);
    if (typeof record?.generated_at !== 'string') return null;
    const age = Date.now() - Date.parse(record.generated_at);
    return { record, age };
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {number} [ttlMs]
 * @returns {Promise<any|null>}
 */
export async function readCache(key, ttlMs = CACHE_TTL_MS) {
  const hit = await readCacheRecord(key);
  if (hit === null) return null;
  if (hit.age > ttlMs) return null;
  return hit.record;
}

/**
 * @param {string} key
 * @param {object} value
 * @returns {Promise<void>}
 */
export async function writeCache(key, value) {
  await ensureDataDirs();
  const target = join(cacheDir(), `${key}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  await rename(temporary, target);
}
