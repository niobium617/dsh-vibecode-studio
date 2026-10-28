# Development log

> 项目：DSH Vibecode Studio
> 记录日期：2026-10-27
> 用途：按任务记录开发进度、已验证事实、踩过的坑和恢复入口。
> **验收细节以 `spikes/*/REPORT.md` 为准；恢复会话先读 `tasks/HANDOFF.md`，本页只查当前任务相关段，不必通读。**

## 1. 当前快照

- 阶段：**Phase 4 实现（M0/G0 已通过，M1 已完成，M2 已完成）**。
- 已完成：T001 S1 传输 spike、T002 S2 composer handoff spike、T003 S3 screencast + 输入 + 中文 spike、T004 S4 拾取 + 源码 spike、T005 G0 Spike 评审、T006 包脚手架与工具链、T007 Client bundle loader 包装、T008 Host 插件骨架与 Config、T009 Contracts v1、T010 Client shell + 右栏 tab、T011 Connection 传输骨架、T012 测试 harness + fixture、T013 `.vibe` 配置存储、T014 设置面板（基础）、T015 G1 Foundation 评审、T016 Target 模型/配置/adapter 注册表、T017 Web target adapter（Edge 启动/导航/截图/关闭）、T018 S8 进程生命周期 spike、T019 Dev server 进程监督、T020 Screencast + 帧路由 + canvas、T021 输入转发（点击/滚轮/键盘）、T022 中文输入（隐藏 textarea + `Input.insertText`）、T023 Console 采集与抽屉、T024 Network 采集与抽屉、T025 预览工具栏与生命周期、T026 G2 Preview 评审（通过）、T027 拾取 overlay 与选择器、T028 元素上下文提取、T029 三框架源码适配、T030 标注模型与存储。
- 阶段：**M1 已完成并通过 G1；M2 已完成并通过 G2；M2.5/U01 预览界面精简（Layout v2）已完成**（`3f14d93`；方向见 `docs/2026-10-28-界面与项目方向.md`），**T027 拾取 overlay 与选择器、T028 元素上下文提取、T029 源码适配（React/Vue/Svelte）、T030 标注模型与存储已完成**，下一项 **T031 标注气泡与队列**。
- 产品包已能在 DSH 加载：根 `package.json` 为 `dsh-vibecode-studio@0.1.0`；`lib/index.js`（host ESM）与 `lib/client.js`（loader 包装）由 `pnpm build` 生成，均已 gitignore；`vibe-dev` 中可见 Vibe Studio 右栏 tab，host 提供 `vibeStudio` 服务、校验 Config，并注册 `/api/vibe/health` 与 `/api/vibe/request` 两条精确路由；client transport 已接入设置页（T014），其余页面待后续任务接入。
- T001–T015 已提交并推送至 `origin/task/m1-foundation`（`a1cae3a..1cdcb74`，2026-10-27），随后以 `--no-ff` 合并入 `main`（合并提交 `d1f4053`）并推送，功能分支保留。M2 从 `main` 新建 `task/m2-target-model`；T016–T026 已提交并推送到 `origin/task/m2-target-model`（`ebee1e5`，文档至 `92ecc32`），尚未合并入 `main`；其后 `9c19501..88a4070`（方向/手册文档、U01 实现、去重复标题）已推送到 `origin/task/m2-target-model`（`92ecc32..88a4070`，2026-10-28）；`f64e928`（清理残留 locale key 与过期布局引用）推送后，以 `--no-ff` 合并入 `main`（合并提交 `768e129`，`main` 树与分支一致），功能分支保留。手动复测入口见 `docs/2026-10-28-手动测试手册.md`；界面/产品方向见 `docs/2026-10-28-界面与项目方向.md`。S3/S4/T010/T014/T015/T020/T021/T022/T025 用 Playwright 启动的 Edge/Desktop 在脚本结束时关闭，未留下进程。
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
- 限制：真实系统 IME 未在 DSH Web/Desktop 载体手测（T022 补）；headful 是 Playwright Edge 而非 Electron，不能替代 Desktop 输入栈证据；输入→新帧到达未联合测量（T021 只测了请求延迟与目标 DOM 副作用，留后续联合测量）。
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

### T010 — Client shell + 右栏 tab（已完成）

- 目标：替换 T007 hello 面板，注册并填充右栏 `Vibe Studio` tab（keepMounted、全屏、guide）；内部占位页签与空/错/加载状态；i18n 骨架。
- 结果：
  - `src/client/shell/StudioShell.tsx`：标题/副标题、四个内部页签（预览/检查/标注/API）、`role=tablist/tab/tabpanel` 与 `aria-selected`，页面占位用统一空状态。
  - `src/client/shell/store.ts`：模块级 `useSyncExternalStore` 状态，`keepMounted` 之外再保证强制卸载/重开后仍停留在原页签；`resetShellStore()` 供测试隔离。
  - `src/client/shell/StateViews.tsx`：`LoadingState`（`role=status`）、`EmptyState`、`ErrorState`（`role=alert` + 重试）与 `ShellErrorBoundary`，页面崩溃只影响面板。
  - `src/client/locales/{en,zh-CN}.json` + `src/client/i18n.ts`：`translate()` 按 locale → en → key 回退，`{name}` 插值，`detectLocale('zh*') → zh-CN`；默认 en，浏览器语言由 `browserLocale()` 读取。JSON 由 esbuild 内联进 client bundle。
  - `src/client/index.ts` 改用 `StudioShell`，tab 标题/guide 描述走 `translate`；删除 `src/client/hello.tsx`。
  - 测试依赖新增 devDependencies：`jsdom`、`@testing-library/react`、`@testing-library/dom`（仅测试，不进 bundle）。
- 验证：
  - `pnpm exec vitest run tests/component/shell` → 3 文件 / 13 用例；全量 `pnpm test` → 11 文件 / 57 用例；`pnpm typecheck` 0 error。
  - `pnpm build` → host 2.4 KiB、client 12.0 KiB（含 shell + 两份 locales）。
  - `vibe-dev` + headless Edge（4321/4323）：guide 卡片打开 tab；页签 预览→检查→标注 切换与面板文案正确；点“全屏”再 Esc，标注仍选中；收起右侧栏再展开、关闭 tab 后重新打开，标注页签均保留；client.js 200；console/pageerror 0。
  - 证据脚本：`.tmp/t010-verify.mjs`、`.tmp/t010-persist.mjs`（gitignored，一次性验证，不属于产品）。
- 限制：切 Session 未单独脚本化（与收起/重开共用 `keepMounted` 机制）；locale 在 `apply()`/渲染时读取，运行中切换系统语言需重载页面。

### T011 — Connection 传输骨架（已完成）

- 目标：host 用 `ctx.connection.fetch.register` 注册精确 `/api/vibe/*` 路由（health + 一元请求），client 用文档相对 `fetch`；不用 `rpc.handle`；Web/Desktop 都通。
- 结果：
  - `src/contracts/transport.ts`：共享 `TRANSPORT_VERSION`、`/api/vibe/health`、`/api/vibe/request`、64 KiB 上限、10 s 默认超时、请求/成功/失败信封与运行时校验；`appRoute()` 去掉前导 `/`，供客户端使用。
  - `src/host/transport/unary.ts`：`UnaryRegistry` 方法表（内置 `studio.ping`），拦截重复/非法方法名；`StudioError.code` 映射 HTTP 状态，未知异常统一 500 `internal`（不泄漏实现细节）。
  - `src/host/transport/routes.ts`：health 仅 GET（405 + `allow`），unary 仅 POST，要求 `application/json`（415），`content-length` 与实际 UTF-8 字节双重 64 KiB 限制（413），JSON/对象/未知键/方法/id 逐项校验，所有响应带 `no-store`/`nosniff`，序列化失败也回信封。
  - `src/host/transport/index.ts` + `src/host/index.ts`：`registerTransport()` 通过 `ctx.effect` 注册两条路由并返回 registry；`apply()` 把 `{ config, transport }` 放进 `vibeStudio` 服务。
  - `src/client/transport/*`：`fetchHealth()`/`callUnary()` 使用 `api/vibe/...` 文档相对路径与 `credentials: 'same-origin'`；调用方 signal + 超时合并；HTTP/信封锁错误映射为稳定 `StudioError`；请求前本地校验方法名、可序列化与大小，避免无效流量。
  - `tests/helpers/fake-host.ts`：测试用 Connection/effect 替身；host 15 例、client 11 例集成测试。
- 验证：
  - `pnpm typecheck` 0 error；`pnpm exec vitest run tests/integration/transport` 2 文件 / 26 用例；全量 `pnpm test` 13 文件 / 83 用例；`pnpm build` host 11.8 KiB / client 12.0 KiB。
  - `vibe-dev` + `.tmp/t011-disable-spikes.yml`（launch overlay 临时禁用 s1/s2 的同路径路由，不改 profile 文件）+ raw `node:http`：9/9——无 cookie `GET /api/vibe/health` 401；token 303 + `Set-Cookie`；认证 health 200（plugin/version/uptime/config）；`Origin: http://evil.example` 403；`Host: evil.example` 403；认证 `studio.ping` 200 且 echo 正确；`text/plain` 415。
  - headless Edge（4325）：页面 `baseURI=http://127.0.0.1:4325/`，注入 client transport 探针后请求为 `api/vibe/health`、`api/vibe/request`（文档相对），health 与 ping（echo `{source:'web'}`）成功，未知方法得到 `not_found/404`，除该预期 404 外 console 0。
  - 隔离 Desktop（`DSH_HOME=.tmp/desktop-home`、独立 userData、loopback CDP 9223）：`origin=dsh-app://app`，请求为 `dsh-app://app/api/vibe/health` 与 `.../request`，health/ping 成功（echo `{source:'desktop'}`），console 0；脚本结束 `taskkill /T` 清理进程树。
  - 证据脚本：`.tmp/t011-auth.mjs`、`.tmp/t011-web.mjs`、`.tmp/t011-desktop.mjs`、`.tmp/t011-probe.js`（gitignored，一次性验证）。
- 限制/决策：
  - 未认证 401、跨源/Host 403 由 DSH Connection 的 `/api` 桥提供，插件不重复鉴权；插件只做精确路由与参数校验。
  - client transport 尚未接入 `src/client/index.ts`，`lib/client.js` 仍只有 shell（12.0 KiB）；按 T011 文件边界留待后续 UI 任务接线。
  - s1/s2 spike 仍在 `vibe-dev` 的依赖与 bundle 列表中；本次只用 `--patch` 临时覆盖，未改真实 profile，也未删除 spike 包。

### T012 — 测试 harness + fixture（已完成）

- 目标：Vitest / React Testing Library / Playwright 配置；Vite fixture 骨架；假 adapter。
- 结果：
  - `vitest.config.ts` 改为两个 project：`node`（smoke、unit、integration）与 `component`（jsdom、`tests/setup/component.ts` 统一 `cleanup()`）。`passWithNoTests` 只能放在根级。
  - `playwright.config.ts`：`testDir: tests/e2e`、`channel: 'msedge'`、headless、1280×800、单 worker、失败截图/trace 写入 `.tmp/playwright-results`；`webServer` 用 `pnpm fixture:dev` 自动启动 fixture，`reuseExistingServer` 仅本地开启。
  - `fixtures/vite-basic/`：React 19 + Vite 8 骨架，含计数器、可提交表单（Name/Note）、列表、控制台错误按钮，以及 dev 插件路由 `POST /api/echo`、`GET /api/boom`（500）、`GET /api/slow?ms=`；`pnpm fixture:dev` 监听 `127.0.0.1:4320`（strictPort）。
  - `tests/helpers/fake-adapter.ts`：harness 用目标 adapter 生命周期替身（并发 start 合并、重复 start 复用、stop 幂等、失败态保留），`tests/integration/targets/fake-adapter.test.ts` 6 例；T016 已将其对齐真实 `TargetAdapter` 契约。
  - `tests/e2e/fixture.spec.ts`：3 例（首屏/计数、中文表单、fixture API）。
  - `package.json` 新增 `test:e2e`、`fixture:dev`；`tsconfig.json` 纳入 `fixtures/**` 与 `playwright.config.ts`。
