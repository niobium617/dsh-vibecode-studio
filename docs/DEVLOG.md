# Development log

> 项目：DSH Vibecode Studio
> 记录日期：2026-10-26
> 用途：按任务记录开发进度、已验证事实、踩过的坑和恢复入口。
> **验收细节以 `spikes/*/REPORT.md` 为准；恢复会话先读 `tasks/HANDOFF.md`，本页只查当前任务相关段，不必通读。**

## 1. 当前快照

- 阶段：**Phase 4 实现（M0/G0 已通过，进入 M1）**。
- 已完成：T001 S1 传输 spike、T002 S2 composer handoff spike、T003 S3 screencast + 输入 + 中文 spike、T004 S4 拾取 + 源码 spike、T005 G0 Spike 评审、T006 包脚手架与工具链、T007 Client bundle loader 包装、T008 Host 插件骨架与 Config、T009 Contracts v1。
- 进行中：无；下一项 **T010 Client shell + 右栏 tab**。
- 产品包已能在 DSH 加载：根 `package.json` 为 `dsh-vibecode-studio@0.1.0`；`lib/index.js`（host ESM）与 `lib/client.js`（loader 包装）由 `pnpm build` 生成，均已 gitignore；`vibe-dev` 中可见 Vibe Studio 右栏 tab，host 提供 `vibeStudio` 服务并校验 Config。
- T001–T008 已提交并推送至 `task/m1-foundation`；T009 的 contracts、测试与文档尚未提交（等用户确认）。S3/S4 用 Playwright 启动的 Edge 在脚本结束时关闭，未留下进程。
- 真实 `desktop` profile **未修改**；S2 的 Desktop 手测只在 `.tmp/` 下的隔离 `DSH_HOME` 中进行。

环境：

| 项 | 值 |
|---|---|
| OS | Windows 11 Home China 10.0.26100 |
| Node / pnpm | 24.13.0 / 11.21.0 |
| DSH CLI / Desktop | 0.2.1-rc.2 / 0.2.1-rc.3（Electron 44.7.0） |
| 浏览器 | 本机 Microsoft Edge，Playwright `channel: 'msedge'` |
| 开发 profile | `vibe-dev`；不直接改 `desktop`/`web` |
| S4 fixture 依赖 | Vite 8.3.5、React 19.3.1、Vue 3.5.44、Svelte 5.57.2、vite-plugin-vue-inspector 7.0.0、@react-dev-inspector/babel-plugin 2.0.1、@babel/core 7.29.7、esbuild 0.28.2（均为项目内 devDependencies） |

## 2. 进度时间线

### T001 — S1 传输 spike（已完成）

- 目标：比较 pull JPEG 与 multipart stream 在 DSH Web/Desktop 的稳定性。
- 结果：两种载体、两种模式都达到 30 fps；30 s 验收 0 gap/错误/重连；10 min stream soak Web 18,001 帧 / Desktop 18,000 帧，内存净增 < 2 MB。
- 决策：**stream 为主，pull 为回退**（Plan D3 已更新）。
- 关键实现：Host 只使用 `ctx.connection.fetch.register` 的精确 `/api/vibe/...` 路由；客户端使用文档相对路径 `api/vibe/...`；stream 结束/异常自动重连。
- 证据：[`spikes/s1/REPORT.md`](../spikes/s1/REPORT.md)；任务记录：[`tasks/todo.md`](../tasks/todo.md)。
- 提交：`18b6b41 feat(s1): harden stream-first transport and add soak harness`、`5fee6bb docs(s1): record acceptance results and select stream primary`。
- CI：run `40181362285`，`check` 成功。

### T002 — S2 composer handoff spike（已完成）

- 目标：从右栏 tab 把文本（和可选截图）放进当前会话 composer，且不自动发送。
- 结果：
  - Web 与隔离 Desktop 都通过公开 `conversation.input.left` 取得 `inputActions`，完成 `setDraft`、键盘编辑、`captureInsertion` + `insertText`。
  - 111 字符测试文本 + 2 s 等待后 `phase === 'plain'`、草稿完整；不调用 `submit` / `ctx.conversation.send`，未观察到自动提交。
  - 文本和 PNG 剪贴板在两种载体均可用；console error 为 0。
  - Web 跨会话文本隔离通过；附件 id 切走再切回后丢失。
  - `createDrafts` + `addAttachments` 实验成功，但 `createDrafts` **不在公开 `IConversation`**，不能作为产品能力。
