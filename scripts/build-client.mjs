/**
 * Assemble lib/client.js from the template, the shared pure functions and the
 * panel source. Deliberately not a bundler: the client half needs `react`
 * only, and the runtime loads the file through `window.__ModuleLoader__`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES } from '../src/client/styles.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(join(root, relative), 'utf8');

/**
 * Strip module syntax so the source can live inside one factory body.
 * @param {string} source
 * @returns {string}
 */
function inline(source) {
  return source
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
}

const template = await read('src/client/template.js');
const panel = await read('src/client/panel.js');
const format = inline(await read('lib/core/format.js'));
const treemap = inline(await read('lib/core/treemap.js'));

const shared = [
  '// ── shared: lib/core/format.js ──────────────────────────────────────────',
  format.trim(),
  '',
  '// ── shared: lib/core/treemap.js ─────────────────────────────────────────',
  treemap.trim(),
  '',
].join('\n');

const output = template
  .replace('/*__SHARED__*/', shared)
  .replace('/*__STYLES__*/', `var STYLES = ${JSON.stringify(STYLES)};`)
  .replace('/*__PANEL__*/', panel.trim());

await writeFile(join(root, 'lib/client.js'), `${output}\n`, 'utf8');
process.stdout.write(`built lib/client.js (${Buffer.byteLength(output)} bytes)\n`);