- 验证：
  - `pnpm typecheck` 0 error；`pnpm test` 14 文件 / 89 用例通过；`pnpm exec vitest run tests/component/shell` 3 文件 / 13 用例通过；`pnpm build` 通过（host 11.8 KiB / client 12.0 KiB）。
  - `pnpm test:e2e` 3/3 通过（3.7 s）；fixture 由 Playwright 自动拉起，结束后 4320 无 LISTENING，仅剩客户端 TIME_WAIT。
  - 首次 E2E 因浏览器请求缺失的 favicon 得到 404、污染 console 断言而失败 1 例；补 `<link rel="icon" href="data:," />` 后全绿。
- 限制/决策：
  - `@types/react-dom` 解析为 18.0.0（与现有 `@types/react` 18.3 同主版本），fixture 只用 `createRoot`，暂不升级。
  - `@playwright/test` 固定 1.64.1，与本机 `playwright-core` 一致；使用系统 Edge，不下载浏览器，因此 CI（ubuntu）暂不跑 E2E。
  - 组件测试文件仍保留显式 `// @vitest-environment jsdom` 与 `cleanup()`，与 harness 重复但无害；后续新测试可省略。

### T013 — `.vibe` 配置存储（已完成）

- 目标：`studio.json` 读写、原子写、校验、默认值、坏数据回退。
- 结果：
  - `src/host/studio/store.ts`：`StudioStore` / `createStudioStore()`，固定 `<project>/.vibe/studio.json`，`STUDIO_FILE_VERSION = 1`，上限 256 KiB。
  - 读取：缺失目录/文件返回 `status: 'missing'` + 默认值；坏 JSON、不支持的版本、超大文件、字段非法返回 `status: 'invalid'` + 默认/回收值 + `issues`，不抛异常、不改写原文件。字段级回收只替换非法项，合法项保留。
  - 校验：手写 `parseStudioDocument` / `parseStudioSettings`（不使用第二套 schema runtime），复用 `normalizeOrigin()` 归一化并去重 origin，`retentionDays` 1–365、`contextBudgetBytes` 1024–65536，未知键记为 issue。
  - 写入：先校验（失败抛 `invalid-document` 且不建目录），再在 `.vibe` 的 **真实路径** 内创建 `wx` 临时文件、`rename` 原子替换；失败清理临时文件。
  - 路径限定：对项目根、`.vibe`、`studio.json` 分别 `realpath`，用 `relative()` 判断包含关系；`.vibe` 为指向项目外的 junction/symlink 时读写均抛 `path-outside-project`。
- 验证：
  - `pnpm typecheck` 0 error；`pnpm exec vitest run tests/unit/studio-store` 1 文件 / 10 用例通过；全量 `pnpm test` 15 文件 / 99 用例通过；`pnpm build` 通过（host 11.8 KiB / client 12.0 KiB，store 尚未被入口引用）。
  - 用例覆盖 round-trip + origin 去重 + 末尾换行、缺文件、坏 JSON 保留原文件、字段级回收、版本不支持、未知键、非法写入不落盘、超大文件、`.vibe` junction 逃逸、项目目录缺失；临时目录在 `.tmp/studio-store-*`，检查无残留。
- 限制/决策：
  - store 尚未接入 `src/host/index.ts` 与 UI，T014 设置面板再接服务读取同一文档。
  - `write()` 的 `document` 参数类型是 `StudioDocument`，运行期仍走手写校验；非法值在测试里用断言强行传入。

### T014 — 设置面板（基础）（已完成）

- 目标：origin 允许列表、保留期、上下文预算、截图开关、日志级别；UI 改动持久化，服务读取同一配置，非法值有提示。
- 结果：
  - `src/contracts/settings.ts`：`studio.settings.get/update` 方法名、字段枚举、范围常量（保留期 1–365、预算 1024–65536）、快照/参数守卫；contracts 仍无运行时依赖。
  - `src/host/studio/settings.ts`：`createStudioSettingsService()` 惰性读一次 `StudioStore`；文件缺失时沿用 profile `Config`，文件有效或可回收时把文档值应用到 **同一个** `VibeStudioConfig` 对象（health 直接读取它），因此 UI 与服务同源。`update()` 先合并 patch，再走 `parseStudioSettings()` 严格校验；非法值抛 `invalid_input` + `issues`，不写文件；成功后 `StudioStore.write({ version: 1, settings })` 原子持久化并立即应用。
  - `registerSettingsMethods()` 把两个方法注册到 T011 的 `UnaryRegistry`，返回幂等注销函数；`src/host/index.ts` 在 `ctx.effect` 中接线，`vibeStudio` 服务新增 `settings`。
  - `src/client/shell/settings/*`：`transportSettingsApi` 走 `callUnary` + 快照守卫；`SettingsPage` 用草稿字符串编辑数字、本地校验范围/空 origin、Host `issues` 分组到字段、保存后 `role="status"` 显示“已保存”；加载失败可重试，`missing`/`invalid` 显示状态提示。
  - 右栏新增第 5 个 `settings` 页签，`en`/`zh-CN` 文案齐全；`StudioShell` 在 `settings` 页渲染 `SettingsPage`。
- 验证：
  - `pnpm typecheck` 0 error；聚焦 3 文件 / 19 用例通过（设置服务 7、设置页 7、shell 页签 5）；全量 `pnpm test` **17 文件 / 114 用例**通过；`pnpm build` 通过（host 25.8 KiB / client 36.8 KiB）。
  - 手动（`.tmp/t014-verify.mjs`，`vibe-dev` + headless Edge，`--patch .tmp/t014-profile-patch.yml` 临时禁用 s1/s2 同路径路由，端口 4322）：首轮显示默认值 + “尚未保存”；保存 retentionDays 14 / contextBudgetBytes 16384 / 新增 `http://localhost:5173` / 关闭截图 / logLevel debug 后，`.vibe/studio.json` 为 `version: 1` 且值一致，`api/vibe/health` 返回同一组 `config`（plugin 为 `dsh-vibecode-studio`）；把 retentionDays 改成 0 出现字段提示、文件保持 14；重启 DSH 后设置页回填保存值、无提示；两轮 console 0。
  - 测试生成的 `.vibe/` 已删除；4322/4323/4324 仅 TIME_WAIT，无 dsh/Edge 进程残留。
- 限制/决策：
  - M1 的项目根取 Host 进程 `process.cwd()`：`apply()` 阶段没有工作目录/会话绑定，暂不加 `projectDir` 配置项；M2 预览目标解析工作区目录时再收紧。
  - `<form>` 必须带 `noValidate`：否则浏览器原生 `min` 校验会拦截提交，组件内翻译后的字段提示不会出现。
  - `vibe-dev` 自带的 s1/s2 spike 也注册 `/api/vibe/health`，同时启用会让 studio Host 注册路由时报 “already registered” 并整体不激活；手动验证沿用 T011 的做法，用 `--patch` 临时禁用，不改 profile（T015 已改为在 profile patch 层持久禁用）。

### T015 — G1 Foundation 评审（已完成，GO）

- 目标：干净 `vibe-dev` 安装、tab 可见、health 通、全量检查；Web/Desktop 均可开 tab，且不改 `desktop` profile。
- 结果：
  - 根因处理：`vibe-dev` 的 `vibe-s1-spike`/`vibe-s2-spike` 与 studio 都注册 `/api/vibe/health`，导致 studio `apply()` 在路由注册处抛 “already registered” 并整体不激活。按 T011 的验证结论，在 `vibe-dev/cordis.patch.yml` 的 patch 层为两个 spike 增加 `disabled: true`；包仍安装，删除这两项即可恢复。改前备份 `.tmp/logs/vibe-dev-cordis.patch.yml.bak-2026-10-27`。
  - 不带 `--patch` 启动后：`studio.ping`、`studio.settings.get` 均 200，`update` 无参返回 400 `invalid_input`（方法已注册），health 返回 `plugin: dsh-vibecode-studio`。
  - Web（headless Edge，4327）：guide 打开 Vibe Studio，5 页签（预览/检查/标注/API/设置），设置页回填默认值 + “尚未保存”，health 同源，console 0。
  - Desktop（真实 Electron `dsh-app://app`，隔离 `DSH_HOME=.tmp/desktop-home`，CDP 9223）：网络就绪后 UI 进入主界面，点击侧栏 Vibe Studio 入口，5 页签 + 设置页正常；`desktop` profile 关键文件前后 SHA-256 一致（`850eb268…3b6a7c`）。2 条 503 是 Host 就绪前的预热轮询噪声，无其他 console 错误。
- 验证：
  - `pnpm typecheck` 0 error；`pnpm test` 17 文件 / 114 用例；`pnpm build` host 25.8 KiB / client 36.8 KiB；`pnpm test:e2e` 3/3。
  - 脚本 `.tmp/t015-web.mjs`、`.tmp/t015-desktop.mjs`（Desktop 报告存 `.tmp/logs/t015-desktop.json`，`ok: true`）。
  - 结束后 4320/4327/9223 无 LISTENING，无 dsh/Desktop/Edge 残留，未生成 `.vibe`。
- 结论：**G1 通过（GO）**，M1 完成，进入 M2（T016 起）。

### M1 合并入 `main`（已完成）

- 目标：把 M1 成果纳入默认分支，使 `main` 与开发状态一致；顺便让贡献图计入这批提交。
- 结果：
  - 合并前 `main` 为 `221f118`（M0 收尾），是 `task/m1-foundation` 的祖先（领先 18 / 落后 0），可 fast-forward。
  - 按里程碑边界保留合并点：`git merge --no-ff task/m1-foundation -m "merge: M1 foundation (T006-T015, G1)"`，生成 `d1f4053`，零冲突。
  - `git push origin main` → `221f118..d1f4053 main -> main`；`task/m1-foundation` 本地与远端均保留，未删。
- 验证：
  - `git ls-remote origin main` 返回 `d1f4053e2b13…`，与本地 `git rev-parse main` 一致；`git status -sb` 为 `## main...origin/main`，工作区干净。
  - GitHub 贡献图：10-26 由 3 → 17、10-27 由 0 → 5，私有贡献合计 10 → 29（18 条 M1 提交 + 1 条合并提交全部计入）。
- 经验：
  - GitHub 贡献图按**提交自带的时区偏移**归属日期，不是 UTC。M1 凌晨 01:37–01:50（+0800）的 4 条提交落在 10-27 那格，而不是 UTC 的 10-26，实测数据推翻了“按 UTC 算”的假设。
  - 私有仓库的提交只有在 profile → Contribution settings → **Private contributions** 打开后才计入，且只显示匿名格子、不显示仓库名；开关关闭时 `restrictedContributionsCount` 为 0，容易误判成“推送失败”。
  - 默认分支之外的提交（如 `task/m1-foundation`）无论是否推送成功都不计入贡献图，合并进 `main` 后才计入。

### T016 — Target 模型、配置与 adapter 注册表（已完成）

