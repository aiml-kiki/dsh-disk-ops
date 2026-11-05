#!/usr/bin/env node
/**
 * Stage and pack the publishable bundle.
 *
 *   node scripts/publish.mjs              # build + test + pack + verify (no upload)
 *   node scripts/publish.mjs --publish    # additionally run `npm publish`
 *   ... --skip-tests                     # skip node --test
 *   ... --tag next                       # dist-tag for npm publish
 *   ... --registry https://registry.npmjs.org
 *   ... --otp 123456                   # npm 2FA one-time password
 *
 * The repository copy of cordis.patch.yml points at dist/<rev>/ for local
 * development (install.mjs). The published package must instead resolve the
 * plugin by package name, so the stage gets cordis.patch.publish.yml as its
 * cordis.patch.yml. Nothing machine-specific may enter the tarball.
 */

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const skipTests = flag('--skip-tests');
const publish = flag('--publish');
const tag = value('--tag');
const registry = value('--registry');
const otp = value('--otp');
const stage = join(root, 'build', 'publish');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    process.stderr.write(`${command} ${args.join(' ')} failed with status ${result.status ?? 'signal'}\n`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function check(condition, message) {
  if (!condition) {
    process.stderr.write(`publish check failed: ${message}\n`);
    process.exit(1);
  }
}

// 1. Build the browser half with the same script local installs use.
run('node', [join(root, 'scripts', 'build-client.mjs')]);

// 2. Tests are part of the release gate.
if (!skipTests) {
  const tests = (await readdir(join(root, 'tests')))
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join('tests', name));
  check(tests.length > 0, 'no tests found');
  run('node', ['--test', ...tests]);
}

// 3. Stage only what `files` declares, from a clean directory.
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const entries = ['lib', 'bin', 'locale', 'icon.svg', 'README.md', 'DESIGN.md', 'PUBLISH.md', 'CHANGELOG.md', 'LICENSE'];
for (const entry of entries) {
  await cp(join(root, entry), join(stage, entry), { recursive: true });
}
// `cordis.patch.yml` in the repository is overwritten by local installs.
await cp(join(root, 'cordis.patch.publish.yml'), join(stage, 'cordis.patch.yml'));
manifest.private = false;
manifest.scripts = {};
await writeFile(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// 4. Verify the published shape.
const patch = await readFile(join(stage, 'cordis.patch.yml'), 'utf8');
const patchBody = patch.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
check(!patchBody.includes('file://'), 'cordis.patch.yml must not contain a file:// URL');
check(!patch.includes(root), 'cordis.patch.yml must not contain the repository path');
check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch missing');
check(manifest.dsh?.client?.platform === 'web', 'dsh.client.platform must be web');
check(manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-slots'), 'dsh.client.inject missing ui-slots');
check(manifest.exports?.['./client'] === './lib/client.js', 'exports["./client"] missing');
check(manifest.exports?.['./locale/*.json'] === './locale/*.json', 'locale export missing');
check(manifest.exports?.['./icon'] === './icon.svg', 'icon export missing');
check(manifest.engines?.dsh !== undefined, 'engines.dsh missing');
check(manifest.os?.includes('darwin') === true, 'os must declare darwin');
check(manifest.files.includes('cordis.patch.yml'), 'files must include cordis.patch.yml');

const client = await readFile(join(stage, 'lib', 'client.js'), 'utf8');
check(client.includes("id: 'dsh-disk-ops'") || client.includes('id: "dsh-disk-ops"'), 'client bundle id must match the package name');
check(!client.includes('require("fs")'), 'client bundle must not require Node builtins');

const icon = await stat(join(stage, 'icon.svg'));
check(icon.size <= 256 * 1024, 'icon must be at most 256 KiB');
const en = JSON.parse(await readFile(join(stage, 'locale', 'en.json'), 'utf8'));
const zh = JSON.parse(await readFile(join(stage, 'locale', 'zh.json'), 'utf8'));
check(typeof en.meta?.title === 'string' && en.meta.title.length > 0, 'locale/en.json needs meta.title');
check(typeof en.meta?.description === 'string', 'locale/en.json needs meta.description');
check(typeof zh.meta?.title === 'string' && zh.meta.title.length > 0, 'locale/zh.json needs meta.title');

// 5. Pack and inspect the tarball. Use a workspace cache: the user's global
// npm cache may contain root-owned entries from an older npm.
const npmCache = join(root, 'build', 'npm-cache');
await mkdir(npmCache, { recursive: true });
const npmFlags = ['--cache', npmCache, ...(registry ? ['--registry', registry] : [])];
const packed = spawnSync('npm', ['pack', '--json', ...npmFlags], {
  cwd: stage,
  encoding: 'utf8',
});
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || 'npm pack failed\n');
  process.exit(packed.status ?? 1);
}
const info = JSON.parse(packed.stdout)[0];
const tarball = join(stage, info.filename);
const listing = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).stdout.trim().split('\n');
check(listing.every((name) => !name.includes('/dist/')), 'tarball must not contain dist/');

await mkdir(join(root, 'build'), { recursive: true });
await cp(tarball, join(root, 'build', info.filename));

const display = manifest.name + '@' + manifest.version;
process.stdout.write([
  '',
  `staged ${display}`,
  `tarball: ${join(root, 'build', info.filename)} (${info.size} bytes, ${info.unpackedSize} unpacked)`,
  `files: ${info.entryCount}`,
  `patch: ${patch.trim().split('\n').slice(-3).join(' | ')}`,
  '',
  'Install this build in a profile with:',
  `  plugin_manager install_bundle target="${join(root, 'build', info.filename)}"`,
  'or from the registry after publishing:',
  `  plugin_manager install_bundle target="${manifest.name}"`,
  '',
].join('\n'));

if (publish) {
  run('npm', ['publish', tarball, '--access', 'public', ...npmFlags, ...(tag ? ['--tag', tag] : []), ...(otp ? ['--otp', otp] : [])], { cwd: stage });
  process.stdout.write(`published ${display}\n`);
} else {
  process.stdout.write('Not published. Re-run with --publish (npm login first), or publish the tarball manually.\n');
}
