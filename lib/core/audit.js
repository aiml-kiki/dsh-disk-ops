/**
 * Append-only audit log in $DSH_HOME/disk-ops/audit.ndjson, rotated at 5 MB
 * with three generations. The log is the recovery source when a "Put Back"
 * is not enough: it records where each item went.
 */

import { appendFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, ensureDataDirs } from './platform.js';

export const MAX_BYTES = 5 * 1024 * 1024;
export const KEEP = 3;

/** @returns {string} */
export function auditFilePath() {
  return join(dataDir(), 'audit.ndjson');
}

/**
 * @param {object[]} records
 * @returns {Promise<void>}
 */
export async function appendAudit(records) {
  if (records.length === 0) return;
  await ensureDataDirs();
  await rotateIfNeeded();
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  await appendFile(auditFilePath(), `${body}\n`, 'utf8');
}

/**
 * Read the newest records, newest last.
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function readAudit(limit = 50) {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = await readFile(auditFilePath(), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { malformed: line };
        }
      });
  } catch {
    return [];
  }
}

/** @returns {Promise<void>} */
async function rotateIfNeeded() {
  const file = auditFilePath();
  try {
    const info = await stat(file);
    if (info.size < MAX_BYTES) return;
  } catch {
    return;
  }
  for (let index = KEEP - 1; index >= 1; index -= 1) {
    try {
      await rename(`${file}.${index}`, `${file}.${index + 1}`);
    } catch {
      /* generation absent */
    }
  }
  await rename(file, `${file}.1`);
}
