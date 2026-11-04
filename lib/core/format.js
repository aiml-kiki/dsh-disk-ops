/**
 * Byte formatting and size parsing shared by the Host half, the CLI and tests.
 * No dependencies: the plugin must survive a bare Node runtime.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Human-readable size. Uses 1024-based units and one decimal place.
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/**
 * Parse a human size such as "100MB", "1.5 GB", "900". Bare numbers are bytes.
 * @param {string|number} input
 * @returns {number} bytes
 */
export function parseSize(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  if (typeof input !== 'string') throw new TypeError('size must be a string or number');
  const text = input.trim().toLowerCase();
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*(b|kb|mb|gb|tb|pb)?$/.exec(text);
  if (match === null) throw new TypeError(`cannot parse size: ${input}`);
  const value = Number(match[1]);
  const unit = match[2] ?? 'b';
  const index = UNITS.findIndex((candidate) => candidate.toLowerCase() === unit);
  return Math.floor(value * 1024 ** Math.max(0, index));
}

/**
 * Compact "1.2 GB" without a space, for table cells.
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export function formatBytesCompact(bytes) {
  return formatBytes(bytes).replace(' ', '');
}

/**
 * ISO timestamp used in JSON payloads and the audit log.
 * @returns {string}
 */
export function nowIso() {
  return new Date().toISOString();
}
