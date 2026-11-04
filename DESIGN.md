# dsh-disk-ops — 设计（v1 已实现）

DSH Desktop 插件：可视化并管理本机磁盘空间。**面板是主角**，`/disk` 命令与 agent 工具是辅助入口。

## 1. 目标 / 非目标

**目标**
- 打开面板 10 秒内看到：总容量/已用/可用、家目录占用树图、按类别的可清理建议、大文件 Top。
- 逐层下钻（treemap 点击进入下一层，面包屑返回），每层结果缓存。
- 面板内勾选建议项，内联二次确认后移到废纸篓；全程可审计。

**非目标（v1 不做）**
- 不做常驻监控、不做自动清理、不做定时扫描。
- 不申请 macOS 全盘访问（FDA）、永不 `sudo`；系统层（`/Library`、TM 快照、Docker）只给只读建议。
- 不做卸载器、不做「优化」、不做 Intel 代码剥离。
- 不做 Windows/Linux；平台差异收进 adapter。

## 2. 已定决策

1. 范围：用户级、无需 sudo 的家目录对象；系统层只报告。
2. 面板进 v1 主线；命令/工具为辅。
3. 面板形态：treemap 主视图 + 右侧「可清理建议」列 + 底部大文件 Top 10。
4. 入口：左侧栏图标 → 全宽主面板（`sidebar.panellist` + `main` keyed，已用 slot inspect 验证注册成功）；兜底为 `settings.section` 一页。
5. 面板删除：勾选建议 → 计划（10 分钟有效）→ 内联确认 → 移入废纸篓；结果与审计可见。
6. 扫描模型：逐层懒加载；首页为家目录一级 + 规则命中目录，目标 <10 秒；每层按路径缓存；不做一次性全盘扫。
7. 口径：默认实际占用块（`du`，与 `df` 对齐）；APFS 克隆共享块不做去重（已注明）；父子重叠去重；部分扫描标 `scan_status`。
8. 大文件：>100MB、Top 50；外置卷默认不扫（`--volumes` 打开）。
9. 跳过：iCloud Drive（`~/Library/Mobile Documents`）、网络卷、外置卷、符号链接目标。
10. 规则：内置表 + 用户覆盖 `$DSH_HOME/disk-ops/rules.json`（零依赖，无 YAML 解析器）；等级 `safe | probably | risky`；未知路径 = risky，只报告。
11. 清理默认进废纸篓：`osascript` 调 Finder（保留「放回原处」），失败回退 `mv ~/.Trash`；永久删除只走 `trash-empty` / `clean --permanent`，需输入条目数确认。
12. 安全：白名单根 + 路径规范化 + 符号链接解析 + 执行前重新 stat（TOCTOU）；plan 内容哈希 + 10 分钟过期；不提供一键全清；不提供 undo（废纸篓 + 审计日志替代）。
13. 审计：`$DSH_HOME/disk-ops/audit.ndjson` 追加写，5MB 轮转 × 3；记录时间/原路径/大小/动作/落点/批次。
14. 命名：插件 id `disk-ops`，包名 `dsh-disk-ops`，命令 `/disk`，工具 `disk_scan` / `disk_clean`，CLI `dsh-disk`。
15. 技术：Host 半纯 ESM JS、零第三方依赖；Client 半手写 `window.__ModuleLoader__.load` bundle（`React.createElement` + SVG，零构建、零图表库）；两者共享同一份 rules/treemap 纯函数源码。
16. 数据：`$DSH_HOME/disk-ops/{rules.json,audit.ndjson,cache/}`；UI 中文，JSON 字段英文，`schema_version: 1`。
17. 交付：本机自用 bundle（`plugin_manager install_bundle` 本地目录），源码在 `default-workspace/disk-ops/`；`scripts/install.mjs` 负责 hash 目录、patch 行、备份、`--uninstall`。
18. 测试：`node --test`，夹具在临时目录；无 CI。

## 3. 架构与文件