- 决策：**MVP 只做“复制截图 + 手动粘贴”**；D6 已更新。D5 保持“只调用公开 `InputActions` / `ctx.conversation`”。
- 证据：[`spikes/s2/REPORT.md`](../spikes/s2/REPORT.md)；复现：[`spikes/s2/run.md`](../spikes/s2/run.md)。
- 提交：`d90dd0b feat(s2): add composer handoff spike`、`5ec4265 docs(s2): record composer handoff acceptance`。
- CI：run `40182910646`，`check` 成功（含 `pnpm spike:s2:build`）。

### T003 — S3 screencast + 输入 + 中文 spike（已完成）

- 目标：Playwright + Edge 的 screencast、点击/滚动/键盘、中文输入、延迟测量。
- 结果：
  - headless 988 帧 / 98.7 fps、headful 983 帧 / 98.3 fps；unique fps 同值，无重复帧虚增；首帧 24/18 ms。
  - 帧捕获→接收延迟 avg/p95 7.4/12.9 ms 与 5.4/8.1 ms；平均 20.2 KB/帧（q70），约 2 MB/s。
  - 输入最大 26.8/25.2 ms（滚轮最高）；点击、ASCII 键盘、中文 `insertText`、逐字 `type`、模拟 IME 提交均在 1–9 ms，全部 < 200 ms。
  - 中文三条路径写入正确；IME 触发 5 个 `composition*` / 6 个 `isComposing` 事件；焦点 click→text、Tab→ime、Esc 正常；0 console error。
- 决策：D4 保持“输入走精确 fetch 一元请求”；T020 增加帧节奏控制（30 fps 目标）；T022 采用“客户端组合 → host `Input.insertText`”，并保留逐字/粘贴回退。
- 限制：真实系统 IME 未在 DSH Web/Desktop 载体手测（T022 补）；headful 是 Playwright Edge 而非 Electron，不能替代 Desktop 输入栈证据；输入→新帧到达未联合测量（T021 补）。
- 证据：[`spikes/s3/REPORT.md`](../spikes/s3/REPORT.md)、[`spikes/s3/results.json`](../spikes/s3/results.json)。

### T004 — S4 拾取 + 源码 spike（已完成）

- 目标：Shadow DOM overlay 拾取；React/Vue/Svelte 开发态源码定位；30 元素命中 ≥80%、不触发页面点击、Esc 退出、无 console 报错。
- 结果：
  - React/Vue/Svelte 各 10/10，合计 30/30（100%）；行号与期望全部精确相等（delta=0）。
  - 选择器唯一 30/30；点击泄漏 0；Esc 三框架均退出；console/pageerror 0；overlay 在 open Shadow DOM。
  - React 19 路径：构建期 Babel 注入 `data-inspector-relative-path/-line/-column`（`@react-dev-inspector/babel-plugin`，MIT），拾取时读最近属性。
  - Vue 路径：`vite-plugin-vue-inspector` 运行时把 `data-v-inspector` 移入 vnode 不可枚举 prop `__v_inspector`，通过 `__vnode`/`__vue_inspector_store__.vnodeToPos` 读取。
  - Svelte 路径：直接读 dev 运行时 `element.__svelte_meta.loc`。
- 决策：G0 按框架做源码适配器（构建期属性 → 框架运行时 → 无源码降级）；React 19+ 不再依赖 fiber；Vue 不依赖 DOM 属性。
- 限制：仅 dev 模式；未覆盖 TSX fixture、iframe、closed shadow root、重复组件/动态列表的选择器稳定性；React Babel 预转换增加 dev 首次编译成本。
- 证据：[`spikes/s4/REPORT.md`](../spikes/s4/REPORT.md)、[`spikes/s4/results.json`](../spikes/s4/results.json)。

### T005 — G0 Spike 评审（已完成）

