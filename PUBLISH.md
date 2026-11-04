# 发布为 DSH 插件

DSH 的“插件”发布单位是 **bundle 包**：一个 npm 包，manifest 里声明 `dsh.bundle.patch`，可选声明 `dsh.client` 提供 Web UI。发布有两条独立通道：

1. **npm registry（必须）**：用户用 `plugin_manager install_bundle target="dsh-disk-ops"` 直接安装。
2. **插件市场索引（可选，负责被发现）**：一个 format 1 的 JSON 索引，用户在 Settings → Plugin Market 添加索引 URL；DSH 不内置这个索引。

不需要向 DSH 仓库提 PR，也不需要把包放进 `$DSH_HOME`。

## 官方依据（本机 app.asar 内）

| 文件 | 用到的规则 |
|---|---|
| `/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md` | bundle 的安装/验证流程；显示资源清单 |
| `.../references/host-plugin.md` | `dsh.bundle.patch`、`locale/*.json` 的 `meta.title/description`、`./icon`、`files`、`exports`；图标 ≤256 KiB |
| `.../references/ui-plugin.md` | `dsh.client`、`exports["./client"]`、浏览器工厂 id 必须等于包名、样式/清理归 `apply` |
| `/node_modules/@deepseek-ai/dsh-plugin-manager/README.zh.md` | 按 registry 安装、安装前检查 `engines`/`peerDependencies`、npmmirror 回退 |
| `/node_modules/@deepseek-ai/dsh-plugin-market/README.zh.md` | 市场索引是用户配置的 URL；安装仍走 `pluginManager.installBundle` |
| `/node_modules/@deepseek-ai/dsh-plugin-market-index/README.zh.md` + `lib/index.js` | format 1 的字段与安装参数 `name@version` |
| `/node_modules/dsh-ppt-composer/package.json` | 官方 bundle 的 `files` / `exports` / `dsh` 写法参考 |

## 包形状（本仓库已满足）

```jsonc
{
  "name": "dsh-disk-ops",
  "version": "0.2.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "bin": { "dsh-disk": "./bin/dsh-disk.js" },
  "files": ["lib", "bin", "locale", "icon.svg", "docs", "cordis.patch.yml", "README.md", "DESIGN.md", "PUBLISH.md", "CHANGELOG.md", "LICENSE"],
  "os": ["darwin"],
  "engines": { "node": ">=22", "dsh": ">=0.2.1-rc.2" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["@deepseek-ai/dsh-client-ui-slots"], "platform": "web" }
  }
}
```

- **patch 必须按包名解析**：仓库里的 `cordis.patch.yml` 会被本地 `install.mjs` 改写成 `file://…/dist/<rev>/index.js`。发布包使用 `cordis.patch.publish.yml`（`name: dsh-disk-ops`），由 `scripts/publish.mjs` 在 staging 里替换。
- **显示资源**：`locale/en.json`、`locale/zh.json` 提供 `meta.title/description`；`icon.svg` 是原创图标（1 KiB）；Plugin Manager 不激活插件也能读它们。
- **客户端**：`lib/client.js` 是预构建的 `__ModuleLoader__` 工厂，id 为 `dsh-disk-ops`；`dsh.client.inject` 只排激活顺序。
- **平台**：`os: ["darwin"]`，因为实现依赖 `open`、`osascript`、APFS 语义。
- **版本兼容**：`engines.dsh` 用 `>=0.2.1-rc.2`。注意 SemVer 预发布：`>=0.2.0` 不会匹配 `0.2.1-rc.2`，所以下限写成当前预发布版本。

## 发布前检查

```bash
cd disk-ops
npm view dsh-disk-ops version      # 名称可用性（本机查为 404）
node scripts/publish.mjs           # 构建 + 24 个测试 + 打包 + 校验
```

`scripts/publish.mjs` 会失败于：patch 里出现 `file://` 或仓库绝对路径、缺 `dsh.bundle/client`、缺 locale/icon、icon 超 256 KiB、client id 与包名不一致、tarball 里出现 `dist/`。

产物：`build/dsh-disk-ops-0.1.2.tgz`。可先本地装这个 tarball 验证：

```text
plugin_manager install_bundle target="$PWD/build/dsh-disk-ops-0.1.2.tgz"
```

## 上传 npm

```bash
npm login
node scripts/publish.mjs --publish
# 可选：--tag next / --registry https://registry.npmjs.org
```

用户安装：

```text
plugin_manager install_bundle target="dsh-disk-ops"
plugin_manager install_bundle target="dsh-disk-ops@0.2.0" registry="https://registry.npmjs.org"
```