- 目标：目标配置校验、能力声明、adapter 注册、假 adapter、错误码。
- 结果：
  - `src/host/targets/types.ts`：`TargetAdapter` 契约（`id`/`kind`/`capabilities`，必选 `start`/`stop`，可选 `navigate`/`screenshot`）、`ValidatedTargetConfig`（viewport 已归一）、`DEFAULT_VIEWPORT` 1280×720@1、`assertCapability`（未声明能力抛 `unsupported`）。
  - `src/host/targets/validate.ts`：纯校验，返回归一化配置；id 走 `isTargetId`，name/command/cwd/url 长度与空值校验，url 仅 http(s) 且禁凭证、cwd 必须绝对路径、port 1–65535、viewport 64–7680/DSF 0.1–4；未知键、对象形状错误均 `invalid_config` + `details.field`；`url` 与 `command` 至少一项，`api` 必须有 url。
  - `src/host/targets/registry.ts`：每个 target kind 仅一个 adapter；重复 kind/id、缺 capability、非函数 `navigate`/`screenshot` 均 `invalid_config`；未知 kind 报 `unsupported: unknown target adapter "<kind>"`，已知但未注册报 `no target adapter registered for kind "<kind>"`；unregister 幂等且不会误删后注册的新 adapter。
  - `apply()` 在 `vibeStudio` 服务槽新增空 `targets` registry，T017+ 注册真实 adapter；未注册前的查找会得到明确 `unsupported`，不会返回 undefined。
  - `tests/helpers/fake-adapter.ts` 改为实现真实契约，保留 `status`/`sessions`/`logs` 供集成测试观测；`start()` 仍兼容直接传 URL 字符串。
- 验证：
  - `pnpm exec vitest run tests/unit/targets`：3 文件 / 21 用例通过（validate 9、registry 6、fake lifecycle 6）。
  - `pnpm typecheck` 0 error；全量 `pnpm test` 20 文件 / 135 用例通过；`pnpm build` host 34.6 KiB / client 36.8 KiB。
  - `tests/unit/config.test.ts` 的服务槽断言同步增加 `targets`。
- 计划偏差：无；文件与 `tasks/todo.md` 一致，仅额外在 `src/host/index.ts` 暴露 registry（服务槽接入）。

### T017 — Web target adapter（已完成）

- 目标：Playwright 启动 Edge（`channel: 'msedge'`）；导航、viewport、截图、关闭；暂不做 screencast。
- 结果：
  - `src/host/targets/web/launch.ts`：`playwright-core` 懒加载（缺失 → `target_unavailable`），`launchEdge()` 只用本机 Edge、默认 headless；错误映射 `toStartError`（`Chromium distribution 'msedge' is not found` / `Executable doesn't exist …msedge` → `target_unavailable`，消息不含本机路径；其他 → `preview_failed`）、`toNavigationError`（`Timeout … exceeded` → `timeout`，`net::ERR_CONNECTION_*` → `target_unavailable`，其他 → `preview_failed`）、`toScreenshotError`（`preview_failed`）。
  - `src/host/targets/web/adapter.ts`：`createWebTargetAdapter()` 实现 `TargetAdapter`；start 合并并发调用、成功后 session `ready`、失败清理并 `failed`、stop 幂等且 session 置 `closed`；上下文使用归一化 viewport + `colorScheme: 'light'`；`navigate()` 成功后更新 session url；`screenshot()` 返回 viewport 大小 PNG（禁用动画、隐藏光标）；默认只允许 loopback（非本地 → `permission_denied`，`allowNonLocal` 才放开），非 http(s) scheme → `unsupported`；能力只声明 `screenshot`。
  - `apply()` 注册 web adapter；`src/host/index.ts` 导出 adapter/launcher 与错误映射；`tests/helpers/png.ts` 提供无依赖的 8-bit RGB/RGBA PNG 解码（含 5 种 filter），用于像素级截图断言。
- 验证：
  - `pnpm exec vitest run tests/integration/web-adapter`：2 文件 / 13 用例通过（真实 Edge + 临时端口 Vite fixture；错误映射与 guard 用注入 launcher）。
  - 真实截图 800×600：左上角白底、全文 >1000 深色文字像素、顶部 120 px >200；`navigate('…?tab=one')` 后 `adapter.url` 与 session url 同步；不可达本地端口导航返回 `target_unavailable` 且 session 保持 `ready`。
  - 关闭：`browser.isConnected() === false`，5 s 内无带 `playwright_chromiumdev_profile` 的 `msedge.exe`；停后可再次启动为 `fixture-2`，两个浏览器均已断开。
  - Edge 缺失：真实调用 Playwright 指向不存在的 `msedge.exe`，其“Executable doesn't exist …”被识别为 `target_unavailable`；模拟缺失 channel 同样映射。
  - `pnpm typecheck` 0 error；全量 `pnpm test` 22 文件 / 148 用例；`pnpm build` host 43.4 KiB / client 36.8 KiB（`playwright-core` 保持动态 import）；`pnpm test:e2e` 3/3。
- 计划偏差：文件按 `tasks/todo.md`；另在 `apply()` 注册 adapter、在 `src/host/index.ts` 增加导出、新增 `tests/helpers/png.ts`。`playwright-core` 仍是 devDependency，打包任务需转为运行时依赖。

### T018 — S8 进程生命周期 spike（已完成）

- 目标：Vite 启动、端口探测、Windows 进程树清理、端口冲突；只测量，不写 supervisor。
- 结果：
  - `spikes/s8/run.ts` 用真实 Vite 8.3.5 + `fixtures/vite-basic` 串行跑五组场景：空闲端口探测 5 次、3 次冷启、直接 kill、`taskkill /T /F`、`cmd.exe` 中转孤儿、占用端口冲突。
  - 启动就绪：TCP ~380–410 ms、HTTP 200 ~393–469 ms（9 次 spawn 中位 417 ms），ready 日志 362–380 ms；10 s 预算余量充足。
  - 停止：直接 `child.kill()` 14–15 ms 且 0 存活；`taskkill /T /F` 435–598 ms 且 3/3 无存活；结束后残留进程 0、监听端口 0。
  - 孤儿：`node → cmd.exe → node(vite)` 只杀 cmd 时 1 个 vite node 存活并继续占用端口，按记录 PID + 命令行匹配直接强杀后清零。
  - 端口冲突：`--strictPort` + 占用端口 → exit 1、366–484 ms、stderr `Error: Port <port> is already in use`。
  - `IsProcessInJob` 实测 Node 24 的非 detached 子进程在 job object 内；作为现象记录，不作为 T019 的实现依赖。
- 验证：`pnpm tsx spikes/s8/run.ts` 输出 `overall: PASS`；`pnpm exec tsc --noEmit` 0 error；原始数据 `.tmp/logs/s8-results.json`；结论见 `spikes/s8/REPORT.md`。
- 计划偏差：无；`spikes/s8/` 仅 `run.ts` 与 `REPORT.md`，结果 JSON 写到 `.tmp/logs/`。

### T019 — Dev server 进程监督（已完成）

- 目标：按 S8 结论实现 supervisor：spawn、日志 ring buffer、健康检查、停止、Windows tree kill。
- 结果：
  - `src/host/targets/process/supervisor.ts`：可注入 spawn/HTTP 探测/进程列举/树杀/端口探测/时钟；严格校验 spec（绝对 command/cwd、端口范围、loopback URL，非本地 `permission_denied`）；`shell:false` + `windowsHide:true`；HTTP 就绪轮询（50–100 ms，10 s 预算）；稳定错误映射（端口冲突/提前退出 `preview_failed`、超时 `timeout`、spawn 失败/abort `target_unavailable`）；并发 start 合并、ready 幂等、失败可重试、重启清空日志。
  - 停止：先记录后代 PID，Windows `taskkill /PID <root> /T /F`；等待退出后 grace 再列举，按 PID + 命令行精确匹配补杀（防止 PID 复用误杀），返回 survivors 并校验端口释放（5 s）。启动失败且子进程已自行退出（典型为端口冲突）时跳过端口释放验证，避免把别人的端口误报成停止失败并省掉 5 s 等待。
  - `src/host/targets/process/logs.ts`：500 条 / 64 KiB / 单行 2000 字符环形缓冲，按流拆半行、去 ANSI、seq 单调、支持 `after`/`limit`；`clear()` 重置。
  - `src/host/index.ts` 导出 supervisor、校验函数与日志 API。
- 验证：
  - `pnpm exec vitest run tests/integration/supervisor`：2 文件 / 23 用例通过（全部假进程）。
  - 全量 `pnpm exec vitest run`：24 文件 / 171 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 67.4 KiB / client 36.8 KiB。
  - 手动 `.tmp/t019-manual.ts`（真实 Vite 8.3.5 + `fixtures/vite-basic`，结果 `.tmp/logs/t019-manual.json`，`pass: true`）：启动 ready 532 ms、日志含 `Local:`/`ready at`；重启 run=2、PID 变化、旧日志已清；停止 `portReleased:true`、`survivors:[]`、端口关闭、无残留 node.exe；端口冲突约 1.6 s 返回 `preview_failed`/`port_in_use`；结束后无 Vite 进程与监听端口。
- 计划偏差：新增 `tests/helpers/fake-dev-server.ts` 与 `tests/integration/supervisor/` 下的日志/监督用例；无新增依赖。

### T020 — Screencast + 帧路由 + canvas（已完成）

- 目标：CDP `Page.startScreencast` 限速取帧；host 保留最新帧 + 单调 seq；`/api/vibe/stream`（multipart JPEG）为主、`/api/vibe/frame?wait=1&after=<seq>` 为回退；client canvas 渲染；断流切 pull、恢复切回 stream。
- 结果：
  - `src/host/preview/frame-buffer.ts`：只保留最新 JPEG，seq 单调；waiter/subscriber 取消或停止时清理，长轮询在 abort 时返回 204。
  - `src/host/preview/screencast.ts`：收到帧立即 `Page.screencastFrameAck`，base64 解码后做 4 MiB 上限与 SOI 校验，latest-wins；按绝对 deadline 限速（10 ms 轮询、30 fps、quality 70），避免 setTimeout 漂移；停止时清空缓冲。
  - `src/host/preview/route.ts`：multipart 流带 `Content-Length` 与 `X-Vibe-Seq/Ts/Width/Height`，停止时写结束边界；pull 路由支持 `wait`/`after` 校验（400）、未运行 503、无新帧 204；preview 服务 `start/stop/status` 串行化，状态快照含 fps/quality/lastError。
  - `src/client/preview/transport.ts`：stream 为主，失败/结束切 pull（2 s 退避）并每 5 s 探测 stream；seq 去重保证切换不重复、不回退；解析器增量处理分块、前导、结束边界与非法元数据。`Canvas.tsx` 用 `createImageBitmap` + 单绘制循环合并最新帧，绘制后 `bitmap.close()`，画布尺寸取自帧元数据。
- 验证：
  - `pnpm exec vitest run tests/integration/frames`：4 文件 / 28 用例通过；全量 28 文件 / 199 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 88.2 KiB / client 58.1 KiB。
  - 手动 Web（`.tmp/t020-web.mjs`，DSH 4328 + 动态回环页，`.tmp/logs/t020-web.json`，`ok:true`）：abort `/api/vibe/stream` → 轮询 25.3 fps、1280×720/12 色；解除后 5 s 内回流失、25.3 fps、13 色；25 s 浸泡 host RSS 最后 5 s +24 KB（稳态 +4.3 MB）、浏览器堆 +190 KB；目标 Edge 全部退出，真实 `desktop` profile 未改。
  - 手动 Desktop（隔离 `DSH_HOME=.tmp/desktop-home` + 独立 userData、CDP 9223，`.tmp/t020-desktop.mjs`，`.tmp/logs/t020-desktop.json`，`ok:true`）：`dsh-app://app` 5 页签，流式 25.7 fps、1060 帧、1280×720/13 色、渲染器堆 +49 KB、Electron 进程树 RSS 无增长；停止后 Edge 全退出，真实 profile 未改；console 仅有预热 503 与预期中止。
- 计划偏差：手测发现并修复 detached `window.fetch` 在 Chromium 抛 `Illegal invocation` 导致 Web 无帧；未新增依赖。Desktop 未单独模拟断流（回退由 Web 覆盖）。