- 目标：汇总 S1–S4，确定帧传输基线、IME 回退、截图回退、源码回退；不写产品代码。
- 结果：**GO**。人工复核四份报告与证据（`s1/bench.json`、`s3/results.json`、`s4/results.json`），未重跑 spike。
- 最终选择：
  - 帧：stream（multipart JPEG）为主，pull 为断流/降级回退；T020 加 30 fps 限速并处理 pull seq 重置。
  - 输入：CDP `Input.*` 一元请求，与帧通道分离；T021 实测端到端延迟。
  - 中文：隐藏 textarea + `compositionend` → host `Input.insertText`；T022 系统 IME 手测失败时回退逐字/粘贴 + UI 提示。
  - 截图：只复制 PNG 到剪贴板、用户手动粘贴；不依赖非公开 `createDrafts`。
  - 源码：React 构建期 `data-inspector-*` → Vue vnode `__v_inspector` → Svelte `__svelte_meta`；未命中降级为选择器/DOM，不猜测。
- 残余风险：真实 IME 未在 DSH 载体手测；pull 断线/seq 重置未模拟；Desktop 偶发 `net::ERR_FAILED`；源码仅 dev、未覆盖 TSX/iframe/重复组件；DSH rc API 版本敏感。
- 证据：[`spikes/G0.md`](../spikes/G0.md)。

### T006 — 包脚手架与工具链（已完成）

- 目标：产品包 `package.json`、TS strict、构建/测试脚本、`src/` 目录骨架；host 产出 ESM。
- 结果：
  - 根包由 dev workspace（`dsh-vibecode-studio-dev@0.0.0`）改为产品包 `dsh-vibecode-studio@0.1.0`，保留 `type: module`、`private: true`、Node >= 24；`exports` 预留 `.`/`./client`/`./package.json`。
  - `tsconfig` 扩展 include 到 `src/`、`tests/`、`vitest.config.ts`，保持 strict、`noEmit`、Bundler 解析；新增 `resolveJsonModule` 供 T010 locale 使用。
  - `scripts/build-host.mjs` 用 esbuild 打包 host 为 ESM `lib/index.js`（相对模块内联、运行时包 external），构建后 `import()` 自检；`scripts/clean.mjs` 仅清理 `<repo>/lib`。
  - Vitest 5.0.5 接入（`vitest.config.ts`、`tests/smoke.test.ts` 3 用例）；`lib/` 加入 `.gitignore`。
- 验证：`pnpm install`、`pnpm typecheck`、`pnpm test`（3/3）、`pnpm build` 全绿；`lib/index.js` 108 B ESM，导出 `name`/`apply`。
- 决定：构建保持 esbuild（T007 再按 D2 评估 tsdown/rolldown 与 loader 包装）；`./client` 入口在 T007 产出 `lib/client.js` 前指向未生成文件，属预期。

### T007 — Client bundle loader 包装（已完成）

- 目标：最小 client 打包为 `window.__ModuleLoader__.load({ id, factory })`，在 DSH 右栏加载。
- 结果：
  - `scripts/build-client.mjs` 用 esbuild 产出 CJS（React/`react/jsx-runtime` external），再包一层 loader envelope 写到 `lib/client.js`；中间产物在 `.tmp/build/`。
  - `src/client/hello.tsx` 用 hooks + JSX；`src/client/index.ts` 注册 `sidebarRightTabs` 类型（`keepMounted`、guide）与 `sidebar.right.pane.tab` 面板。
  - 包根新增 `cordis.patch.yml` 与 `package.json.dsh`（`bundle.patch`、`client.platform=web`、`client.inject` renderer/sidebar-right）；`dsh plugin add link:` 会同时把包加入 profile bundles。
  - `pnpm build` 现在依次构建 host 与 client；新增 `build:host`/`build:client`。
- 验证：`pnpm typecheck`、`pnpm test`（4/4）、`pnpm build:client` 全绿；`vibe-dev` 4317 启动后右栏菜单出现 Vibe Studio，点击渲染 hello，按钮计数 0→1；client.js 200，console/pageerror 0。
- 限制：只验证 Web；Desktop 与 loader 版本兼容留到 T015/G1。

### T008 — Host 插件骨架与 Config（已完成）

