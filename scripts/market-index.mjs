#!/usr/bin/env node
/**
 * Generate market/index.json (format 1) for `plugin_market`.
 *
 * The icon is embedded as a data: URL, so the index only needs to be hosted;
 * the artwork travels with it. Publish/commit this file, then add its raw URL
 * in Settings → Plugin Market (or `plugin_market` setIndexes).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const icon = await readFile(join(root, 'icon.svg'));
const iconUrl = `data:image/svg+xml;base64,${icon.toString('base64')}`;
const now = Math.floor(Date.now() / 1000);

const index = {
  format: 1,
  metadata: {
    categories: {
      disk: { title: { en: 'Disk & storage', zh: '磁盘与存储' } },
    },
    labels: {
      macos: { title: { en: 'macOS', zh: 'macOS' } },
    },
    sortKeys: {
      updated: { title: { en: 'Updated', zh: '更新' }, order: 'desc' },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'Disk Space', zh: '磁盘空间' },
      description: {
        en: pkg.description,
        zh: '用树图查看磁盘占用，按可清理建议生成计划并确认后移入废纸篓。仅支持 macOS。',
      },
      author: pkg.author,
      icon: iconUrl,
      metadata: {
        category: 'disk',
        keywords: pkg.keywords,
        labels: ['macos'],
        sortKeys: { updated: now },
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: now,
          source: { type: 'npm' },
          engines: { dsh: pkg.engines.dsh },
        },
      ],
    },
  ],
};

await mkdir(join(root, 'market'), { recursive: true });
await writeFile(join(root, 'market', 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
process.stdout.write(`wrote market/index.json for ${pkg.name}@${pkg.version}\n`);