### T021 — 输入转发（点击/滚轮/键盘）（已完成）

- 目标：通过 CDP `Input.*` 转发点击、滚轮与键盘；坐标按视口比例映射；支持修饰键；端到端延迟 < 200 ms。
- 结果：
  - `src/contracts/transport.ts` 新增 `PreviewInputEvent`（pointer/wheel/key）与 `isPreviewInputEvent` 严格校验：拒绝未知键、NaN/越界坐标、非法 action/button、clickCount 不在 1–3、|delta| > 2000、key 长度 0 或 > 32、非法 code、text 长度 1–32、非布尔 modifiers。
  - `src/host/preview/input.ts`：懒建单一 CDP 会话；按实时 viewport 把 [0,1] 映射为 CSS px，四舍五入并夹到 width−1/height−1；维护按下按钮集合，move 与 release 都带正确 `buttons` 位掩码（释放发 0）；modifiers 转 CDP 位掩码（alt=1/ctrl=2/meta=4/shift=8）；命中键表覆盖 Enter/Tab/方向键/修饰键等，可打印键带 `text`/`unmodifiedText` 与虚拟键码；串行队列保证 press 先于 release；`stop()` 级联 detach 且幂等，错误统一 `target_unavailable`（`stopped`/`no_viewport`/`cdp_session`/`cdp_failed`，不回显 Playwright 文本）。
  - 路由复用 unary `preview.input`（`/api/vibe/request`），未新增精确路由；Web adapter 能力补 `input: true`，真实 Edge 集成断言同步改为 `true`。
  - `src/client/preview/InputLayer.tsx`：canvas 上的透明覆盖层，点击聚焦、best-effort pointer capture、原生非 passive wheel 监听、IME 组合期按键忽略；`InputForwarder` 单飞行请求 + 合并排队 move + 队列上限 64，卸载/停止 `dispose`；`Canvas` 在 ready 时挂载覆盖层与输入提示，en/zh-CN 文案补齐。
- 验证：
  - `pnpm exec vitest run tests/integration/input tests/component/preview`：3 文件 / 23 用例通过；全量 `pnpm test`：31 文件 / 222 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 99.1 KiB / client 66.0 KiB。
  - 手动 Host（`.tmp/t021-host.mjs`，真实 Edge + Vite fixture，`.tmp/logs/t021-host.json`，`ok:true`）：点击后焦点 `INPUT#item-name`、键入 `hello`、计数器 `Count: 1`、滚轮 scrollY 0→347；15 次派发最大 26.3 ms / 平均 4.7 ms；停止后目标 Edge PID `[]`。
  - 手动 Web（`.tmp/t021-web.mjs`，DSH 4331 + 回环表单 beacon 页，`.tmp/logs/t021-web.json`，`ok:true`）：覆盖层与 canvas 同为 615×345.9 @ (809,234.2)；点击后覆盖层持焦，目标收到 focus 与 h/he/hel/hell/hello；click 计数 1、scrollY 500；18 个 `preview.input` 全部 HTTP 200，端到端最大 39.3 ms / 平均 13.1 ms；目标 Edge 全退、真实 `desktop` profile SHA-256 未变、无意外 console error。
  - 手动 Desktop（隔离 `DSH_HOME` + 独立 userData，CDP 9223，`.tmp/t021-desktop.mjs`，`.tmp/logs/t021-desktop.json`，`ok:true`）：覆盖层与 canvas 同为 543.3×305.6；focus/输入/点击/滚动均达目标；18 个请求全部 200，最大 14.3 ms / 平均 9.4 ms；目标 Edge 全退、真实 profile 未改。
- 计划偏差：输入走 unary 而非新路由；未新增依赖。Desktop 自动化按 25 ms/字符合成键入时目标只收到首字符，150 ms/字符全部到达；Web 25 ms 与 host 直连连续按键正常，判断为 Desktop 载体下 Edge 对过密合成键事件的合并/节流，真实输入不受影响，留 T022 真 IME 手测复核。

### T022 — 中文输入（已完成）

- 目标：隐藏 textarea 接收 `compositionstart/update/end`，只把最终文本经 `Input.insertText` 送入目标；失败时展示明确限制提示。
- 结果：
  - `src/contracts/transport.ts`：新增 `{kind:'text', text}` 事件与 `isInsertableText`（非空、最多 1024 码点、拒绝孤立代理、只允许 `kind`/`text` 两键），`isPreviewInputEvent` 走同一严格校验。
  - `src/host/preview/input.ts`：`text` 事件优先 `Input.insertText`；被拒时按码点用 `dispatchKeyEvent`（keyDown 带 `text`/`unmodifiedText` + keyUp）回退，最多 256 码点；两条路径都失败统一 `target_unavailable` / `insert_text_failed`，错误不包含用户文本。
  - `src/client/preview/ImeInput.tsx`：1px、`opacity:0`、非 `display:none` 的可聚焦 textarea；只在 `compositionend` 提交，组合中间态与 `Process` 键不转发；emoji/代理对按码点计数；`Ctrl/Cmd+V` 交给 textarea 的 paste 处理并整段转发；失活时清空值与组合状态。
  - `src/client/preview/InputLayer.tsx`：点击时把 textarea 移到覆盖层内点击点并聚焦；文本发送失败设置独立 `role="status"` 提示（逐字输入或粘贴），不清空通用错误通道；组合开始即清除提示。
  - en/zh-CN 补齐 `preview.input.ime.label/failed` 文案；未新增路由，复用 `preview.input` 与 `InputForwarder`。
- 验证：
  - `pnpm exec vitest run tests/integration/input tests/component/preview`：4 文件 / 39 用例通过；全量 `pnpm test`：32 文件 / 238 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 100.5 KiB / client 72.2 KiB。
  - 手动 Host（真实 Edge + Vite fixture，`.tmp/t022-host.mjs`，`.tmp/logs/t022-host.json`，`ok:true`）：一次 text 事件后 `#item-name` 值为 `你好，世界`，3 次派发最大 8.6 ms / 平均 6.9 ms，停止后 Edge 全退。
  - 手动 Web（DSH 4332 + 回环表单，CDP `Input.imeSetComposition`→`Input.insertText`，`.tmp/t022-web.mjs`，`.tmp/logs/t022-web.json`，`ok:true`）：点击后隐藏 TEXTAREA 持焦；组合中间态无 text 请求、无目标 input；提交后仅 1 个 `{kind:'text',text:'你好，世界'}`，textarea 清空；强制 text 请求 500 后目标不变并出现中文限制提示（无 alert），解除后恢复；paste 整段送达；最大 15.7 ms / 平均 8.1 ms；目标 Edge 全退、真实 `desktop` profile 未变、无意外 console error。
  - 手动 Desktop（隔离 `DSH_HOME` + 独立 userData，CDP 9223，`.tmp/t022-desktop.mjs`，`.tmp/logs/t022-desktop.json`，`ok:true`）：同一流程通过；200 请求最大 59.6 ms / 平均 16.7 ms；目标 Edge 全退、真实 profile 未改。
- 计划偏差/限制：自动化使用 CDP IME 模拟组合，未替代 Microsoft Pinyin 系统级手测；Desktop 的 500 注入通过渲染进程 fetch 包装完成（`dsh-app://` 不能被 Playwright route 拦截），未改产品代码。

### T023 — Console 采集与抽屉（已完成）

- 目标：CDP `Runtime.consoleAPICalled` / `exceptionThrown`；有界 ring buffer；UI 过滤与清空。
- 结果：
  - `src/contracts/transport.ts`：新增 `preview.console.list` / `preview.console.clear` 一元方法与 `PreviewConsoleQuery`/`Snapshot`/`ClearResult`；`after`/`limit` 只允许安全非负整数，`limit` 1–500，拒绝未知键。
  - `src/host/preview/console.ts`：独立 CDP 会话在 `Runtime.enable` 前挂两个监听（避免漏事件）；console 按类型映射 info/debug/warn/error，异常合并 `exceptionDetails.text` 与 `description`；来源 `redactUrl` 后截 512 字节、行号/列号 +1；文本去 ANSI/控制字符、归一 CRLF、按 UTF-8 截断；ring buffer 默认 500 条 / 64 KiB / 单条 500 字节，逐出最旧并累计 `dropped`，`seq` 跨 `clear()` 单调；`stop()` 用 `off?.()` 移除监听、detach、清空缓冲，`start`/`stop` 竞态用 epoch 保护；`Runtime.enable` 失败统一 `preview_failed` 并清理会话。
  - `src/host/preview/route.ts`：`release()` 先停 console 采集器再停 input/adapter；`consoleList`/`consoleClear` 校验 query 与运行态；采集器启动失败只把快照能力降为 `console:false`，预览仍 `ready`；Web adapter 能力补 `console: true`。
  - `src/client/preview/ConsoleDrawer.tsx`：1 s 轮询 `after` 增量、按 id 去重、本地 500 上限、Host `lastSeq` 回退时全量重取、`clearEpoch` 防在途轮询回填；all/error/warn/info 过滤（info 含 debug）、错误/警告计数、清空同时清 Host 与本地；失败显示 `role="status"`，来源按纯文本渲染；`Canvas` 仅在 `capabilities.console` 为 true 时挂载；en/zh-CN 文案补齐。
- 验证：
  - `pnpm exec vitest run tests/integration/console tests/component/preview/console-drawer.test.tsx`：3 文件 / 22 用例通过；全量 `pnpm test`：35 文件 / 260 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 116.1 KiB / client 83.4 KiB。
  - 手动 Host（真实 Edge + Vite fixture，`.tmp/t023-host.mjs`，`.tmp/logs/t023-host.json`，`ok:true`）：info/warn/error 与异步 throw 入缓冲（异常文本含 `boom-exception`）；510 条 `console.log` 后恰为 500 条、`lastSeq=517`、`dropped=17`、首条 `bulk-10`；clear 返回 `{cleared:500,lastSeq:517}` 且 seq 不变，随后 `console.error('after-clear')` 得到唯一 `console-518`；停止后目标 Edge 全退。
- 计划偏差/限制：T023 验证只要求 integration + component，未做 Web/隔离 Desktop 载体手测；异常 `description` 可能自带堆栈，受单条文本上限约束；清空只清 Host 缓冲，页面自身 `console.clear()` 被忽略（按 type 过滤）。

### T024 — Network 采集与抽屉（已完成）

- 目标：CDP Network 事件；请求/响应摘要；body 按需；上限与脱敏；UI。
- 结果：
  - `src/contracts/transport.ts`：新增 `preview.network.list` / `preview.network.clear` / `preview.network.body` 一元方法，`after`/`limit` 严格校验，`MAX_NETWORK_ENTRIES=300`、`MAX_NETWORK_BODY_BYTES=64 KiB`。
  - `src/host/preview/network.ts`：独立 CDP 会话先挂 `requestWillBeSent`/`responseReceived`/`loadingFinished`/`loadingFailed` 再 `Network.enable`；请求/响应按 `requestId` 合并，4xx/5xx 记 `error`，`loadingFailed` 的 `canceled` 记 `aborted`；header 上限 64 条、单值 512 字节并先 `redactHeaders`，URL 先 `redactUrl` 再截 512 字节；ring buffer 300 条 / 256 KiB；revision 游标让 pending 行更新后重发；body 仅按需读取并按 UTF-8/base64 截断；`stop()` 移除监听、detach、清空。
  - `src/host/preview/route.ts`：`release()` 顺序 console → network → input → adapter；能力缺失 `unsupported`，未运行 `target_unavailable`。
  - `src/client/preview/NetworkDrawer.tsx`：500 ms revision 增量轮询、按 id 原位更新、`clearEpoch` 防回填、All/Failed 过滤、4xx/5xx 标记、清空同步 Host、展开懒加载 body 并缓存、纯文本渲染；仅当 `capabilities.network` 为 true 时挂载；en/zh-CN 文案补齐。