- 目标：host 导出 `name`/`inject`/`apply`，用 `@deepseek-ai/schemastery` 定义 `Config`，注册服务位，并写 `vibe-dev` 安装说明。
- 结果：
  - `src/host/config.ts` 定义 5 个配置项：`logLevel`、`allowedOrigins`、`retentionDays`、`contextBudgetBytes`、`screenshotEnabled`，与 SPEC 设置面板字段预留对齐。
  - `resolveConfig()` 补 schema 不做的语义校验：拒绝未知键；origin 仅允许 http/https、不允许凭据/查询/hash，统一为 `URL.origin` 并去重；`allowedOrigins` 不能为空。
  - `src/host/index.ts` 的 `apply()` 解析配置后 `ctx.provide('vibeStudio', { config })`，后续 host 能力从该服务取配置。
  - `profiles/vibe-dev/README.md` 记录构建、链接安装、启动、`--dump-config`、配置覆盖、非法配置复现、移除与禁止改 `desktop`/`web`。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 2 文件 / 10 用例通过；`pnpm build` 生成 `lib/index.js` 2.4 KiB 并自检 import。`dsh --profile vibe-dev --dump-config` 含本插件段；`--patch .tmp/t008-valid.yml` 的覆盖值出现在 dump。负例启动（4319）输出 `warning: 1 entry did not activate` 与 `ValidationError: invalid config`，其余 DSH 正常服务。默认配置启动 20 s 无 warning/error。
- 限制：`--dump-config` 只打印合并结果、不校验配置，负例必须实际启动或用单测；`retentionDays`/`contextBudgetBytes`/`screenshotEnabled` 目前只解析、未消费。

### T009 — Contracts v1（已完成）

- 目标：跨模块类型、稳定错误码、预算/截断、脱敏与不可信包裹，全部为纯类型/纯函数。
- 结果：
  - `src/contracts/target.ts`：`TargetKind`（web/desktop/api）、`TargetConfig`（URL 或 command+cwd+port）、`TargetCapabilities`、`TargetSession` 与 `hasCapability()`。
  - `src/contracts/inspect.ts`：与 S4 拾取结果一致的 `ElementContext`/`SourceContext` 及运行时守卫。
  - `src/contracts/annotation.ts`：`Annotation`、JSON round-trip、坏数据拒绝、`renderAnnotationText()`；页面元素上下文包在 `<untrusted-page-content>` 内，注释留在包裹外。
  - `src/contracts/budget.ts`：4 KB 注解 / 8 KB observe / 2 KB DOM 常量；`utf8Bytes`、按码点的 `truncateUtf8`/`truncateChars`。
  - `src/contracts/redact.ts`：header/URL/嵌套 JSON body 脱敏，URL 同时清除 userinfo。
  - `src/contracts/errors.ts`、`ids.ts`、`artifacts.ts`、`telemetry.ts`：稳定错误码、品牌 ID、产物引用、console/network 条目及单行摘要（500 B，URL 先脱敏）。
- 验证：`pnpm exec vitest run tests/unit/contracts` 6 文件 / 34 用例、全量 `pnpm test` 8 文件 / 44 用例；`pnpm typecheck` 与 `pnpm build` 通过。`pnpm test -- <path>` 不会过滤（vitest 把 `--` 后的路径当普通参数），后续统一用 `pnpm exec vitest run <path>`。所有 contracts 只互相引用，无第三方/Node/DOM 运行时依赖。
- 决策：注解渲染先按 UTF-8 字节预算裁剪注释，元素块先裁剪再包裹，保证关闭标签不会被截断；脱敏只处理键名，不猜测页面文本中的 token。

## 3. 踩坑与已验证经验

### 构建 / 载体

32. **DSH 的 loader 包装不能省**：client 先产出 CJS，再包 `window.__ModuleLoader__.load({ id, factory })`；`id` 用包名，React/JSX runtime 走 factory 的 `require`。S1/S2/T007 三次复用同一形状，均无 loader 报错。
33. **`dsh plugin add link:` 会同步 bundles**：链接安装后 profile `package.json` 的 `dsh.profile.bundles` 自动加入包名；包自身还需 `cordis.patch.yml` + `dsh.bundle.patch`，否则不产生 host/client 行。
34. **自动验证用 Node spawn，不用 bash 后台重定向**：`dsh ... > log 2>&1 &` 在本机出现进程存在但端口不监听、日志为空；改为 Node `spawn('cmd.exe', ['/c', dsh, ...], { stdio: 'pipe' })` 读取 ready URL，再用 Playwright 驱动 Edge，最后 `taskkill /T /F` 清理，稳定可复现。T012/T057 沿用此方式。
35. **右栏 tab 通过 guide 菜单打开**：`sidebarRightTabs.register({ kind, guide })` 的入口在右栏“新标签页”菜单，用精确文本 `getByText('Vibe Studio', { exact: true })` 可避开 S1/S2 spike 前缀。
36. **`--dump-config` 不校验配置**：即使 patch 里的 `logLevel: verbose` 非法，dump 仍 exit 0 并原样打印；验证 Config 必须实际启动观察 `did not activate`/`ValidationError`，或走单测。
37. **schemastery 默认放过未知键**：`Schema.object` 不拒绝额外字段；需要 `resolveConfig()` 自行比对已知键，否则用户拼错配置会静默无效。
38. **不可信包裹要先转义再截断**：先截断原始内容再转义 HTML，`<` 变成 `&lt;` 会让实际字节数膨胀 4 倍并突破预算；先转义再按字节截断，即使截断点落在实体内也不会重新产生 `<\s*untrusted-page-content`。
39. **UTF-8 预算不能用 `string.length`**：中文/emoji 的码元数与字节数不同；按 `for...of` 逐码点累计 UTF-8 字节，才能在预算边界不产生替换字符（`�`）。