```text
disk-ops/
├── package.json          # type:module, exports "." + "./client", dsh.bundle.patch, dsh.client
├── cordis.patch.yml      # insert: { id: dsh-disk-ops, name: file://.../dist/<hash>/index.js }
├── scripts/
│   ├── install.mjs       # 构建 dist/<hash>/、写 patch 行（默认 dry-run，--apply 才写）
│   └── build-client.mjs  # 拼接 client.js（模板 + 面板源码 + 共享纯函数）
├── lib/
│   ├── index.js          # Host 插件：commands / tools / webServer 路由 / systemPrompt
│   ├── core/
│   │   ├── scan.js       # 遍历、大小、scan_status、缓存
│   │   ├── rules.js      # 规则表加载、用户覆盖、匹配与安全等级
│   │   ├── plan.js       # 清理计划、哈希、过期、执行前复核
│   │   ├── trash.js      # osascript / mv 降级
│   │   ├── audit.js      # ndjson 追加与轮转
│   │   ├── treemap.js    # squarified 布局（纯函数，Host/Client 共用）
│   │   ├── format.js     # 字节、表格、JSON schema
│   │   └── platform.js   # macOS：df、osascript、tmutil 提示
│   └── client.js         # 构建产物（勿手改）
├── src/
│   └── client/
│       ├── template.js   # __ModuleLoader__ 包装骨架
│       ├── panel.js      # 面板组件（React.createElement）
│       └── styles.js     # styles.insert 的 CSS
├── bin/dsh-disk.js       # 裸 CLI
├── tests/*.test.mjs
└── DESIGN.md
```

Host 半 `inject = ["tools", "commands", "systemPrompt", "webServer", "connection"]`；
Client 半 `inject = ["slots"]`，`require("react")`，不引其他运行时模块。

## 4. 面板与交互（第一性原理）

三个问题对应三个区域，一屏答完：

1. **空间去哪了**：容量条 + treemap（面积=占用）。悬浮给路径/大小/占本层比例；单击下钻；双击在 Finder 显示；面包屑、← 或 `Esc` 返回。
2. **能清什么**：右侧建议列。安全等级色点 + 名称/体积/路径，`全部 / 安全 / 谨慎` 过滤，行点击即勾选，「选中全部安全项」一键选中。
3. **清了安全吗**：底部动作条。选择合计 → 生成计划（条目数/总大小/10 分钟有效）→ 内联确认 → 逐条复核后移入废纸篓 → 结果提示 + 审计。

信息层级：主视图只留图与建议，说明文字退到悬浮层/计划卡；数字统一 tabular-nums。

**联动（v1.1）**：三个区域共享同一个当前位置，而不是三份独立数据。

- 建议列表支持「当前层 / 全部」范围；悬浮建议高亮其所属色块，悬浮色块显示「含可清理 n 项 · X」。
- 建议行「↗」跳到该项父目录并在树图中高亮；大文件行「定位」同理，跳到文件父目录。
- 大文件支持「当前层 / 全盘」；搜索（`/` 聚焦）按名称/路径过滤建议。
- 选中项被范围或搜索隐藏时，动作条显式提示，避免清掉看不见的项。
性能：缓存先渲染（过期也先展示），过期条目后台 `refresh=1` 再替换；扫描中旧图压暗 + 「扫描中…」，不出现空屏。
隐私：`~/Library/Containers`、`Group Containers`、`Mail`、`Safari`、TCC 目录在上一层有体积，进入时直接显示「受 macOS 隐私保护」并拒绝下钻 —— 不触发系统授权框，不申请 FDA。

```text
┌ 磁盘空间 ─────────────── 254 GB 已用 · 631 GB 可用 ────── [刷新] ┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
├──────────────────────────────────┬─────────────────────────────┤
│ ← 家目录                          │ 可清理建议 4.28 GB           │
│ ┌──────────────────────────────┐ │ 全部 67 · 安全 64 · 谨慎 1   │
│ │ Projects        Library  │ │ ☑ npm 缓存        1.12 GB   │
│ │ 141 GB              13.5 GB  │ │ ☑ Google            794 MB   │
│ │        (悬浮：路径/占比)      │ │ ☐ pnpm store        454 MB   │
│ └──────────────────────────────┘ │ …                           │
│ 部分结果 · 缓存 · 01:03          │ [勾选后清理] [选中全部安全项] │
│                                  │  ☐ npm 缓存 1.12 GB          │
├──────────────────────────────────┤  …                           │
│ 大文件 Top 10 (>100 MB)          │                              │
│ 13.5 GB …/head_lora.pt  定位 显示 │                              │
└──────────────────────────────────┴──────────────────────────────┘
```