- 验证：
  - `pnpm exec vitest run tests/integration/network tests/component/preview/network-drawer.test.tsx`：3 文件 / 27 用例通过；全量 `pnpm test`：38 文件 / 287 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 134.2 KiB / client 102.1 KiB。
- 计划偏差/限制：T024 验证只要求 integration + component，未做真实 Edge 手测；POST body/WebSocket/SSE 未采集；T025 已在隔离 Desktop 确认抽屉有数据。

### T025 — 预览工具栏与生命周期（已完成）

- 目标：工具栏（目标/URL/刷新/视口/外部打开）；浏览器崩溃/断线提示；关 tab/停目标清理。
- 结果：
  - `src/contracts/transport.ts`：新增 `preview.session.navigate` / `preview.session.reload` / `preview.session.viewport` / `preview.targets` 四个一元方法；`PreviewSessionSnapshot` 增加 `kind`，`PreviewStartParams` 增加可选 `kind`（仅 `web` 已实现）；URL 1..2048 去空白、viewport 有限数值的严格校验；不新增全局路由。
  - `src/host/preview/session.ts`（服务从 `route.ts` 迁入）：`snapshot()`/stream/`start()` 调 `checkHealth()`，adapter `isAlive()` 为 false 置 `failed` + `target_unavailable`，只提示不自动重连；重启先 `release()` 旧句柄；reload 无实现时回退 `navigate(url)`；`setViewport` 复用目标配置校验并保留 `deviceScaleFactor`，越界 `invalid_input`；`listTargets()` 仅暴露 `{id,kind}`。
  - `src/host/targets/web/adapter.ts`：新增 `reload`/`setViewport`/`isAlive`（`ready && browser.isConnected() && !page.isClosed()`）；registry 可选方法校验扩展。
  - `src/client/preview/Toolbar.tsx`：目标下拉、URL 表单（Start/Go）、Reload、视口 64–7680 Apply、外部打开仅 loopback、状态行；崩溃提示 `role="alert"` + Restart/Stop。
  - `src/client/preview/lifecycle.ts`：模块级 active 标记区分内部 tab 切换与面板关闭，仅 shell 卸载调用 stop（15 s 超时），失败不复活标记。
  - `src/client/preview/Canvas.tsx`：1 s 状态轮询、500 ms 帧统计、动作 busy/错误包装、崩溃后显式重启；`local-url.ts` 校验 loopback；en/zh-CN 文案补齐。
- 验证：
  - `pnpm exec vitest run tests/integration/preview/session-lifecycle.test.ts tests/component/preview/toolbar.test.tsx tests/unit/preview/lifecycle.test.ts`：3 文件 / 14 用例通过；全量 `pnpm test`：41 文件 / 301 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 140.5 KiB / client 115.1 KiB。
  - 手动 Host（真实 Edge + Vite fixture，`.tmp/t025-host.mjs`，`.tmp/logs/t025-host.json`，`ok:true`）：navigate/reload/viewport 生效；崩溃 101 ms 检出且 1.5 s 后仍 `failed`、Edge 进程 0；重启为新会话；stop 调用 301 ms、进程 4471 ms 内全退、无孤儿。
  - 手动 Desktop（隔离 `DSH_HOME` + 独立 userData，CDP 9224，`.tmp/t025-desktop.mjs`，`.tmp/logs/t025-desktop.json`，`ok:true`）：工具栏刷新/视口 900×700/导航生效；Console/Network 抽屉在真实载体有数据；杀 Edge 后出现断开提示且不自动重启；Restart 恢复；内部切“检查”再回“预览”会话保留且无重载；停止后 3820 ms 内 Edge 全退、无孤儿；真实 desktop profile 哈希前后一致。
- 计划偏差/限制：崩溃后不自动重连（需显式 Restart）；改 DPR 需重启会话；“关闭整个 DSH 面板”触发的 stop 只有单测覆盖；Desktop 的 `window.open` 返回 null 属正常拦截路径。

### T026 — G2 Preview 评审（已通过）

- 目标：验证预览闭环与性能（10 fps、点击/输入/滚动、Console/Network、停止清理、SPEC 相关条目）。
- 结果：**G2 通过（GO）**，无产品代码改动，仅补手动矩阵脚本与记录。
- 验证：
  - 基线 `pnpm typecheck` 0 error、`pnpm test` 41 文件 / 301 用例通过、`pnpm build` host 140.5 KiB / client 115.1 KiB。
  - Host 真 Edge（`t026-host.mjs` / `t026-host.json`）：1280×800 全页 CSS 动画 10 s 258–259 帧 = 25.8–25.9 fps（p95 间隔 49–50 ms）；点击聚焦、键入 `hello`、计数 0→1、scrollY 0→267；点击到首帧 49–54 ms；Console log/warn/error/异步 throw 全覆盖；Network 200 + 连接失败（`outcome=error`）、body 602 字节；停止 354–377 ms、1357 ms 内 Edge 全退、无孤儿。
  - Web（`t026-web.mjs` / `t026-web.json`，`vibe-dev` + headless Edge）：24.4 fps；聚焦/键入/点击/滚轮均生效；Console 16 条、Network 39 条；停止 2940 ms、无孤儿。
  - 隔离 Desktop（`t026-desktop.mjs` / `t026-desktop.json`，CDP 9225）：25.0 fps；聚焦/键入/点击/滚轮均生效；Console 32 条、Network 71 条；停止 4886 ms、无孤儿，真实 desktop profile 哈希未变。
  - SPEC：FR-PRE-02/04/05/08 本次实测；FR-PRE-01/03/06/07/10 由 T025 与 shell 用例覆盖；FR-PRE-09（多目标独立会话）未验证，当前只注册 web 目标，留到多目标任务。
- 限制：Desktop 预览 Edge 在后台被遮挡时 Chromium 会节流 rAF/计时器，脚本测量前用 `SetForegroundWindow` 拉起预览窗口；停止清理 Desktop 4886 ms 接近 5 s；真实“关闭整个 DSH 面板”的 stop 仍只有 lifecycle 单测。

### U01 — 界面与项目方向定稿（已完成，2026-10-28）

- 背景：用户手测后反馈“功能正常，界面还得修改”，并提供《M1界面修改意见》（`M1阶段界面审查/M1界面修改意见.docx`）：预览元素过多、画布被挤、参数应外移、面向初学者、复杂调试交给 agent。
- 决策：UI 打磨不再整体后置。**先插入 U01（Layout v2）再开 T027**，因为拾取 overlay 依赖最终画布几何，先定布局可避免返工；其余 M3–M5 功能范围不变。
- 产物：
  - `docs/2026-10-28-界面与项目方向.md`：Layout v2 线框、元素处置表、U01 验收、明确不做、P1–P7 项目方向分级、防跑偏约束、待确认问题。
  - `tasks/todo.md`：新增 M2.5，U01 置于 T027 前；M3 依赖改为 G2 + U01；任务总数 61→62；关键路径、并行块、批准记录同步。
  - `tasks/HANDOFF.md`：下一项改为 U01，新增 U01 起步提示与新会话启动语。
- 验证：仅文档/任务清单，未改产品代码、未跑测试。
- 待确认：右栏最小宽度 320/360px、抽屉是否可拖拽、“在浏览器打开”位置、P2 一键部署是否单独立项。

### U01 实施 — 预览界面精简（Layout v2）（已完成，2026-10-28）

- 背景：方向定稿后按 `docs/2026-10-28-界面与项目方向.md` 第 2 节落地。基线（T026）：工具栏 5 组控件常驻、视口输入常驻、抽屉挤压画布、失败态无引导。
- 结果：
  - `src/client/preview/Canvas.tsx`：页面根改为 3 行网格（工具条 / 舞台 / 底部 tab），`fitContain()` 舞台内 letterbox 使 canvas 盒与位图严格等比（InputLayer 坐标映射不变），ResizeObserver 量舞台；状态 1 s 轮询、帧统计 500 ms；空状态提示与失败卡片（错误信息 + 3 条检查项 + 重启）；抽屉层 `position:absolute` 覆盖舞台、高 40%，Console/Network 常驻挂载以维持 tab 计数。
  - `src/client/preview/Toolbar.tsx`：单行状态（`● 运行中 · N fps` + `⋯ 更多`）与单行地址（`[URL] [启动/前往] [↻]`）；视口预设 + Fit panel、在浏览器打开、停止、重启、目标选择收进“更多”；状态点击弹出帧数/序号详情；视口钳制 64–7680；Esc 与外部 pointerdown 关闭浮层。
  - `src/client/preview/PreviewTabs.tsx`（新增）：底部常驻 tab，带实时计数，未就绪/无能力时禁用。
  - `src/client/preview/{ConsoleDrawer,NetworkDrawer}.tsx`：`active`（轮询）与 `visible`（显示）拆分，隐藏时用 `display:none` 且继续计数；新增关闭按钮、初学者空态文案、`onCountsChange` 上报。
  - `src/client/shell/settings/PreviewSettings.tsx`（新增）+ `SettingsPage.tsx`：设置页“预览”分组（懒加载 `<details>`），只用既有 `preview.session.status` / `preview.session.viewport` 一元方法，无契约变更；可注入 API 便于测试。
  - `src/client/shell/StudioShell.tsx`：预览面板 `minHeight:0; overflow:hidden`，保证网格行高可收缩。
  - `src/client/locales/{en,zh-CN}.json`：新增 30 个 key（状态详情、更多、空/失败态、抽屉空态、设置预览分组），两语 141/141 对齐。
  - 测试：新增 `tests/component/preview/preview-tabs.test.tsx`、`tests/component/shell/preview-settings.test.tsx`；重写 toolbar / console-drawer / network-drawer 用例与 studio-shell 的 tab 查询（限定 shell tablist，避免与抽屉 tab 冲突）。
- 真机发现并修复的两个缺陷（jsdom 测不出）：
  1. 页面根写了 4 个 `gridTemplateRows` 值却只有 3 个子节点，舞台被排成 `auto`（171 px）、底部 tab 反而吃掉 `1fr`（509 px）。改为 `'auto minmax(0, 1fr) auto'` 后舞台占面板 85.6%。
  2. 停止预览时 host 先释放 Console/Network 采集器、状态仍为 `ready`，抽屉 500 ms 轮询打到半拆会话，`/api/vibe/request` 返回 501 `unsupported`（浏览器 console 记两条 5xx，且抽屉里闪现错误）。现在 `busy === 'stop'` 时立即停用两个抽屉并关闭已开抽屉。
- 验证：
  - `pnpm typecheck` 0 error；`pnpm test` 43 文件 / 319 用例通过；`pnpm build` host 140.5 KiB / client 140.9 KiB。
  - 真机（`.tmp/u01-verify.mjs`，`vibe-dev` + headless Edge 1440×900，右栏强制 320/400/500px，`.tmp/logs/u01-verify.json`，`ok:true`）：三档均无横向溢出，舞台高 657.6 / 面板 768.6 = **85.6%**；常驻行 3，视口输入 0；抽屉开合 canvas 恒 304×171；264 帧 / 10.1 s = **26.2 fps**；点击、键入 `hello`、滚轮 500 均经 InputLayer 生效；Console 18 条 / Network 46 条，tab 计数正确；失败态 3 条检查项 + 重启成功；停止 3086 ms 内 9 个 Edge 进程全退、无孤儿。正常流程 console 0 error；唯一 503 是故意启动不可达目标的设计性错误响应，修复后无 501。
  - 截图：`.tmp/logs/u01-{320,400,500}.png`、`u01-failure.png`、`u01-stopped.png`。