### 传输 / DSH 插件

1. **第三方插件不要用 `ctx.connection.rpc.handle`**：本版本会因 connection fiber 缺少 `webServer` inject 而失败；使用精确 `/api/...` fetch 路由。
2. **客户端路径必须是文档相对形式**：Web 可用 `/api/...`，但 Desktop 的 `dsh-app://app/` 需要 `api/...` 才会走 shell 的 fetch 桥。
3. **`engines.dsh` 放在包根**：DSH app-boot 只读顶层字段。
4. **Windows 定时器粒度约 15.6 ms**：30 fps 不能裸用 `setInterval(33)`，S1 使用 deadline scheduler。
5. **Soak 期间不要重建 linked package**：DSH 会热重载 client，测量失效；验收前检查包 mtime，必要时标记 `packageChanged`。

### Composer / S2

6. **`conversation.input.left` 的注册形状**：需要 `name` + `id` + `order` + scoped `inject: (sessionId) => ({ sessionId })`。只传 `key` 或把 `conversation` 放在插件根注入，会出现 `1 entry did not activate`。
7. **`link:` 路径必须绝对**：`dsh plugin add link:spikes/s2/package` 会相对 profile 解析，生成错误的 `package` 依赖；用 `<repo>/spikes/s2/package` 的绝对路径。
8. **`createDrafts` 是内部实现**：rc.2/rc.3 的 `ConversationService` 有这个方法，但公开 `IConversation` 只有 `input`、`blocks`、`send`、`updateQueue`、`cancel`、`loadOlder`。第三方不能依赖它。S2 的附件 accepted 只算实验。
9. **附件跨会话不保留**：Web 中 C 会话的附件 id 在切到 B 再回 C 后丢失，文本仍在。即使未来公开附件 API，也必须重测保留、上传失败和释放。
10. **Desktop 空白会话复用**：隔离 profile 只有一个空白会话时，“新建会话”仍返回同一 `sessionId`，所以 Desktop 跨会话 detach/attach 没有测到；Web 是目前的跨会话证据。
11. **不透明 origin 的剪贴板权限**：CDP 无法给 `dsh-app://` 授予 clipboard 权限（`Permission can't be granted to opaque origins`），但 Electron 剪贴板仍正常；Web 自动化要显式 `grantPermissions`。
12. **自动化选择器看 aria-label**：Desktop 可见文字是“新会话”，按钮的可访问名是“新建会话”；用可见文字匹配会超时。测试脚本优先用稳定的 `aria-label` 或 `data-row-key`。
13. **“不自动发送”要看状态**：只检查代码没有调用 `submit` 不够；验收同时检查 2 s 后 `phase` 和草稿。S2 的调试钩子只用于 spike，不能进入产品包。

### 环境 / 安全 / 运维

14. **Desktop 隔离必须同时隔离 DSH_HOME 和 Electron userData**：Windows 的 Electron 不认 `%APPDATA%` 覆盖；`DSH_HOME` 管 profile，`--user-data-dir` 管 Electron 缓存/单实例锁。CLI 会拒绝直接管理 `desktop` profile。
15. **真实 profile 保护**：S2 的 Desktop 测试只在隔离 profile 里手工加入依赖和 junction；验证过真实 `desktop/package.json` 没有 S2。不要把 spike 装进真实的 `desktop`/`web`。
16. **CDP 只绑 loopback**：验收使用 `127.0.0.1:9223`；结束后检查端口和进程树，`TaskStop` 后再确认没有 Electron/Node 子进程残留。
17. **GitHub 直连偶发不可达**：本机 `github.com:443` 曾超时，但 `api.github.com` 正常。当时的临时推送方式是只对单次命令做 `git -c http.curloptResolve=github.com:443:<可达 GitHub edge IP> push origin main`，**不写入仓库配置**；可达 IP 会变化，不要硬编码。
18. **CI 需要显式构建 S2**：`pnpm spike:s1` 会自行构建 S1，但 S2 是独立 build 脚本；已在 `.github/workflows/ci.yml` 加入 `pnpm spike:s2:build`，避免只测类型检查、不测 bundle。