数据流：

- `GET /disk-ops/report?path=&refresh=` → `{entries,total,scan_status,cached,stale,note}`；`stale` 时客户端先渲染再后台刷新。
- 点击色块 → 同一路由请求下一层；缓存键 = 规范化路径；扫描预算 8s，超时标 `partial`。
- 双击 → `POST /disk-ops/reveal {path}` → `open -R`（限定家目录内）。
- 建议 → `GET /disk-ops/suggestions[?refresh=1]`，返回 `reclaimable` 与逐项 `{path,size,safety,category,deletable}`。
- 清理 → `POST /disk-ops/plan {items}` → `POST /disk-ops/clean {plan_id,token,ids}`。

## 5. 扫描与口径

- 遍历：`fs.opendir` 逐层；`lstat` 不计符号链接；跳过 iCloud/网络卷/外置卷/权限拒绝。
- 大小：默认 `st_blocks * 512`；`--accurate` 时按 `(dev, ino)` 去重全共享 APFS 克隆。
- 重叠：父目录命中规则后，子目录不再重复计入可回收总量。
- 状态：每个目录 `scan_status: complete | partial | unavailable`；部分结果大小带 `+`。
- 首页预算：只扫家目录一级 + 规则命中目录；目标 <10s，超时降级为 partial 并提示。
- 缓存：`cache/<sha256(path)>.json`，含 `generated_at`、`schema_version`；24h 后仍返回（`stale:true`）供首屏渲染，再由客户端后台刷新。

## 6. v1 规则表

| 类别 | 路径 | 等级 | 动作 |
|---|---|---|---|
| 应用缓存 | `~/Library/Caches/*`（跳过 ignore 与 24h 内活跃项） | safe | 可清（废纸篓） |
| 日志/崩溃报告 | `~/Library/Logs`、`~/Library/Logs/DiagnosticReports` | safe | 可清 |
| 废纸篓 | `~/.Trash` | 不可逆 | 仅 `trash-empty` + 强确认 |
| Xcode 派生数据 | `~/Library/Developer/Xcode/DerivedData` | safe | 可清 |
| 设备支持 | `~/Library/Developer/Xcode/iOS DeviceSupport` | probably | 可清 |
| 模拟器缓存 | `~/Library/Developer/CoreSimulator/Caches` | probably | 只报告 |
| 包管理器缓存 | `~/.npm/_cacache`、`~/Library/pnpm/store`、`~/Library/Caches/{Homebrew,pip,Yarn,go-build}` | safe | 可清 |
| JVM/CocoaPods | `~/.gradle/caches`、`~/.m2/repository`、`~/Library/Caches/CocoaPods` | probably | 可清（需重下） |
| 项目构建产物 | 项目内 `node_modules`/`target`/`dist`/`.build`（见下） | probably | 仅 `--projects` |
| iOS 备份 | `~/Library/Application Support/MobileSync/Backup` | risky | 只报告（附最后备份时间） |
| 安装包 | `~/Downloads`、`~/Desktop` 的 `*.dmg/*.pkg/*.iso`（>30 天） | probably | 可清（逐项） |
| 大文件 | 家目录 >100MB，Top 50 | risky | 只报告 |
| 系统层 | Docker 镜像、TM 本地快照、`/Library` | risky | 只给建议 |

项目产物保护（全部满足才进候选）：仅在配置根目录下 6 层内；gitignored；无 tracked 文件；目录内无 `.git`；无部署密钥文件；7 天内有改动不选。默认一项不选。

## 7. 清理与安全模型

```text
scan → plan（条目 + 大小 + 哈希 + 10 分钟过期）
     → 用户确认（命令确认串 / 面板弹窗 / 工具内 ctx.userQuestions）
     → commit：逐条重新 stat（路径、大小、inode 不变才执行）
     → trash（osascript → mv 降级）
     → audit.ndjson 追加
```