- 计划偏差/限制：
  - 验收写“画布高度 ≥ 面板 60%”，按**舞台（画布区域）**理解并达标；16:9 位图在 320px 宽、768px 高面板中最多只能到 22.2%（304×171），几何上不可能达 60%，位图比例单独记录。
  - 真实系统中文 IME、外部浏览器跳转、P/V/I/C/N/L/S 全量手测矩阵未自动化；L/S 类（切 tab、关面板）沿用 T025 手测与 lifecycle 单测结论。

### U01 补充 — 删除面板内重复标题（人工验证反馈，2026-10-28）

- 背景：人工验证时反馈面板顶部 `Vibe Studio` 标题 + “预览、检查并标注正在运行的应用”副标题与 DSH 侧栏页签重复，占掉约 56 px 画布高度。
- 变更：`StudioShell.tsx` 去掉 `<header>`（`h2`/`p` 与 `headerStyle`/`titleStyle`/`subtitleStyle`），根网格 3 行改 2 行（`auto minmax(0, 1fr)`：页签行 + 页面体），页签行顶部补 `6px` 内边距；`shell.subtitle` 从 en/zh 两个 catalog 删除（两语 key 集合仍一致）；`index.ts` 的 `shell.title`（侧栏页签名）与 `shell.guide.description`（开始引导卡）保持不动。
- 测试：`studio-shell.test.tsx` 两处标题断言改为断言无 `heading`、无副标题文本（英文用例同时校验副标题文案不出现）。
- 验证：人工验证结束后重跑，`pnpm typecheck` 0 error、`pnpm test` 43 文件 / **319 用例全通过**、`pnpm build` host 140.5 KiB / client 140.3 KiB。
- 过程中一次假失败：人工验证会话在跑时，`tests/integration/web-adapter/edge.test.ts` 的“无 Playwright Edge 残留”断言收到 8 个 pid——那是用户预览的 Edge，与测试共用 `playwright_chromiumdev_profile` 前缀；会话停止后同一用例通过。**教训：真机手测期间不要跑全局进程断言类集成测试。**
- 影响：预览舞台可用高度增加约 56 px（同一面板高度下舞台占比进一步上升）；设置页与空状态页现在紧贴页签行。
  - 设置页“预览”分组只改目标页视口，不改 DSH 窗口尺寸；不新增 host 契约。

### 残留清理（2026-10-28，`f64e928`）

- 背景：U01 重写工具栏与设置页后，旧文案 key 与旧布局描述留在仓库里；合并入 `main` 前清一遍。
- 结果：
  - `src/client/locales/{en,zh-CN}.json`：删除 12 个无引用的 key（`state.loading`、`preview.state.label`、`preview.stats.frames`、`preview.reload.busy`、`preview.target.label`、`preview.viewport.{label,width,height,apply,applying}`、`preview.crash.{title,hint}`），140 → 128，两语仍完全一致；动态拼接的 key（`preview.console.filter.*`、`preview.network.filter.*`、`preview.network.outcome.*`、`preview.target.<kind>`）核对后保留。
  - `tasks/todo.md`：U01 的“文件”字段改为实际改动文件（含 `PreviewTabs`/`PreviewSettings`，注明实现无 CSS）。
  - `docs/SPEC-vibecoding-studio.md` §6.3：页签数量 4 → 5（预览/检查/标注/API/设置），并加实现注：视口/目标/停止已按 Layout v2 收进设置与“更多”，线框为设计基线。
  - 其余核查通过：`src/` 无未被引用的模块、无孤立 CSS（全部内联样式）、无 `.tmp`/`lib`/`.vibe` 入库、`tsconfig` 仍开 `noUnusedLocals`/`noUnusedParameters`（这些 key 是 JSON 数据，编译器查不到）。
- 验证：`pnpm typecheck` 0 error、`pnpm test` 43 文件 / 319 用例、`pnpm build` host 140.5 KiB / client 139.2 KiB（client 减少 1.1 KiB 即删掉的 key）。

### M2 + M2.5 合并入 `main`（2026-10-28）

- 前提：用户人工验证完成并批准合并。
- 结果：
  - 合并前 `main` 为 `01f9055`，是 `task/m2-target-model` 的祖先（领先 32 / 落后 0）。
  - `git merge --no-ff task/m2-target-model -m "merge: M2 preview + M2.5 layout v2 (T016-T026, U01, G2 GO)"` → 合并提交 `768e129`，零冲突；`git diff --stat f64e928 HEAD` 为空，即 `main` 树与分支末端完全一致。
  - `main` 验证：`pnpm typecheck` 0 error、`pnpm test` 43 / 319、`pnpm build` host 140.5 KiB / client 139.2 KiB。
  - `task/m2-target-model` 本地与远端均保留，未删；下一任务从 `main` 新建分支。

### T027 — 拾取 overlay 与选择器（已完成，2026-10-28）

- 背景：S4 spike 已验证 CDP 注入 + Shadow DOM overlay 可行，本任务落成产品代码。契约新增 `PickSnapshot`（`active/seq/pick/ts`）与三个一元方法 `preview.pick.{start,stop,status}`。
- 结果：
  - `src/host/inspect/selector.ts`（新增）：`buildSelector()` 按 SPEC §6.4 分级——唯一 `data-testid` → 唯一 `id` → `aria-label`/`name`（先带 tag 再全局）→ 语义 class（跳过 >40 字符、非标识符、纯数字、`[_-][a-f0-9]{5,}`/`css-*` 生成式）→ `nth-of-type` 路径，并在最近的唯一 `id`/`data-testid` 祖先处截短；每个候选在 `getRootNode()` 作用域内验证，结果带 `unique`。
  - `src/host/inspect/inject.ts`（新增）：`installVibePicker()` 在页面内创建 open Shadow DOM overlay（`all: initial` + `z-index: 2147483647` + `pointer-events:none`），仅顶层帧安装，`pointermove` 穿透 open shadow 命中并画框/标签，捕获阶段吞掉 press 与 click，`Esc` 取消（上报 `{kind:'cancel'}`），`Alt+Click` 免模式拾取，重复安装先 `dispose()` 旧实例；`createPreviewPicker()` 用独立 CDP 会话完成 `Runtime.enable → Runtime.addBinding → Page.addScriptToEvaluateOnNewDocument → Runtime.evaluate`，页面回传的 payload 全部重新校验/截断（selector 512、id 256、tag 64、≤8×64 classes、box ±1e6、≤8 KiB）。
  - `src/host/preview/{session,route}.ts`、`src/host/targets/web/adapter.ts`、`src/host/index.ts`：picker 随会话创建，脚本被页面拒绝时把 `capabilities.pick` 降为 false 而不让预览失败；navigate/reload 后 `reset()`；释放顺序为 input → picker → adapter。
  - `src/client/inspect/Picker.tsx`（新增）：`usePicker()` 轮询 `preview.pick.status`（active 300 ms / idle 1000 ms）、`PickToggle`（工具栏 `⌖`，`aria-pressed`）、`PickCard`（selector 整段可选中复制、唯一/非唯一徽标、tag/classes/box、可收起）。
  - `src/client/preview/{Toolbar,Canvas,InputLayer}.tsx`：工具栏新增拾取开关；画布拾取中显示蓝色提示条与 crosshair（`data-vibe-picking`），拾取结果卡片浮在舞台右上；`src/client/locales/{en,zh-CN}.json` 新增 10 个 key，两语仍一致。
  - 关键约束：`buildSelector`/`installVibePicker` 经 `Function.prototype.toString()` 序列化进页面，**模块级常量在页面里是 free variable**——选择器里的 `MAX_CLASS_CHARS`/`MAX_CLASS_CANDIDATES` 已移入函数体，`buildPickerScript` 另拒绝 esbuild `keepNames` 的 `__name(` 泄漏（否则页面内 ReferenceError 且点击无上报）。`Runtime.enable` 也是必需的，否则 `Runtime.bindingCalled` 不投递到该会话。
  - 测试：新增 `tests/unit/preview/picker.test.ts`（11）、`tests/component/inspect/selector.test.ts`（9）、`tests/component/inspect/page-script.test.ts`（8）、`tests/component/inspect/picker-ui.test.tsx`（6）、`tests/integration/preview/picker-service.test.ts`（4）、`tests/integration/preview/picker-edge.test.ts`（真实 Edge，10 元素抽测），toolbar 用例补 2 条。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 49 文件 / **363 用例全通过**；`pnpm build` host 159.6 KiB / client 149.1 KiB。真实 Edge 验收细节见 `tasks/todo.md` T027“验证结果”。
- 计划偏差/限制：拾取卡片只做组件测试，未做 `vibe-dev` 截图（任务验证要求为 S4 harness + integration）；`text/html/role/source` 仍是空占位，T028/T029 填充。

### T028 — 元素上下文提取（已完成，2026-10-28）

- 背景：T027 只回传 selector/identity/box，`text/html/role/source` 为空占位；FR-PICK-02 要求元素上下文含文本、角色、可见性。
- 结果：
  - `src/host/inspect/dom.ts`（新增）：`extractDomContext()` 在页面内克隆元素、去掉 `script/style/template/noscript`、深度 ≤ 6 / 元素节点 ≤ 200，空白归一后按 UTF-8 截到 2048 B（`…` 计入预算；截断落在标签中间时回退到最后一个完整标签）；文本优先 `innerText`、无 `innerText` 时用去脚本克隆的 `textContent`，折叠空白后截到 200 码点；可见性检查连接状态、`hidden`、rect 尺寸、`display/visibility/opacity` 与 `checkVisibility()`。Host 侧 `normalizeDomSnippet`/`normalizeElementText`/`normalizeVisibility` 重新校验页面数据。
  - `src/host/inspect/accessibility.ts`（新增）：`describeAccessibility(element, roles)` 近似可访问名称（`aria-labelledby` → `aria-label` → 原生 alt/value/label/legend/caption/figcaption → title → placeholder → 文本内容，landmark 不用文本内容）与角色（显式 `role` 经 ARIA 1.2 白名单校验，否则原生映射）；Host 侧 `normalizeRole`/`normalizeAccessibleName` 再次收口。
  - `src/host/inspect/inject.ts`：`installVibePicker()` 接收 DOM/无障碍提取器并在点击时把 `html/text/visible/role/name` 一并上报（异常只留空字段，不阻断拾取）；`buildPickerScript()` 组合四个自包含函数，角色白名单以 JSON 参数传入页面；`normalizePickedElement()` 填充新字段。
  - `src/contracts/inspect.ts`：`ElementContext` 新增 `name`（可访问名称，非 `name` 属性）与 `visible`，`isElementContext` 同步；`src/contracts/annotation.ts` 渲染 `name`/`visible`。
  - 测试：新增 `tests/unit/inspect-context/{dom,accessibility}.test.ts`；`unit/preview/picker.test.ts` 与 `component/inspect/page-script.test.ts` 更新 payload/上限断言；`integration/preview/picker-edge.test.ts` 对 10 种元素新增 role/name/text/visible/html 断言。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 51 文件 / **384 用例全通过**；`pnpm build` host 172.8 KiB / client 149.1 KiB；真实 Edge 10/10 上下文正确。日志 `.tmp/logs/t028-*.log`。
- 计划偏差/限制：名称是近似实现（无完整 accessibility tree、未覆盖 `aria-owns`/嵌套 landmark 特例）；拾取卡片暂不展示 text/role，留 T029/T030。

### T029 — 源码适配（React/Vue/Svelte）（已完成，2026-10-28）