- 注册表按 `registry` → `fallbackRegistries`（默认 npmmirror）顺序询问，一个不可达会自动换下一个。
- 已装同版本时先 `remove_bundle`；Host 代码替换后需要 DSH 重启/HMR 重新加载。
- 版本要求不满足时，安装会在 pnpm 下载前失败，不会留下半装状态。

## 市场索引（可选）

`node scripts/market-index.mjs` 生成 `market/index.json`（format 1）：

- 图标以 `data:image/svg+xml;base64` 内嵌（<32 KiB），索引本身只需托管 JSON。
- 版本项含 `version`、`publishTimestamp`、`source: {type:"npm"}`、`engines.dsh`。
- 托管到任意 HTTPS（例如 GitHub raw / 自己的静态站点），然后在 DSH **Settings → Plugin Market** 添加该 URL；用户即可搜索并安装。
- 发布新版本后重跑脚本、提交新索引；`versions` 数组可保留历史版本，`parseMarketIndex` 会按 SemVer 降序排列。
- 索引里的 `title/description` 是 locale 对象，必须含 `en`。

## 社区目录（dsh-market / awesome-dsh-plugin）

真正被用户“发现”的入口是社区目录：[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。dsh-market 与 dshmarket.com 都从它生成；DSH 的 Discover 也能直接添加它的索引：

```text
https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

收录步骤（官方 `contributing.md`）：

1. **先有 GitHub 仓库**，仓库创建满 1 天，加 topic `dsh-plugin`。
2. 仓库根 `package.json` 必须有 `dsh.bundle`（只声明 `dsh.client` 会被拒）。
3. 发布 npm 包后，把 `package.json` 的 `repository` 指回该仓库，目录才会把 npm 包和仓库关联（下载量统计）。
4. 在该目录仓库新增 **一个 YAML**：`data/plugins/<owner>__<repo>.yml`，模板见本仓库 `market/awesome-dsh-plugin.yml`：
   - `url` 必须与仓库完全一致；`name` 写 `owner/repo`
   - `category` 选 `tools`（磁盘管理属于工具；主题类才放 `theme`）
   - `description.en` 必填、只写功能；`zh` 可选
   - `icon` 必须是 **GitHub 托管的 PNG/JPEG/WebP**（SVG 会被拒）；本仓库已生成 `assets/icon-512.png`
   - 不要手改生成的 README；一个 PR 最多 3 条
5. 可选：仓库根放 `screenshots.json`（本仓库已提供），市场详情页会展示 1–8 张截图。

模板文件：`market/awesome-dsh-plugin.yml`。把 `OWNER` 换成你的 GitHub 用户名后提交 PR 即可。

## 当前发布状态（0.1.2）

- GitHub：<https://github.com/aiml-kiki/dsh-disk-ops>（main，topics 已加）
- Release：<https://github.com/aiml-kiki/dsh-disk-ops/releases/tag/v0.1.2>，资产 `dsh-disk-ops-0.1.2.tgz`
- npm：待 `npm login` 后执行 `node scripts/publish.mjs --publish`
- 社区目录：仓库创建未满 1 天，满 1 天后提交 `market/awesome-dsh-plugin.yml`

## 发布后验证

1. 在一个干净 profile 里装 registry 版，确认 Plugin Manager 显示「磁盘空间 / Disk Space」与图标（en/zh 各看一次）。
2. 打开面板，走一遍：下钻 → 悬浮 → 定位 → 搜索 → 勾选 → 生成计划（**不要**在真实缓存上确认，除非你接受删除）。
3. 升级路径：`remove_bundle` → `install_bundle` 新版本；确认旧 slot 不残留、client 刷新。
4. 版本不兼容路径：把 `engines.dsh` 临时改高，确认安装前被拒（不下载）。

## 版本与兼容策略

- 0.x：API 与 UI 都可能调整；破坏性改动升 minor（0.2 → 0.3）。
- 面板依赖的 Client slot（`main`、`sidebar.panellist`）或 Host 服务签名变化时，提高 `engines.dsh` 下限。
- 清理规则/数据目录（`$DSH_HOME/disk-ops`）保持向后兼容，`schema_version` 递增。
- 发布前更新 `CHANGELOG.md` 与 `market/index.json` 的 `publishTimestamp`。

## 已知边界

- 只支持 macOS（`os: ["darwin"]`）；Linux/Windows 需要 adapter，未实现。
- 面板文案目前中文为主，只有 Plugin Manager 标题/描述做了 en/zh；完整 i18n 需要接 Client locale 服务。
- 真实删除只通过计划+确认；发布包不提供 `--yes`，也不申请 Full Disk Access。