硬规则：目标必须在白名单根内；解析 `..` 与符号链接后仍在根内；不删白名单根本身；不做 `sudo`；不递归删根目录；不提供 `--yes` 绕过确认；`trash-empty` 需输入条目数。

## 8. 接口契约

```text
/disk scan   [--deep] [--refresh] [--accurate] [--volumes] [--json]
/disk big    [--min 100MB] [--top 50] [--path <dir>]
/disk clean  [--dry-run(默认)] [--projects] [--only <id,id>] [--confirm <token>] [--permanent]
/disk status
/disk rules  [--validate]
/disk trash-empty --confirm <count>
dsh-disk <同上>
```

- 工具：`disk_scan`（只读）、`disk_clean`（`action: plan | commit`；commit 内部强制 `ctx.userQuestions` 确认，模型无法代答）。
- 路由：`GET /disk-ops/{report,suggestions,big,status}?path=&refresh=`、`POST /disk-ops/{plan,clean,reveal}`；`ctx.connection.requestRejection(req)` 鉴权，返回 `schema_version: 1`。
- JSON 每项：`{ path, size, is_dir, safety, action, reason, scan_status }`。
- systemPrompt 注入一句：清理前必须先 `disk_scan` 并取得用户确认；`/disk` 用于精确操作。

## 9. 技术路线与已知坑

- Client bundle 是 `window.__ModuleLoader__.load({ id, factory: (require) => { … exports.apply; exports.inject } })`；`require` 可用 `react`、`react-dom`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`。不引 JSX，全部 `React.createElement`。
- Host 代码改动需重启（ESM 缓存）：`install.mjs` 把 `lib/` 拷进 `dist/<hash>/` 并改 patch 里的 `file://` URL。
- 带 UI 的插件需作为 bundle 安装，`file://` patch 行只保证 Host 半；client 半由 package `exports["./client"]` + `dsh.client` 提供。M0 探针验证。
- 槽位：`sidebar.panellist`（id/order/label）→ `main`（keyed key）为候选；`settings.section`（id/order/label/inject）是已确认兜底；`sidebar.right.pane.tab` 需 shell 的 tab 控制器，成本高，不用。
- Treemap 用 squarified 布局纯函数，单测覆盖面积守恒与无重叠。

## 10. 里程碑与验收

**M0 探针（已完成）**：`sidebar.panellist` + `main` 挂载成功（slot inspect 验证 active）；`settings.section` 兜底保留。
**M1 只读（已完成）**：scan/rules/cache/treemap/面板/`scan|big|status`/CLI/单测；真机首页 <10s；不申请 FDA、不 sudo。
**M2 清理（已实现）**：plan/trash/audit/命令/工具/面板内清理。面板已实测「选中 64 项 → 生成计划 → 取消」；真实「移废纸篓」待在夹具上验收（避免误删真实缓存）。
**验收**：① 单测覆盖规则匹配、路径逃逸/符号链接、重叠去重、plan 哈希；② 夹具 dry-run 与真实清理断言审计逐条一致；③ 真机首页 <10s；④ 无权限目录只记 skip；⑤ 系统层零写入。

## 11. 参考的开源做法

- Mole（[tw93/Mole](https://github.com/tw93/Mole)）：`--dry-run` 默认、白名单读不到就拒绝、`operations.log`、`scan_status` 与部分扫描标记、项目产物保护、安装包身份复核。（GPL-3.0，只借做法不抄代码）
- dua（[Byron/dua-cli](https://github.com/Byron/dua-cli)）：并行遍历、APFS 克隆去重可选、`--ignore-from`、多阶段删除确认。
- ncdu / dust（[ncdu](https://dev.yorhel.nl/ncdu)、[bootandy/dust](https://github.com/bootandy/dust)）：下钻交互、条形树、JSON 导出。

## 12. 已知风险

1. `main`/`panellist` 已用 slot inspect 验证；若未来 shell 改契约，`settings.section` 仍可兜底。
2. 本地 bundle 安装需 `plugin_manager` 授权；M1 前必须确认安装路径。
3. treemap 在窄侧栏的可读性 → 预留条形树降级。
4. 计大小在 APFS 克隆/硬链接下偏差 → 默认标注口径，`--accurate` 才精确。