### 协作 / 上下文成本

19. **先读 HANDOFF/报告，再做局部检索**：大范围 `find`/全文件读取和高 effort review subagent 会快速消耗上下文。用 `rg`/定位到具体行，先看任务验收再展开。
20. **后台任务及时收尾**：Web、Desktop、soak 都可能留下进程；验收结束立即 `TaskStop`，再查端口，避免影响下一次测量或污染记录。
21. **报告只放可复现证据**：原始 JSON/会话 id/附件 id 留在本机 `.tmp/`（gitignored）；公开报告不写机器绝对路径、token、session id。
22. **子代理是最大成本项**：历史 billable 的 61% 来自子代理，其中 18/20 个子代理由一次 general-purpose 的嵌套扇出产生。现行策略：前 2 个 Agent 调用直接放行，第 3 个起及嵌套调用才弹确认（`~/.claude/hooks/agent-quota.mjs` 的 PreToolUse hook，按会话 transcript 计数）；默认 Explore/Plan（不能嵌套）、每任务 ≤2、子代理固定 Flash；用量用 `pnpm usage:cc` 复核。

### Screencast / 输入 / 中文

23. **screencast fps 是上限不是常态**：持续动画 fixture 上 Edge headless 可到 ~99 fps，因为 screencast 按重绘发帧且 headless 不做 vsync 节流；静态页面帧数会低得多。不要用该值估算产品帧率，也不要把裸转发当默认。
24. **必须给帧加节奏控制**：q70/1280×800 平均 20.2 KB/帧，99 fps ≈ 2 MB/s；T020 用 `everyNthFrame` 或 host 限速到 30 fps（≈0.6 MB/s），复用 S1 的 deadline scheduler，不用裸 `setInterval`。
25. **输入延迟测量要写清边界**：S3 测的是 CDP 派发→页面事件/下一 rAF 绘制（1–27 ms），不含 client→host HTTP 与排队；T021 的端到端 <200 ms 必须单独实测。
26. **模拟 IME ≠ 系统 IME**：CDP `Input.imeSetComposition` + `Input.insertText` 只验证页面事件链和 host 提交路径；T022 必须在 `vibe-dev` Web 与 Desktop 用 Microsoft Pinyin 手测，失败启用逐字/粘贴回退。
27. **headful Edge 不等于 Desktop Electron**：Playwright 的 headful 只覆盖 host 侧同一 CDP 面，客户端输入栈不同；不要把它当 Desktop 证据。

### 拾取 / 源码

28. **React 19 没有 `_debugSource`**：React 19 的 `jsxDEV` 只接收 `debugStack`/`debugTask`，fiber 上不再有元素级源码；`_debugStack` 指向组件渲染位置，不能当元素行号。要元素级定位必须在构建期注入属性（S4 用 `@react-dev-inspector/babel-plugin` 生成 `data-inspector-*`）。
29. **拦截 `click` 会把自己的监听也拦掉**：捕获阶段对 `click` 调 `stopImmediatePropagation` 后，同元素后续监听（包括拾取器的 `onClick`）不再执行。只拦截 `pointerdown/mousedown/...`，`click` 交给拾取器自己的捕获监听。
30. **Vue inspector 的 DOM 属性运行时不存在**：`data-v-inspector` 被 `vite-plugin-vue-inspector` 移入 vnode 不可枚举 prop `__v_inspector` 并删除属性；读 DOM 属性会全部失败，应读 `el.__vnode` / `__vue_inspector_store__.vnodeToPos`。
31. **Svelte 源码只在 dev**：`__svelte_meta` 由 dev 运行时 `assign_location` 设置，生产构建没有；产品里必须能显示“源码不可用”。