- 背景：S4 spike 证明三框架能取到元素源码行，但 React 19 没有 `_debugSource`、Vue 的 `data-v-inspector` 运行时被移入 vnode、生产构建没有任何元数据。本任务把 S4 的取法产品化，并补上“取不到”的明确回退。
- 结果：
  - `src/host/inspect/source/react.ts`（新增）：`reactSource()` 先读 `@react-dev-inspector/babel-plugin` 在 dev 构建期写入的 `data-inspector-relative-path/-line/-column`（经 `closest` 兼容包装元素），再沿 `__reactFiber$*` 的 `return` 链 ≤ 64 层找 React 18 dev 的 `_debugSource`，否则 `null`。
  - `src/host/inspect/source/vue.ts`（新增）：`vueSource()` 沿 `__vnode` 父链 ≤ 64 层，优先用 `__vue_inspector_store__.vnodeToPos`（`vite-plugin-vue-inspector` v7 的全局表），其次读 vnode 不可枚举 prop `__v_inspector`（`file:line:column`），再退回遗留的 `data-v-inspector` 属性，最后用 `__vueParentComponent.type.__file` / `__vnode.ctx.type.__file` 只给文件（无行号），否则 `null`。
  - `src/host/inspect/source/svelte.ts`（新增）：`svelteSource()` 从元素向上 ≤ 64 层读 `__svelte_meta.loc`（Svelte 5 dev 运行时；生产构建没有），否则 `null`。
  - `src/host/inspect/source/index.ts`（新增）：`SOURCE_VIAS` 与 Host 侧 `normalizeSourceContext()`——框架白名单、文件去控制字符/折叠空白/截 512 码点、`via` 限适配器 token、行列为 0–1,000,000 整数，未知字段丢弃，越界置 `null`。
  - `src/host/inspect/inject.ts`：`installVibePicker()` 接收第 5 个页面提取器 `sourceOf`，点击时 `try/catch` 取 source 并随 payload 上报；`buildPickerScript()` 用 `toString()` 组合三个适配器，`return __vibeReactSource(el) || __vibeVueSource(el) || __vibeSvelteSource(el)`；`normalizePickedElement()` 经 `normalizeSourceContext` 填充 `ElementContext.source`。
  - `src/client/inspect/Picker.tsx`：`PickCard` 新增源码行——显示文件末段 + 行号（`App.vue:14`）、完整路径放 `title`、`data-vibe-pick-source-via` 暴露取法；无源码时显示“无源码信息”，不隐藏该行。两语新增 `preview.pick.source` / `preview.pick.sourceUnavailable`。
  - `fixtures/source/{react,vue,svelte}`（新增）：三套最小 Vite 应用，各 30 个带 `id` 的元素、每元素单独一行，分别启用 inspector Babel 插件、`vite-plugin-vue-inspector`、Svelte 5 dev 编译。
  - 测试：新增 `tests/unit/inspect-context/source.test.ts`（17 用例：三适配器主路径/回退/异常，`normalizeSourceContext` 边界）、`tests/e2e/source-adapters.spec.ts`（每框架 dev 30/30 命中与真实鼠标复核 + 生产 30/30 `source: null`）；`component/inspect/page-script.test.ts` payload 补 `source` 并新增页面内 React 属性断言；`component/inspect/picker-ui.test.tsx` 新增源码行 2 例；`unit/preview/picker.test.ts` 补脚本组合断言。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 52 文件 / **404 用例全通过**；`pnpm build` host 181.0 KiB / client 150.0 KiB；`pnpm test:e2e` **9 用例全通过**（dev 三框架 30/30 命中、生产三框架 30/30 回退为 null、0 控制台/页面错误）。日志 `.tmp/logs/t029-*.log`。
- 计划偏差/限制：React 19 的一级路径依赖目标项目启用 inspector babel 插件；Vue `__file` 回退只有文件、不计命中；Svelte 4 的 `add_location` 未单独适配；三 fixture 均为手写最小应用，真实项目插件版本差异留 G3 复核；e2e 紧接 `pnpm test` 时 Playwright 的 Edge 进程可能尚未退完，会误触发 `picker-edge` 的清理断言（单独重跑即通过）。

### T030 — 标注模型、存储与文本渲染（已完成，2026-10-28）

- 背景：T009 已有 `Annotation` 契约与渲染（JSON 往返、4 KB 预算、`<untrusted-page-content>` 包裹），但没有落盘方式，历史（T033）和标注队列（T031）都无处可存。SPEC §6.5 规定 `.vibe/annotations/*.json`，一条标注一个文件。
- 结果：
  - `src/contracts/annotation.ts`：新增并导出 `isAnnotationId()`（`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`），`isAnnotation` 改用它——id 同时是文件名，必须排除路径分隔符、前导点和空 stem。
  - `src/host/inspect/annotation-store.ts`（新增）：`AnnotationStore` / `createAnnotationStore(projectDir)`。`save()` 先 `isAnnotation` 校验、`serializeAnnotation` 后按 UTF-8 字节限 64 KiB，再在 `.vibe/annotations` 同目录写 `wx` 临时文件并 `rename` 原子替换（覆盖同 id）；`read()` 对缺失、坏 JSON、形状不合法、超 64 KiB、symlink 或 realpath 越出目录的文件返回 `null`；`list()` 只认 `<合法 id>.json`、逐个校验、跳过坏文件、按 `createdAt` 倒序（同时间按 id）；`remove()` 返回是否删除；`.vibe` 或 `.vibe/annotations` 为越界 junction/symlink 时抛 `path_outside_project`。
  - `src/host/index.ts`：导出 store、错误类与 `ANNOTATION_DIR_NAME`/`ANNOTATION_FILE_EXT`/`MAX_ANNOTATION_FILE_BYTES`。
  - 测试：新增 `tests/unit/annotation/annotation-store.test.ts`（10 用例）：磁盘往返、原子写无临时残留、save→read→render 后 ≤ 4 KB 且不可信边界只出现一次（含页面 HTML 试图闭合标签）、坏/非法/超大文件回退为 `null` 且 `list` 跳过、非法与超限保存不落盘、非法 id 不触达文件系统、删除/空历史、`.vibe` junction 越界拒绝。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 53 文件 / **414 用例全通过**（`tests/unit/annotation` 10 + 原 `tests/unit/contracts/annotation.test.ts` 9）；`pnpm build` host 192.8 KiB / client 150.0 KiB。日志 `.tmp/logs/t030-{typecheck,test,build}.log`。
- 计划偏差/限制：契约保持 `src/contracts/annotation.ts` 单文件（未拆 `annotation/` 目录，避免无收益的导入改写）；store 未接入 host 服务/agent 工具（T031 用模型、T033 做列表/搜索/重开）；未替目标项目生成 `.vibe/annotations` 的 gitignore；同一 id 并发保存以最后 `rename` 为准，无文件锁。

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
40. **组件测试的 cleanup 由 harness 统一注册**：T012 起 `component` project 通过 `tests/setup/component.ts` 在 `afterEach` 调 `cleanup()`；测试文件里显式 `cleanup()` 保留为双保险。模块级 store 仍需 `beforeEach` 调 `resetShellStore()`，否则会跨用例泄漏。
41. **jsdom 按 project 开启**：T012 起 `component` project 指定 `environment: 'jsdom'`，`node` project 跑纯函数与集成测试，避免每个纯逻辑用例都付 DOM 启动成本；文件首行 `// @vitest-environment jsdom` 已冗余但保留。
42. **右栏收起后按钮不可见**：收起右侧栏后 `新标签页` 仍在 DOM 但不可点；验证脚本先尝试“新标签页”，不可见时点“打开右侧边栏”，再点 guide 卡片，才能稳定重开 tab。
43. **Vitest 5 的 `passWithNoTests` 只能放根级**：写进 project 的 inline config 会报 TS2769；放在 `test.passWithNoTests`。
44. **Playwright 用 `channel: 'msedge'` 不下载浏览器**：直接使用本机 Edge；fixture 若缺 favicon 会请求 `/favicon.ico` 得到 404 并计入 console error，用 `<link rel="icon" href="data:," />` 消除。
45. **判断 fixture 残留看 LISTENING**：Playwright `webServer` 关闭后，4320 上仍会短暂出现客户端 `TIME_WAIT`，不代表服务没停。
46. **进程查询必须同时限定进程名**：用 `Get-CimInstance Win32_Process` 按 `CommandLine -like '*vite.js*'` 查残留时，执行查询的 `powershell.exe` 自身命令行也包含该模式，会误报“残留”。加 `Name -eq "node.exe"`（或目标进程名）后再匹配命令行。
47. **启动失败清理不要等待别人的端口**：`--strictPort` 冲突时子进程自行退出，端口属于外部进程；若清理阶段仍按停止流程等待端口释放，会白等完整 stopTimeout 并记录误导性的 “still in use after stop”。仅在清理需要杀进程（`run.exit` 未出现）时验证端口，并保留原始启动错误。
48. **raw TCP 测试服务会被无响应 fetch 的连接拖住关闭**：对不返回响应的 `net` server 做 HTTP 就绪探测，abort 后可能仍有 socket 未关闭，`server.close()` 回调不触发。测试脚本要记录 `connection` socket，先 `close()` 再逐个 `destroy()`，再等待关闭完成。

### 配置存储

46. **路径包含校验必须用 `realpath` + `relative`**：`join(projectDir, '.vibe')` 只是字符串拼接，`.vibe` 可以是指向任意位置的 junction/symlink。要对项目根、`.vibe`、目标文件分别 `realpath`，再用 `relative(parent, child)` 判断非空、不以 `..` 开头且非绝对路径；`startsWith(parent + sep)` 在大小写/盘符差异下不可靠。
47. **原子写的临时文件放目标同目录**：跨卷 `rename` 会失败；临时文件写在 `.vibe` 的真实路径内，用 `flag: 'wx'` 防覆盖，`rename` 成功后原文件才变化，失败时删除临时文件。
48. **坏数据回退要保留原文件**：读取只返回默认值和 `issues`，不自动 `write()` 修复，否则用户手写的注释/未知字段会在一次读取后消失；修复应由 UI 显式保存触发。
49. **`pnpm test -- <path>` 不过滤**：`--` 后的路径会作为普通参数传给 vitest，实际跑全量；本仓库用 `pnpm exec vitest run <path>`。

### 进程 / Windows（S8）

50. **Node 24 的 job object 会“顺手”清树，但不可依赖**：非 detached 子进程 `IsProcessInJob=true`，父进程被终止后子进程随之消失，直接 `child.kill()` 看似无孤儿；这是实现细节（版本/启动方式相关），T019 仍必须 `taskkill /T /F` 并校验。
51. **`shell:true`（cmd.exe 中转）会绕过 job，产生真实孤儿**：只杀 cmd.exe 时 vite node 存活且继续占端口；此时再 `taskkill /T` 已找不到子进程（父链已断）。supervisor 必须在杀之前记录后代 PID，并在清理时按 PID + 命令行匹配兜底。
52. **按 PID 强杀前必须复核命令行**：PID 会被复用；清理脚本对每个记录 PID 先确认命令行仍含 `vite.js`/fixture 路径，避免误杀无关进程。
53. **端口探测有竞态**：`listen(0)` 释放后到真正启动之间端口可能被抢；冲突以 `--strictPort` 的真实退出码与 stderr（`Error: Port <port> is already in use`）为准，不要静默换端口。

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
36. **Desktop 载体的合成键盘过快会丢字符**：在 Desktop Electron 里通过面板按 25 ms/字符键入，目标 Edge 只收到首个字符；150 ms/字符（接近人类速度）时完整到达。同一脚本下 Web 25 ms 与 host 直连 fixture 连续按键均正常，说明是 Desktop 载体的合成键节奏问题，不是输入转发链路丢失；真实键盘/IME 手测不要用 25 ms 自动化结论代替。
37. **CDP IME 模拟只覆盖事件链**：`Input.imeSetComposition` + `Input.insertText` 能验证组合事件、只提交最终文本与目标插入，但不经过系统输入法/候选窗；真手测仍要用 Microsoft Pinyin。隐藏 textarea 必须可聚焦（1px + `opacity:0`，不能 `display:none`），点击时移到指针位置以对齐光标/候选窗。Desktop 的 `dsh-app://` 无法被 Playwright route 拦截，失败注入改在渲染进程包装 `fetch`（仅测试脚本）。

