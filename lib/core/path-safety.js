/**
 * Path safety: every path that can reach a deletion must pass through here.
 *
 * The Host half runs with the user's own privileges and is NOT bound by the
 * workspace sandbox, so these checks are the only gate between a bug and a
 * deleted home directory.
 */

import { homedir } from 'node:os';
import { posix } from 'node:path';

/**
 * Expand a leading `~` and normalise separators. Never resolves symlinks;
 * callers that delete must call `assertInsideRoot` on the real path too.
 *
 * @param {string} input
 * @returns {string}
 */
export function expandHome(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new TypeError('path must be a non-empty string');
  const trimmed = input.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return posix.join(homedir(), trimmed.slice(2));
  return posix.normalize(trimmed);
}

/**
 * Lexical containment: is `target` inside `root` (or equal to it)?
 *
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isInside(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string') return false;
  const normalizedRoot = posix.normalize(root);
  const normalizedTarget = posix.normalize(target);
  if (normalizedRoot === normalizedTarget) return true;
  return normalizedTarget.startsWith(normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`);
}

/**
 * True when `target` is a strict descendant of `root` (not equal).
 *
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isStrictlyInside(root, target) {
  return isInside(root, target) && posix.normalize(root) !== posix.normalize(target);
}

/**
 * Roots a deletion may touch. Home only; the user's home is the unit of
 * ownership this plugin claims.
 *
 * @returns {string[]}
 */
export function deletionRoots() {
  return [homedir()];
}

/**
 * Paths that are always protected from deletion, even when a rule matches.
 * Rules may mark something risky, but these are never deletable.
 *
 * @returns {string[]}
 */
export function protectedPaths() {
  const home = homedir();
  return [
    posix.join(home, 'Documents'),
    posix.join(home, 'Desktop'),
    posix.join(home, 'Pictures'),
    posix.join(home, 'Music'),
    posix.join(home, 'Movies'),
    posix.join(home, 'Library', 'Application Support'),
    posix.join(home, 'Library', 'Keychains'),
    posix.join(home, 'Library', 'Mail'),
    posix.join(home, 'Library', 'Messages'),
    posix.join(home, 'Library', 'Safari'),
    posix.join(home, '.ssh'),
    posix.join(home, '.aws'),
    posix.join(home, '.gnupg'),
    posix.join(home, '.config'),
  ];
}

/**
 * Assert a path is deletable under the default roots and protection list.
 * Throws a typed error so callers can skip one item instead of aborting.
 *
 * @param {string} target
 * @param {{roots?:string[], protected?:string[]}} [options]
 * @returns {string} normalised absolute path
 */
export function assertDeletable(target, options = {}) {
  const absolute = posix.normalize(target);
  const roots = options.roots ?? deletionRoots();
  const guarded = options.protected ?? protectedPaths();

  if (!posix.isAbsolute(absolute)) throw new SafetyError('not-absolute', target);
  if (posix.normalize(absolute) === posix.parse(absolute).root) throw new SafetyError('filesystem-root', target);

  const root = roots.find((candidate) => isInside(candidate, absolute));
  if (root === undefined) throw new SafetyError('outside-roots', target);
  if (posix.normalize(absolute) === posix.normalize(root)) throw new SafetyError('root-itself', target);

  for (const guardedPath of guarded) {
    if (isInside(guardedPath, absolute)) {
      throw new SafetyError('protected', target, guardedPath);
    }
  }
  return absolute;
}

/**
 * Resolve symlinks as far as the path exists. A symlinked directory that
 * points outside the roots is rejected before anything is touched.
 *
 * @param {string} target
 * @returns {Promise<string>}
 */
export async function realPathOf(target) {
  const { realpath } = await import('node:fs/promises');
  try {
    return await realpath(target);
  } catch {
    return target;
  }
}

/**
 * @param {string} target
 * @param {{roots?:string[], protected?:string[]}} [options]
 * @returns {Promise<string>}
 */
export async function assertDeletableReal(target, options = {}) {
  const real = await realPathOf(target);
  assertDeletable(real, options);
  return real;
}

export class SafetyError extends Error {
  /**
   * @param {string} code
   * @param {string} path
   * @param {string} [detail]
   */
  constructor(code, path, detail) {
    super(`refusing to delete ${path}: ${code}${detail === undefined ? '' : ` (${detail})`}`);
    this.name = 'SafetyError';
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}