## 4. 已改变的计划假设

| 决策 | 原假设 | 当前结论 | 证据 |
|---|---|---|---|
| D3 帧传输 | pull 为 MVP 基线，stream 作为优化 | **stream 为主，pull 回退** | S1 两载体 30 fps、stream 延迟更低、10 min soak 稳定 |
| D5 标注发送 | 右栏可达性待验证 | **公开 slot + `inputActions` 可达**，文本路径通过 | S2 Web/Desktop |
| D6 截图附件 | 找到公开附件路径就启用 | **未找到公开路径；MVP 只用剪贴板** | S2：`createDrafts` 不在 `IConversation`，附件跨会话丢失 |
| S4 源码 | React fiber / Vue `__file` / Svelte `__svelte_meta` | **React 构建期属性 / Vue vnode `__v_inspector` / Svelte `__svelte_meta`** | S4：30/30 命中，React 19 无 `_debugSource`、Vue 属性被移动 |

对应更新：[`tasks/plan.md`](../tasks/plan.md) D3/D5/D6 与 S4 修订、[`docs/SPEC-vibecoding-studio.md`](./SPEC-vibecoding-studio.md) 的可行性/S2 状态、[`tasks/todo.md`](../tasks/todo.md) T001/T002/T004。

## 5. 风险与下一步

- **T004 已完成**：30/30 元素源码命中；点击泄漏 0、Esc、console 均通过；限制是仅 dev 模式、未覆盖 TSX/iframe/重复组件选择器。
- **T005 G0 已通过（GO）**：帧传输 stream 为主/pull 回退；中文主路径 + 逐字/粘贴回退；截图仅剪贴板；源码三框架适配 + 选择器/DOM 降级。证据见 [`spikes/G0.md`](../spikes/G0.md)。
- **T006–T009 已完成**：产品包脚手架、host ESM、client loader bundle、host Config/服务位、contracts v1 均已验证；下一项 T010 client shell。
- **T010 及以后（M1）**：client shell、connection、Vite fixture、profile 安装与清理；按 G0 约束实现 connection/stream/pull。T008 的 `retentionDays`/`contextBudgetBytes`/`screenshotEnabled` 待后续任务消费；T009 的 contracts 由 T010 起实际引用。
- **S2 遗留**：如果上游未来公开附件创建/释放 API，再评估直接截图附件；先复测切会话保留和失败清理。
- **Desktop 遗留**：S2 跨会话未测到，后续需要能稳定创建第二个命名会话的测试环境。
- **成本**：避免无必要的全仓读取和重复验收；每个任务完成即提交、记录、清理进程。

## 6. 恢复检查清单

```bash
git status -sb
pnpm typecheck
pnpm test
pnpm build
pnpm spike:s1
pnpm spike:s2:build
pnpm spike:s3 --seconds 10
pnpm spike:s4
```

1. 读 [`tasks/HANDOFF.md`](../tasks/HANDOFF.md) 确认阶段和下一任务。
2. 读对应 `spikes/*/REPORT.md` 与 `run.md`，不要从零复述旧结论。
3. 检查 4317/9223 端口与后台任务，确保上次 spike 已停止。
4. 需要 Web/Desktop 手测时，只用一次性 `vibe-dev` / 隔离 `DSH_HOME`；真实 `desktop` profile 不动。
5. 每个任务完成后：勾选 `tasks/todo.md`、写验证结果、更新 HANDOFF/本日志、分批提交并确认 CI。

## 7. 证据索引

- S1 传输：[REPORT](../spikes/s1/REPORT.md)。
- S2 composer：[REPORT](../spikes/s2/REPORT.md)、[run.md](../spikes/s2/run.md)。
- S3 screencast/输入/中文：[REPORT](../spikes/s3/REPORT.md)、[results.json](../spikes/s3/results.json)。
- S4 拾取/源码：[REPORT](../spikes/s4/REPORT.md)、[results.json](../spikes/s4/results.json)。
- G0 评审：[G0.md](../spikes/G0.md)。
- 任务与验收：[todo.md](../tasks/todo.md)。
- 技术决策：[plan.md](../tasks/plan.md)、[SPEC](./SPEC-vibecoding-studio.md)。
- 发布检查：[PUBLISHING.md](./PUBLISHING.md)。
- 私有仓库：`https://github.com/niobium617/dsh-vibecode-studio`（当前为 private）。