### 拾取 / 源码

28. **React 19 没有 `_debugSource`**：React 19 的 `jsxDEV` 只接收 `debugStack`/`debugTask`，fiber 上不再有元素级源码；`_debugStack` 指向组件渲染位置，不能当元素行号。要元素级定位必须在构建期注入属性（S4 用 `@react-dev-inspector/babel-plugin` 生成 `data-inspector-*`）。
29. **拦截 `click` 会把自己的监听也拦掉**：捕获阶段对 `click` 调 `stopImmediatePropagation` 后，同元素后续监听（包括拾取器的 `onClick`）不再执行。只拦截 `pointerdown/mousedown/...`，`click` 交给拾取器自己的捕获监听。
30. **Vue inspector 的 DOM 属性运行时不存在**：`data-v-inspector` 被 `vite-plugin-vue-inspector` 移入 vnode 不可枚举 prop `__v_inspector` 并删除属性；读 DOM 属性会全部失败，应读 `el.__vnode` / `__vue_inspector_store__.vnodeToPos`。
31. **Svelte 源码只在 dev**：`__svelte_meta` 由 dev 运行时 `assign_location` 设置，生产构建没有；产品里必须能显示“源码不可用”。

### 源码适配 / Vite 测试

1. **Vite JS API 不会重置 `NODE_ENV`**：同一 Node 进程里先 `createServer()` 会把 `process.env.NODE_ENV` 固定为 `development`（只在未设置时才给默认值），随后 `build()` 解析出的 `config.isProduction` 仍是 false，`@vitejs/plugin-vue` 继续注入 `__file`、Svelte 插件继续编译 dev 的 `__svelte_meta`——“生产产物带源码”。测试里在 `createServer`/`build`/`preview` 前后显式设置并恢复 `NODE_ENV`；单独跑生产用例时不会暴露（首次 build 自己设成 production）。
2. **序列化适配器同样禁止模块常量**：`reactSource/vueSource/svelteSource` 和 T027/T028 的页面函数一样用 `toString()` 进页面，`MAX_*` 与 `cleanFile`/`position` 等辅助函数必须写在函数体内；页面里找不到就是 ReferenceError。
3. **`Object.keys` 只列 enumerable 自有属性**：React 的 `__reactFiber$*`、Vue 的 `__vnode` 运行时是普通赋值（enumerable），jsdom 测试用 `Object.defineProperty` 伪造时必须传 `enumerable: true`，否则适配器看不到。
4. **`preview()` 的 `PreviewOptions` 没有 `outDir`**：传 `preview.outDir` 会 TS2345；把 `build.outDir` 以内联 config 同时传给 `build()` 和 `preview()`，二者都按 `build.outDir` 找静态文件。

### 标注存储 / 文件

1. **`lstat` 的 symlink 判断要放在 `isFile()` 之前**：`lstat` 对符号链接返回 link 类型，`isFile()` 为 false；先判 `!isFile()` 会让 symlink 分支永远不可达。正确顺序是 `!info || info.isSymbolicLink() || !info.isFile()`，再 realpath 校验仍在目录内。
2. **用户项目里的 `.vibe` 不可信**：它可能是指向项目外的 junction（Windows）或 symlink。写前 `mkdir` 后对 `.vibe/annotations` 做 `realpath` 并与项目 realpath 比较；读时先拒绝链接目录，再对每个文件 realpath 比较，防止借链接读到任意路径。
3. **一条坏标注不能拖垮整个历史**：`read` 对坏 JSON/形状非法/超限文件返回 `null`，`list` 逐个 `try` 跳过，只让真正的 IO 错误（以及越界链接）抛出。
4. **文件大小在解析前就要卡住**：先 `lstat().size` 挡住超大文件，读入后再按 UTF-8 字节复核（防读取期间被写大），避免 `JSON.parse` 吃进任意大小输入。

### 预览 / 浏览器

32. **进程检查会匹配到自己**：用 `CommandLine -like '*playwright_chromiumdev_profile*'` 查残留时，执行检查的 shell/PowerShell 自身也含该字符串，会误报。必须同时限定 `name='msedge.exe'`（或进程名）并匹配 `--user-data-dir=*playwright_chromiumdev_profile*`。
33. **端口 1 不是“连接被拒”**：Chromium 把它当 unsafe port，`page.goto` 报 `net::ERR_UNSAFE_PORT`，不会命中 `ERR_CONNECTION_REFUSED` 映射。测试用 `net` 临时监听再释放一个端口，拿到真实的 `ERR_CONNECTION_REFUSED`。
34. **`playwright-core` 必须懒加载且保持 external**：host 用 `packages: 'external'` 打包，动态 `import()` 留在产物里；模块加载不依赖浏览器，缺失时由 `launchEdge` 转成 `target_unavailable`，避免插件启动即崩。打包任务需把它从 devDependency 提升为运行时依赖。
35. **`fetch` 不能脱离 `window` 调用**：`const f = window.fetch; f(url)` 在 Chromium 抛 `TypeError: Illegal invocation`，而 Node/测试的注入实现不会暴露；`PreviewTransport` 默认改为 `(input, init) => fetch(input, init)`。Web 手测两条通道同时“静默无帧”时先查这里。
36. **Electron 的 `dsh-app://` 支持流式响应**：Desktop 的手测里 multipart `/api/vibe/stream` 正常持续出帧（25.7 fps），未退化到 pull；但 headless Edge 的 Web 手测才是断流回退的主证据。

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
- **T006–T017 已完成**：产品包脚手架、host ESM、client loader bundle、host Config/服务位、contracts v1、client shell/右栏 tab、connection 传输、测试 harness 与 Vite fixture、`.vibe` 配置存储、设置面板、G1 评审、target 契约/校验/adapter 注册表、Web adapter（Edge 启动/导航/截图/关闭）均已验证。
- **T018 已完成**：S8 测量结论（启动 ~0.4 s、treekill 无孤儿、`shell:true` 孤儿风险、端口冲突可读）写入 [`spikes/s8/REPORT.md`](../spikes/s8/REPORT.md)，T019 supervisor 按该结论实现。
- **T019–T020 已完成**：dev server supervisor（真实 Vite 验证）与 screencast/帧路由/canvas（Web 断流回退与恢复、隔离 Desktop 手测）均通过；证据 `.tmp/logs/t019-manual.json`、`.tmp/logs/t020-{web,desktop}.json`。
- **T021 已完成**：输入转发点击/滚轮/键盘在 Host 直连、Web 与隔离 Desktop 均达目标，端到端最大 39.3 ms；证据 `.tmp/logs/t021-{host,web,desktop}.json`。
- **T022 已完成**：中文组合只提交最终文本，Web/Desktop 提交 `你好，世界`、无中间态请求；失败提示与恢复、粘贴回退均验证，端到端最大 59.6 ms（Desktop）/ 15.7 ms（Web）；证据 `.tmp/logs/t022-{host,web,desktop}.json`。限制：CDP 模拟 IME 不能替代 Microsoft Pinyin 系统级手测。
- **T023 已完成**：console/exception 采集、500 条上限、seq 单调、清空与抽屉过滤均通过单测与真实 Edge 手测；证据 `.tmp/logs/t023-host.json`。
- **T024 已完成**：Network 事件采集（4xx/5xx 标记、header/URL 脱敏、300 条 / 256 KiB 上限、body 按需 64 KiB 截断）、revision 游标增量轮询与网络抽屉（原位更新、Failed 过滤、body 懒加载）均通过集成与组件测试；T025 已在隔离 Desktop 确认抽屉有数据。
- **T025 已完成**：工具栏 navigate/reload/viewport/外部打开、崩溃提示与显式重启、内部切 tab 保会话、停止后 5 s 内进程全退且无孤儿，Host 真 Edge 与隔离 Desktop 均 `ok:true`；证据 `.tmp/logs/t025-{host,desktop}.json`。限制：崩溃不自动重连、改 DPR 需重启。
- **T026（M2）**：G2 Preview 评审，复核闭环/性能（10 fps、输入、Console/Network、停止清理）与 SPEC 条目。T020/T021 已接好预览会话与输入覆盖层；T008 的 `retentionDays`/`contextBudgetBytes`/`screenshotEnabled` 将随截图与上下文任务逐步消费；T009 的 contracts 由后续页面逐步引用。
- **T027–T029 已完成**：拾取 overlay/选择器、元素上下文（text/html/role/name/visible）、三框架源码适配（React `data-inspector` → fiber、Vue `__v_inspector` → `data-v-inspector` → `__file`、Svelte `__svelte_meta`），页面数据全部在 Host 侧重新校验。`fixtures/source/*` e2e 在三框架 dev 各 30/30 命中，生产构建 30/30 回退为 `source: null` 且无错误。限制：源码行依赖目标项目 dev 构建的插件，生产态只显示“无源码信息”。
- **T030 已完成**：`.vibe/annotations/<id>.json` 一条标注一个文件，保存前校验并限 64 KiB、原子替换；读取把坏数据当缺失、列表跳过，越界 junction/symlink 拒绝；渲染往返仍 ≤ 4 KB 且不可信包裹完整。限制：尚未接入 host 服务/工具与历史 UI（T031/T033）。
- **S2 遗留**：如果上游未来公开附件创建/释放 API，再评估直接截图附件；先复测切会话保留和失败清理。
- **Desktop 遗留**：S2 跨会话未测到，后续需要能稳定创建第二个命名会话的测试环境。
- **成本**：避免无必要的全仓读取和重复验收；每个任务完成即提交、记录、清理进程。

## 6. 恢复检查清单

```bash
git status -sb
pnpm typecheck
pnpm test
pnpm test:e2e          # 自动拉起 fixtures/vite-basic (127.0.0.1:4320)
pnpm build
pnpm spike:s1
pnpm spike:s2:build
pnpm spike:s3 --seconds 10
pnpm spike:s4
pnpm tsx spikes/s8/run.ts   # 进程生命周期，约 20 s，会自动清理
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
- S8 进程生命周期：[REPORT](../spikes/s8/REPORT.md)、[run.ts](../spikes/s8/run.ts)；原始数据 `.tmp/logs/s8-results.json`。
- 任务与验收：[todo.md](../tasks/todo.md)。
- 测试 harness：`vitest.config.ts`、`playwright.config.ts`、`fixtures/vite-basic/`、`tests/e2e/fixture.spec.ts`。
- 源码适配：`src/host/inspect/source/`、`fixtures/source/{react,vue,svelte}/`、`tests/e2e/source-adapters.spec.ts`、`tests/unit/inspect-context/source.test.ts`。
- 配置存储：`src/host/studio/store.ts`、`tests/unit/studio-store.test.ts`。
- 标注存储：`src/host/inspect/annotation-store.ts`、`src/contracts/annotation.ts`、`tests/unit/annotation/annotation-store.test.ts`、`tests/unit/contracts/annotation.test.ts`。
- Web 预览：`src/host/targets/web/{adapter,launch}.ts`、`tests/integration/web-adapter/`、`tests/helpers/png.ts`。
- 预览生命周期：`src/host/preview/session.ts`、`src/client/preview/{Toolbar.tsx,lifecycle.ts,local-url.ts}`、`tests/integration/preview/session-lifecycle.test.ts`、`.tmp/logs/t025-{host,desktop}.json`。
- 技术决策：[plan.md](../tasks/plan.md)、[SPEC](./SPEC-vibecoding-studio.md)。
- 发布检查：[PUBLISHING.md](./PUBLISHING.md)。
- 私有仓库：`https://github.com/niobium617/dsh-vibecode-studio`（当前为 private）。
