# Development log

> 项目：DSH Vibecode Studio
> 记录日期：2026-10-27
> 用途：按任务记录开发进度、已验证事实、踩过的坑和恢复入口。
> **验收细节以 `spikes/*/REPORT.md` 为准；恢复会话先读 `tasks/HANDOFF.md`，本页只查当前任务相关段，不必通读。**

## 1. 当前快照

- 阶段：**Phase 4 实现（M0/G0 已通过，M1 已完成，M2 已完成）**。
- 已完成：T001 S1 传输 spike、T002 S2 composer handoff spike、T003 S3 screencast + 输入 + 中文 spike、T004 S4 拾取 + 源码 spike、T005 G0 Spike 评审、T006 包脚手架与工具链、T007 Client bundle loader 包装、T008 Host 插件骨架与 Config、T009 Contracts v1、T010 Client shell + 右栏 tab、T011 Connection 传输骨架、T012 测试 harness + fixture、T013 `.vibe` 配置存储、T014 设置面板（基础）、T015 G1 Foundation 评审、T016 Target 模型/配置/adapter 注册表、T017 Web target adapter（Edge 启动/导航/截图/关闭）、T018 S8 进程生命周期 spike、T019 Dev server 进程监督、T020 Screencast + 帧路由 + canvas、T021 输入转发（点击/滚轮/键盘）、T022 中文输入（隐藏 textarea + `Input.insertText`）、T023 Console 采集与抽屉、T024 Network 采集与抽屉、T025 预览工具栏与生命周期、T026 G2 Preview 评审（通过）、T027 拾取 overlay 与选择器、T028 元素上下文提取、T029 三框架源码适配、T030 标注模型与存储、T031 标注气泡与队列。
- 阶段：**M1 已完成并通过 G1；M2 已完成并通过 G2；M2.5/U01 预览界面精简（Layout v2）已完成**（`3f14d93`；方向见 `docs/2026-10-28-界面与项目方向.md`），**T027 拾取 overlay 与选择器、T028 元素上下文提取、T029 源码适配（React/Vue/Svelte）、T030 标注模型与存储、T031 标注气泡与队列、T032 Composer handoff、T033 标注历史 已完成**；**T034 G3 评审完成（GO）**：初评“≤3 步”实测 4–5 个动作，经用户批准在保存通知加“发送到对话”后为 3 个动作（点元素 → 保存 → 发送），复测四项验收全过（源码 100%、标注 4,095 B ≤ 4 KB、不自动发送），M3 完成；手动复测入口见 `docs/2026-10-29-M3手动测试手册.md`（M2 见 `docs/2026-10-28-手动测试手册.md`）。**M3.5/U02 界面优化（气泡直达发送、状态归位、删除弹窗）与 U03 拾取注入修复已完成并合并入 `main`**（合并提交 `a1c7577`，2026-10-29；依据 `界面审查/M3修改意见.docx` 与用户实测反馈）。**M4 API Workbench 进行中（分支 `task/m4-api-workbench`，未推送、未合并）**：T035 HTTP 执行器、T036 环境/变量/密钥、T037 集合与历史持久化、T038 请求构建 UI、T039 响应查看 UI、T040 富响应体、T041 S7 OpenAPI spike、T042 OpenAPI 导入、T043 抓包回放、T044 集合/历史 UI、T045 断言已完成；下一项 T046 G4 评审。
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

### T031 — 标注气泡与队列（已完成，2026-10-28）

- 背景：T027 的拾取卡片只展示元素，T030 的 `Annotation` 模型与 `renderAnnotationText` 没有客户端入口；预览页（气泡）和标注页签（队列）是两个互斥挂载的页面，状态不能放在任一页面组件里。
- 结果：
  - `src/client/inspect/AnnotationBubble.tsx`（新增）：`placeBubble({ box, viewport, frame })` 把元素 `box` 按 `frame/viewport` 缩放后放在元素下方（`BUBBLE_GAP` 6），右侧越界时夹到帧内（`BUBBLE_MARGIN` 4），下方放不下时翻到上方，帧小于气泡时贴左上角，零视口按 1 px 处理；`AnnotationBubble` 渲染 `role=group` 气泡（代码头 `tag.classes`）、自动聚焦的 textarea（2 000 字符上限，与 `ANNOTATION_COMMENT_MAX_CHARS` 一致）、`Ctrl/Cmd+Enter` 保存、`Esc` 取消、空意见拒绝并给出 `role=status` 说明。
  - `src/client/inspect/AnnotationQueue.tsx`（新增）：模块级 store + `useSyncExternalStore`（新增置顶、同 id 替换、编辑拒绝空值与未知 id、移除返回是否命中、无变更不发通知、快照在变更前保持同一引用）；`createElementAnnotation` 复用 T030 模型与品牌 `TargetId`；`renderAnnotationText` 生成发送文本；列表最新在前，显示选择器、本地时间、源码末段与行号、意见，动作为发送/编辑/移除，编辑态可保存或取消；空态复用 `EmptyState`。发送器 `AnnotationSender` 可注入，默认 `copyAnnotationToClipboard`（S2 回退），成功后移除草稿并显示返回消息，失败保留草稿并 `role=alert`，发送中禁用该条动作；**没有定时器或副作用，只有点击才发送**。
  - `src/client/preview/Canvas.tsx`：拾取后由 `stageSize` + `fitContain` 得到舞台框，再调用 `placeBubble` 定位气泡；保存即入队并 `dismiss()` 拾取，显示“已加入队列”提示与“查看队列”按钮（切到标注页签）。新拾取会清掉上一条提示。
  - `src/client/shell/StudioShell.tsx`：标注页签渲染 `<AnnotationQueue>`；队列非空时 tab 上加数量徽标（`aria-hidden`，tab 的可访问名不变）。
  - 两语 catalog 各 +20 key（`annotation.bubble.*`、`annotation.queue.*`、`annotation.item.*`），`page.annotations.empty` 改为引导文案；key 集合 160/160 一致。
  - 测试：`tests/component/annotation/` 3 文件 / 32 用例——定位（缩放/右缘夹紧/翻转/小帧/零视口）、气泡（渲染与焦点、空意见、trim、快捷键、取消、中文）、store（新增置顶/通知次数/非法拒绝）、列表（空态、顺序与字段、编辑保存/取消/空值、移除、发送成功/默认剪贴板/失败保留/发送中禁用/剪贴板写失败/跨重挂载/中文）、壳层（空态、徽标不改变 tab 名、列表可达）。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 56 文件 / **446 用例全通过**；`pnpm exec vitest run tests/component/annotation` 3 文件 / 32 用例；`pnpm build` host 192.8 KiB / client 179.4 KiB。日志 `.tmp/logs/t031-{typecheck,test,build}.log`。
- 计划偏差/限制：发送暂落剪贴板（composer 属 T032，发送器已预留注入点）；队列只在面板会话内存中，重开面板即清空（持久化/历史属 T033）；气泡位置在拾取时一次计算，视口或页面滚动后不重算；未做真实 `vibe-dev` 手测，3 步闭环的真机证据留 G3/T034。

### T033 — 标注历史（已完成，2026-10-28）

- 背景：T030 已把标注落盘到 `.vibe/annotations/<id>.json`，T031/T032 的队列只在面板内存里，重开面板即清空；需要将这些文件变成可浏览、可检索、可重新打开、可删除的历史，且在重启与坏文件下都不崩。
- 结果：
  - 契约（`src/contracts/annotation.ts`）：新增 `AnnotationHistoryQuery`/`AnnotationHistoryEntry`/`AnnotationHistoryResult`、`AnnotationHistorySaveResult`/`RemoveResult`、`isAnnotationHistoryQuery`、`isAnnotationIdParams`、`matchesAnnotationQuery`、`toAnnotationHistoryEntry`；查询上限 200 字符，`limit` 默认 50、最大 200，意见预览 300 字符 + `…`；摘要只带选择器/标签/源码位置，不带 `element.html`。搜索对 id/targetId/意见/选择器/标签/可访问名/文本/源码文件做大小写不敏感子串匹配（中文同样生效）。`src/contracts/transport.ts` 新增 `annotation.history.{list,get,save,remove}`。
  - Host（`src/host/inspect/history.ts` 新增）：`AnnotationHistoryService` 的 `list` 返回 `{entries,total,skipped}`（先全量过滤再截断，`total` 为截断前数量），`get` 对缺失/损坏文件抛 `not_found`，`save` 复用 store 校验，`remove` 对未知 id 返回 `{removed:false}`；`toAnnotationHistoryError` 把 store 错误映射成稳定码（`invalid_annotation`/`annotation_too_large`→`invalid_input`、`project_missing`→`not_found`、`path_outside_project`→`permission_denied`、`invalid_project_path`→`invalid_config`、`io`→`internal`）；`registerAnnotationHistoryMethods` 注册四个一元方法。`annotation-store.ts` 增加 `listWithIssues()`（`list()` 委托它）：坏 JSON、空文件、字段不合法、超 64 KiB、符号链接与越界文件计 `skipped`，不让一个坏文件毁掉整页历史。`src/host/index.ts` 通过 `ctx.effect` 注册并把 `annotationHistory` 放进 `ctx.provide('vibeStudio')`。
  - Client（`src/client/inspect/history-store.ts` 新增）：沿用 T031 模块级 store + `useSyncExternalStore`，注入式 `AnnotationHistoryApi`，`requestSeq` 保证快速输入时最新请求胜出；`loadAnnotationHistory` 只改内存，`persistAnnotation` 失败返回 `false` 不抛，`reopenAnnotationFromHistory` 读全文后放回队列（不发消息），`removeHistoryAnnotation` 删除后刷新列表。
  - UI（`src/client/inspect/History.tsx` 新增）：标题/计数、搜索框、加载/错误（重试）/空态/无匹配（清空搜索）/坏数据提示，条目显示选择器、本地时间、源码末段、意见；动作为重新打开与删除（二次确认），成功与失败均有 `role=status`/`role=alert` 反馈；全部钩子走 `data-vibe-history-*`。`StudioShell.tsx` 在标注页签并列队列与历史并注入 `persist`；`Canvas.tsx` 气泡保存后写历史，失败只降级提示；`AnnotationQueue.tsx` 编辑保存后写穿历史（`persist` 可选，存量 19 个队列用例无需改动）。两语各 +23 key，key 集合 184/184 一致。
  - 测试（新增 41 用例）：`tests/unit/annotation-history/history.test.ts` 27 个（排序、摘要字段、意见截断、空目录、limit/total、坏文件与超限跳过、查询校验、越界 junction→`permission_denied`、各字段与中文搜索、`get` 缺失/损坏、保存校验与覆盖、删除与“重启后仍删除”、unary 信封 400/404、注入 store）；`tests/component/annotation/annotation-history.test.tsx` 14 个（空态、条目渲染、坏数据提示、错误重试、中文、搜索与清空、重新打开入队且不发送、打开失败、两步删除/取消/已不存在/失败保留、与队列互不干扰）。`tests/setup/component.ts` 统一注入无网络 fake API，`tests/unit/config.test.ts` 与 `tests/integration/transport/host.test.ts` 顺带补上新服务与 effect 标签。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 59 文件 / **507 用例全通过**；`pnpm build` host 199.8 KiB / client 202.1 KiB。手动（`.tmp/t033-history.mjs` → `.tmp/logs/t033-history.json`，`ok:true`）：真实 Host 经 `annotation.history.save` 写入 2 条（HTTP 200，磁盘 2 文件）→ 面板列出 2 条 → 搜索“品牌色”仅 1 条 → 重新打开后队列 1 条、composer 仍为空（未自动发送）→ 停 Host 并写入坏文件 → 重启后列表仍 2 条并提示“已跳过 1 个无法读取的标注文件。”→ 两步确认删除 1 条（“标注已删除。”、该文件已删、另一条仍在、列表剩 1）；7 条 DSH 自身 mux/资源断线属停/重启噪声，Studio 面板 0 异常；清理只删本轮 3 个 id，空的 `.vibe/annotations`、`.vibe` 已移除，4337 无 LISTEN 残留。日志 `.tmp/logs/t033-{unit,component,full,test-all,typecheck,build,history}.log`。
- 计划偏差/限制：客户端 store 命名 `history-store.ts`（`history.ts` 与 `History.tsx` 仅大小写不同会被 TS `forceConsistentCasingInFileNames` 拒绝）；搜索在 Host 端全量过滤后才截断，未做索引/分页；历史只是本地记录，不随发送删除、不进聊天；保存失败不影响队列；未接 region/截图来源的历史展示。

### T034 — G3 Inspect 评审与返工（GO，2026-10-29）

- 背景：M3 的 T027–T033 已完成，G3 需验证圈选/标注/发送闭环与预算：50 元素源码 ≥ 80%、标注 ≤ 4 KB、从拾取到 composer ≤ 3 步、不自动发送。初评按“不改产品代码”执行；初评未达标后经用户批准返工并复测。
- 基线：`pnpm typecheck` 0 error、`pnpm test` 59 文件 / 507 用例、`pnpm test:e2e` 9/9。
- 初评结果：
  - ① 源码命中：`50/50 = 100%`（React 17 / Vue 17 / Svelte 16，门槛 80%），0 miss、0 console/pageerror；用真实 `buildPickerScript` + `normalizePickedElement` 在 Vite dev server + headless Edge 上逐元素拾取（`.tmp/g3/source-sample.ts` → `.tmp/logs/g3-source.json`）。`pnpm test:e2e` 的 90 元素（三框架各 30/30，行号 ±2）为交叉证据。
  - ② 标注预算：最坏输入下 `renderAnnotationText` 输出 4,094–4,096 B，均 ≤ 4,096，且无断代理对（2,000 字中文、2,000 ASCII、1,000 emoji 三组，`.tmp/logs/g3-budget.json`）。真实载体把 2,000 字中文意见送进 composer 后实测 **4,095 B**。
  - ③ 3 步进 composer：**未达标**。真实 Web 闭环记录的用户动作为：开启“拾取”→ 点击画布元素 → 输入意见 + `Ctrl+Enter` 保存 → 点击“查看队列”→ 点击“发送”（从点元素算 4 个动作）。预览与标注页签互斥，预览页签内没有发送入口，所以“查看队列”是必要点击；只有按语义阶段（圈选 / 写意见保存 / 发送）才算 3 步。
  - ④ 不自动发送：通过。保存气泡后 composer 为空、页面外 marker 0；点发送后状态“已插入对话草稿，尚未发送。”，4 s 后 composer 文本逐字节不变（4,095 B）、面板外 marker 0、无用户消息；`handoff.ts` 只调用 `captureInsertion`/`insertText`/可选 `setDraft`，没有 `submit`/`send` 路径（`.tmp/logs/g3-live.json`，`ok:true`）。
- 缺口：保存通知只有“查看队列”。建议在通知里加“发送到对话”（或气泡保存后直接提供发送），把动作压到 3 次点击。附带发现：2,000 字中文意见会在 composer 被截到约 1,617 字且气泡无截断提示；`fixtures/vite-basic` 拾取 `source: null` 属 T029 已知限制（真实项目需 dev 构建插件）。
- 返工（用户选择“通知里加‘发送到对话’”）：新增 `src/client/inspect/AnnotationSaveNotice.tsx`（保存通知：文案 + “发送到对话” + “查看队列”；本地 `idle/pending/done`，成功后隐藏发送按钮，失败保留重试）；`AnnotationQueue.tsx` 抽出并导出 `sendQueuedAnnotation`（成功才出队、失败保留草稿、无消息回退 `annotation.item.sent`）与 `clipboardSender`，队列与通知共用同一规则；`Canvas.tsx` 的 `queueNotice` 改为 `{kind, annotation}` 并渲染通知（`key` 用标注 id 重置发送状态，历史落盘失败仍只降级文案）；`StudioShell.tsx` 把 composer handoff 同时注入 `PreviewPage`（新增可选 `send` prop，缺省走剪贴板）。两语无新增 key（复用 `annotation.item.send/sending/sent/sendFailed`）。
- 返工验证：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / **514 用例**（新增 `tests/component/annotation/annotation-save-notice.test.tsx` 7 用例：不自动发送、成功清队列并隐藏按钮、无消息回退剪贴板文案、失败保留队列可重试、发送中禁用、历史失败仍可发送、中文）；`pnpm test:e2e` 9/9；`pnpm build` host 199.8 / client 204.1 KiB。真实 Web 复测（`.tmp/g3/live.mjs` → `.tmp/logs/g3-live.json`，`ok:true`）：动作 `pick-element → save-bubble → send-now`（从点元素算 **3 个**，含开启拾取 4 个），composer 4,095 B ≤ 4,096，保存后 composer 空、发送后 4 s 逐字节不变、面板外 marker 0、发送后队列 0 条、console 0。
- 环境：评审与复测写入的 `.vibe/annotations/*.json` 与空 `.vibe/` 已删除；4320/4338 无监听残留、无 Playwright Edge 残留（在跑的 msedge 为用户 21:40 自启的默认 profile）；真实 `desktop` profile 未触碰。脚本 `.tmp/g3/{source-sample.ts,budget.ts,live.mjs}` 非产品代码。
- 结论：**4 项验收全部通过，G3 GO**；第 3 项按用户确认口径“点元素 → 保存 → 发送 = 3 次点击”达标，开启拾取仍为额外 1 次点击。遗留：composer 截断无提示、`fixtures/vite-basic` `source: null`、通知与队列发送互不感知进行中状态。未开始 M4。

### 整体稳定性审查（2026-10-29，只读，未改产品代码）

- 背景：M1–M3 已逐任务验收，但未做过一次跨模块整体核对；本次按用户要求检查“功能之间是否冲突、是否有依赖错误、整体是否稳定并符合设计要求”。审查期不改 `src/`、配置、依赖或 profile，发现的问题先记录、返工与否交用户决定。
- 方法（四类证据）：
  - 基线：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / 514 用例；`pnpm build` host 199.8 / client 204.1 KiB；`pnpm test:e2e` 9/9。日志 `.tmp/audit/logs/{typecheck,test-full-*,build,e2e}.log`。
  - 静态审计（`.tmp/audit/static-audit.mjs`）：一元方法接线（contracts 常量 ↔ host `registry.register` ↔ client 调用方）、i18n key 对等与使用、import 图（方向/环/裸依赖）、护栏 grep（`ctx.webServer`、`dangerouslySetInnerHTML`、client console）。
  - 运行时冒烟（`.tmp/audit/smoke.mjs`）：`vibe-dev` + headless Edge 走完五个页签、拾取→保存→通知发送、跨页签队列/历史、重复拾取、设置→预览、Console/Network 抽屉、停止；结束后自清理 `.vibe`。
  - 依赖与隔离：`engines.dsh` 对照安装版本；只读核对三个 profile 的插件链接。
- 结果：
  - 静态：73 文件 / 279 边，**0 环、0 方向违规、0 未声明依赖**；23 个一元方法全部在 host 注册（`studio.ping` 无客户端调用者为设计）；en=zh=184，无缺失/空值，未使用 key 经逐条核对均为动态拼接；`ctx.webServer` 0、`dangerouslySetInnerHTML` 0、client console 0。
  - 运行时（`.tmp/audit/logs/smoke.json`，`ok:true`）：5 页签全部渲染且 `errorBoundary:false`；拾取→保存后 composer 仍为空（不自动发送），通知为“已加入标注队列 / 发送到对话 / 查看队列”；切到标注页签后队列 1 条、徽标 1、历史 1 条；从队列发送后 composer 含标记、队列 0；历史重开入队、两步删除后 0；设置“预览”读到 1280×720 并提示“已应用到运行中的预览。”；Console/Network 抽屉可开；停止后 `state:"idle"`；`consoleErrors: []`。
  - 依赖：安装 `@deepseek-ai/dsh` 0.2.1-rc.2，满足 `engines.dsh >=0.2.1-rc.2`；运行时仅 import `@deepseek-ai/schemastery`（已声明）。
  - 隔离：只有 `vibe-dev` 链接本插件并列入 `dsh.profile.bundles`；`desktop`/`web` 零引用。
- 发现（未改代码，待用户决定）：
  - 中：Windows 下 `annotation-store.save()` 覆盖既有文件时 `rename` 偶发 `EPERM`（3 次全量中 1 次失败，单文件连跑 5 次全过）。影响仅历史落盘，UI 已有“已加入队列，但没能保存到历史。”降级，队列与发送不受影响。已在同次返工中加有界重试（见下）。
  - 低：拾取模式在切换页签后仍保持（Host 持有），返回预览页时开关仍为按下——目标默认 headless，影响有限，但缺“离开即暂停”的选择。
  - 低：保存通知在切走预览页签后消失（队列/历史已保留该条），用户切回看不到刚保存的反馈。
  - 低：`.vibe` 根目录取 `process.cwd()`（`src/host/index.ts` 已有 TODO），从别的目录启动 DSH 时历史会落到启动目录；同一次运行内一致。
  - 低（已知）：`retentionDays`/`contextBudgetBytes`/`screenshotEnabled` 已解析但尚未消费（DEVLOG 已记）；`newAnnotationId` 在同一毫秒、两个客户端并发时理论可重（id 去重会挡重复入队）。
  - 信息：composer 中的标注文本为英文结构化格式，属 SPEC“注释用英文；UI 文案 zh/en 分离”的设计，不是本地化缺陷。
- 返工（用户批准，2026-10-29，仅加固 EPERM 重试）：`src/host/inspect/annotation-store.ts` 把 `rename` 抽成可注入的 `RenameFile`（`AnnotationStoreOptions.renameFile`，生产默认 `fs.rename`），新增 `replaceFile()`：对 `EPERM`/`EBUSY`/`EACCES` 最多重试 4 次（20/50/100/200 ms，共 5 次尝试），其余错误立即抛出；临时文件清理与 `io` 错误映射不变。`createAnnotationStore(projectDir, options?)` 透传可选参数。新增 3 个单测：连续 2 次 EPERM 后成功（`attempts=3`）、EBUSY 持续失败有界退避后报 `io` 且旧文件与目录保持不变（`attempts=5`）、`ENOENT` 不重试（`attempts=1`）。验证：`pnpm typecheck` 0 error；单文件 5 连跑 13/13；`pnpm test` 3 连跑 **60 文件 / 517 用例全过**；`pnpm build` host 200.6 / client 204.1 KiB；`pnpm test:e2e` 9/9。未动其余低风险项。
- 清理：冒烟写入的 `.vibe/annotations/*.json` 与空 `.vibe/` 已删除；4320/4338 无监听残留、无 Playwright Edge 残留；真实 `desktop`/`web` profile 未触碰。脚本与日志在 `.tmp/audit/`，不入库。

### 文档 — M3 手动测试手册（2026-10-29，仅文档）

- 背景：M2 已有 `docs/2026-10-28-手动测试手册.md`，M3（T027–T034）只在 `tasks/todo.md` 与 DEVLOG 里留有验收记录，用户按同一结构补一份可自测的手册。
- 产出：新增 `docs/2026-10-29-M3手动测试手册.md`（约 35–45 分钟，单次完整复测）：一次性准备（`pnpm install`/`build`、profile 链接核对与 `link:` 兜底）、启动（4320 fixture、可选 4321/4322/4323 三框架源码 fixture、`vibe-dev` 4317）、分组流程（拾取开关与 Alt+Click、拾取/卡片/气泡、意见输入与保存通知、通知“发送到对话”、队列、历史含坏文件注入、源码适配、4 KB 预算测量、清理）、测试表 K/X/S/A/N/Q/H/B/L（共 50 项）、G3 四项验收映射与 T027–T034 覆盖表、易误判的正常行为、排障、结果记录模板（`.tmp/logs/manual-2026-10-29-m3.md`）。
- 口径：所有步骤对照当前实现（组件文案、`data-vibe-*` 钩子、Host 侧规则）编写；明确“拾取模式保存后仍保持”“通知切页签后消失但队列/历史保留”“队列仅内存、F5 清空而历史落盘”“3 动作不含开启拾取”“`fixtures/vite-basic` 无源码属设计”“2,000 字中文意见在 composer 被截到约 1,617 字且无提示”等易误判点。
- 验证：仅文档改动，未改 `src/`、测试、依赖或 profile，故不重跑 typecheck/单测/build/e2e；手册内命令按当前 `package.json` 脚本与 `tests/e2e/source-adapters.spec.ts` 的真实启动方式核对。
- 同步：`README.md` 状态句、导航链接、M3 完成条目与“下一步 T035”均已更新并链到新手册。

### M3 合并（2026-10-29，用户手测通过后批准）

- 用户按 `docs/2026-10-29-M3手动测试手册.md` 完成手动检测，功能无问题，批准提交、推送与合并。
- 回归（分支 `task/m3-inspect` 末端 `830fd0a`，与合并后的 `main` 树一致）：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / **517 用例**；`pnpm build` host 200.6 / client 204.1 KiB；`pnpm test:e2e` 9/9。日志 `.tmp/logs/merge-{typecheck,test,test-2,build,e2e}.log`。
- 首跑全量 1 失败（环境误报，已复现处理）：`tests/integration/preview/picker-edge.test.ts` 的“无 Playwright Edge 残留”断言在测试结束时看到 10 个带 `playwright_chromiumdev_profile` 的 Edge 进程，5 s 内未退出；单文件复跑通过、全量复跑 517/517 通过，失败属测试窗口内机器上有其他 Edge 未退（用户手测预览），非产品缺陷。未杀任何用户进程。
- 合并：`task/m3-inspect`（`830fd0a`）以 `--no-ff` 合并入 `main`（`eae874a`）并推送（`fcabc0a..eae874a`）；`main` 树与分支末端一致；`task/m3-inspect` 远端保留。未开始 M4/T035。

### U02 — M3.5 标注发送入口与状态归位（2026-10-29，`task/m3-ui-refine`）

- 背景：用户《M3修改意见》（`界面审查/M3修改意见.docx`，未入库）三条：① 气泡在“加入标注队列”与“取消”之间加“发送到对话”，直接落历史并进对话；② 两条状态提示（“已插入对话草稿，尚未发送。”“已重新放入上方队列，尚未发送。”）不消失、不分标注且都堆在列表最底部，“标注已删除”也不消失、删除应改弹窗；③ 状态提示移到每张卡片内“移除/删除”右侧并按标注同步，队列移除后解除历史提示、队列发送后解除两处状态。
- 实现：新增 `src/client/inspect/annotation-status.ts`（模块级 `Map<id,{kind,message}>` + `useSyncExternalStore`，跨页签保留）；`AnnotationBubble` 增 `onSend` 与三按钮行（`data-vibe-bubble-send` 与队列 `data-vibe-annotation-send` 区分，`Ctrl+Enter` 仍只入队），气泡尺寸常量 240×168 不变；`Canvas.queuePickedComment`/`sendPickedComment`（发送 = 入队 + 落盘 + `sendQueuedAnnotation`，落盘失败只降级提示），`QueueNotice` 拆为 `{annotation,persisted,sent}`；`AnnotationSaveNotice` 增 `sent`/`initialMessage` 并用 effect 接收挂载后才到达的直达发送结果（成功后收起“发送”）；队列/历史删除底部状态行，提示渲染在卡片操作行内（`margin-left:auto` 右对齐）；`sendQueuedAnnotation` 成功/失败都写共享提示，队列移除/编辑与历史删除会 `clearAnnotationStatus`；历史删除改自定义 `role="dialog"` 弹窗（遮罩/Esc/取消退出，失败提示在弹窗内，成功后无残留文案）。两语 +`annotation.bubble.send`、+`annotation.history.deleteConfirm.{title,body}`、−`annotation.history.{deleted,gone}`（184→185）。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / **529 用例**（+12）；`pnpm build` host 200.6 / client 210.7 KiB（+6.6）；`pnpm test:e2e` 9/9。真实载体 `.tmp/u02-verify.mjs` → `.tmp/logs/u02-verify.json`（`ok:true`，0 console error，12 动作）：按钮顺序、直达发送后 composer 含完整标注、队列 0/历史 1（首版历史卡片显示发送结果，修正后为空）、列表底部状态 0、重开双边提示、队列移除清提示、删除弹窗 Esc/取消/确认行为、3 s 后草稿逐字节不变；截图 `.tmp/logs/u02-{01-bubble,02-history-status,03-delete-dialog}.png`。
- 口径修正（同日，用户实测反馈“上方队列点发送后历史队列的状态还在”）：`sendQueuedAnnotation` 成功分支由“写入成功提示”改为 `clearAnnotationStatus(annotation.id)`，两个列表同时解除；发送结果仍返回给调用方，气泡保存通知照常显示“已插入对话草稿，尚未发送。”。同步更新队列/历史组件测试与 `.tmp/u02-verify.mjs`（新增“重开 → 队列发送 → 两边状态为空”）。复测：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / 527 用例通过，另 2 个 `edge.test.ts`/`picker-edge.test.ts` 的“无 Playwright Edge 残留”断言因用户正在运行的 `vibe-dev`（4317）预览 Edge 而失败（父进程为该 DSH host，属已知环境误报，与本改动无关）；`pnpm build` host 200.6 / client 210.7 KiB；`pnpm test:e2e` 9/9；真实载体 `ok:true`（`historyStatusAfterSend: null`、`queueStatusAfterQueueSend: null`、`historyStatusAfterQueueSend: null`、`notAutoSent: true`）。
- 清理：测试写入的 `.vibe/annotations` 与空 `.vibe/` 已删除；4320/4338 无监听残留；`desktop`/`web` profile 未触碰。

### U03 — 拾取注入与重开会话恢复（2026-10-29，`task/m3-ui-refine`）

- 背景：用户实测三连反馈——① 出现 `vibe-studio: element picking is unavailable on this page`；② 有时点击选不中元素；③ 在面板里“停止 → 再启动”最容易复现，有时过一会儿能选中，有时长时间都不行，只能刷新整个浏览器页面。改前基线：`install()` 只发 `Runtime.enable`/`Runtime.addBinding`/`Page.addScriptToEvaluateOnNewDocument`/`Runtime.evaluate`，没有 `Page.enable`。
- 定位（含机制验证，脚本留在 `.tmp/probe-addscript*.mjs`）：单独调用 `Page.addScriptToEvaluateOnNewDocument` 会返回 `{"identifier":"1"}`，但**不生效**；同一会话先 `Page.enable` 后，脚本在下次导航正确执行（`runImmediately: true` 只影响当前文档）。所以此前只有首个文档有 `window.__vibePicker`，任何 reload/导航（HMR 整页刷新、dev server 重启、工具栏导航、地址跳转）之后 `activate()` 都返回 false，面板便报 “unavailable on this page”；而会话启动时的 `install()` 失败被吞成 `capabilities.pick = false`，只剩 `pickStart` 把原始错误抛给用户。另外两个成因：页面自身导航后 Host 的 `activeNow` 不复位（面板显示“正在拾取”，点击无效）；客户端 `dismissedSeq` 跨会话残留，而 Host 的 `seq` 每会话从 0 重计，导致新会话的首次拾取被旧关闭记录挡住（“过一会儿才行”是因为序号刚好爬过旧值）。
- 实现：`src/host/inspect/inject.ts` ① `install()` 在 `Runtime.addBinding` 前加 `Page.enable`；② 新增 `onFrameNavigated`，仅顶层帧复位 `activeNow`（子帧导航不影响），`teardown()` 同步 `off`；③ `activate()` 在当前文档缺脚本时先重装一次再重试启动，仍失败才抛原错误。`src/client/inspect/Picker.tsx` 在 `enabled` 变 false 时 `setDismissedSeq(0)`。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / **533 用例**，532 通过，1 个已知环境误报（`picker-edge.test.ts` 的“无 Playwright Edge 残留”断言看到用户 4317 预览的 Edge）；`pnpm build` host 201.1 / client 210.7 KiB；`pnpm test:e2e` 9/9。新增/更新用例：安装顺序锁到 `Runtime.enable → Page.enable → Runtime.addBinding → Page.addScriptToEvaluateOnNewDocument → Runtime.evaluate`、顶层帧 vs 子帧导航、`activate()` 重装序列（START → 脚本 → START）与无法修复时仍拒绝、dispose 解绑 `Page.frameNavigated`、组件侧“重开会话后第一次拾取可见”。
- 真实载体（`.tmp/verify-pick-recovery.mjs` → `.tmp/logs/verify-pick-recovery.json`，一次性 `vibe-dev` 4341 + 探针服务 4323 + 死端口 4322，`ok:true`，0 console error）：基线气泡 true；页面自身 reload 后拾取态复位、新文档 `PROBE-PARSE/LOAD object`、再拾取 true；`location.href` 导航同样；不可达端口给“preview page is not reachable”，回到活页后不重启即可捡起；面板内停止再启动后首次点击直接出气泡。改前同一脚本的探针显示 reload 后 `__vibePicker` 为 `undefined`。
- 注意：用户当前运行的 DSH（4317）载入的是旧 `lib/*`，需要重启 DSH 才会用上新包。
- 清理：验证用的 4341/4323/4322 端口与 Edge 全部 `taskkill /T /F` 清理；未触碰 4317、`desktop`/`web` profile。
- 用户手测确认后推送并合并：`task/m3-ui-refine`（`d110ad5`）推送到 `origin`，以 `--no-ff` 合并入 `main`（合并提交 `a1c7577`，含 U02 与 U03）；`main` 回归 `pnpm test` 60 文件 / **533 用例全通过**、`pnpm build` host 201.1 / client 210.7 KiB、`pnpm test:e2e` 9/9；分支保留。`.gitignore` 增 `界面审查/`（用户审查材料不入库），空 `.vibe/` 已清理。

### T035 — HTTP 执行器（2026-10-29，`task/m4-api-workbench`）

- 目标：M4 API Workbench 的执行底座——method/url/query/headers/body/auth，加上超时、取消、重定向策略与响应上限；不改 UI、不接 unary。
- 契约：新增 `src/contracts/api.ts`，把请求与结果定义成纯 JSON（体走 text/base64），`isHttpRequestSpec`/`isHttpRequestBody`/`isHttpAuth` 手写守卫；`src/contracts/index.ts` 导出。
- 归一化（`src/host/api/request.ts`）：只允许 http(s)；拒绝 URL 内凭证并提示改用 auth 字段；拦截 169.254.0.0/16 与 metadata 主机（`permission_denied`/`blocked_host`）；query 行合并（禁用行跳过、保留 URL 原有参数）；header 名/值校验（禁 CRLF、禁 `host`/`content-length` 等 runtime 头、大小写不敏感查重、保留原大小写）；bearer/basic/api-key（header 或 query；显式 `Authorization` 冲突报 `invalid_input`）；JSON（先 parse）/text/form/multipart 编码，multipart 用可注入 boundary、base64 严格校验、文件 ≤ 4 MiB；GET/HEAD 禁 body；timeout 100 ms–300 s、maxRedirects 0–10、响应上限 1 KiB–16 MiB。
- 执行（`src/host/api/executor.ts`）：超时与调用方 `AbortSignal` 共用一个 `AbortController`；`redirect: 'manual'` 手写跟随以记录 hop 并实现三种策略——`follow` 下 303→GET、301/302 的 POST→GET 并去掉 body 头、307/308 原样重发；`manual` 停在 3xx；`error` 抛 `redirect_not_allowed`；超 `maxRedirects` 抛 `too_many_redirects`；跳到非 http(s)/metadata 抛 `blocked_redirect`。响应体流式读取，超过 `maxResponseBytes` 立即截断并 `reader.cancel()` 释放连接；响应头经 `redactHeaders`；错误映射 `timeout` / `network_error{cancelled|request_failed|invalid_redirect}`，只附 undici cause code，不回显请求内容。
- 验证：`pnpm typecheck` 0 error；`pnpm test` 62 文件 / **567 用例**（新增 `tests/unit/http-executor/` 2 文件 / 34 用例，executor 跑真实 `node:http` echo server）；`pnpm build` host 221.1 / client 210.7 KiB；`pnpm test:e2e` 9/9。
- 设计取舍：跨源重定向保留 `Authorization`（与 curl/Postman 一致，未做浏览器式剥离）；文本一律按 UTF-8 解码，不解析 charset；结果带截断后的 base64（≤16 MiB），二进制预览/下载留给 T039/T040；`fetchImpl`/`now`/`boundary` 只作测试注入点。
- 遗留：尚未注册 `api.http.send` 一元方法与 UI（T038 接）；`api-workbench` 模块尚无 `ApiService` 聚合（T037/T038 落位）。

### T036 — 环境、变量与密钥（2026-10-29，`task/m4-api-workbench`）

- 目标：环境模型与 `{{var}}` 解析、接入 `ctx.credentials`、只读 environment UI；不接 unary、不做持久化、不动 profile。
- 契约（`src/contracts/api.ts`）：`ApiEnvironment`/`ApiEnvironmentVariable`（`secret` 变量只存凭证引用名，不存值）、客户端安全视图 `ApiEnvironmentView`/`ApiEnvironmentVariableView`（明文行带 `value`，secret 行只有 `configured`/`writable`/`source`）、`UnresolvedVariable{name, where, reason}`、`API_ENV_*` 限额；守卫 `isApiEnvironment*`，其中 `isApiEnvironmentView` 拒绝 secret 行携带 `value`，让“密钥不回传”成为类型与运行时的双重约束。
- 密钥接缝（`src/host/api/secrets.ts`）：`createApiSecretStore({ credentials })` 以结构化类型镜像 DSH credentials 服务，不新增依赖、不引入 branded 类型；`resolve` 仅 host 使用，空/缺失视为未配置；无 provider 时 describe 报未配置、写操作 `permission_denied{credentials_unavailable}`；provider 异常映射 `internal{credential_resolve_failed|credential_store_failed}` 且不回显值或原始消息。
- 解析（`src/host/api/environment.ts`）：`parseApiEnvironment()` 校验名字/重名/secret 必须指向凭证名；`resolveHttpRequest(request, { environment, secrets })` 按字段展开 url、query 行、header 名与值、JSON/text/form/multipart 元数据与 auth（base64 文件内容不展开），失败逐字段产出 `unresolved`（`missing | secret_not_configured | disabled`）；单次扫描，展开值里再出现 `{{x}}` 不二次展开；同一请求内密钥按引用缓存、只 resolve 一次。`describeEnvironment()` 产出客户端视图（describe 抛错按未配置），`secretReferences()` 列出引用。
- 接线与 UI：`src/host/index.ts` 服务槽新增 `apiSecrets`，`HostContext` 增加可选 `credentials`，渲染时用 `ctx.credentials` 构造 store；`src/client/api/EnvironmentEditor.tsx` 为只读面板（明文值、密钥仅配置状态与来源、禁用标记、未解析列表与徽标、空态），`api.env.*` 中英 14 键一致。
- 验证：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/unit/api-env tests/component/api` 3 文件 / 21 用例通过；`pnpm test` 65 文件 / **588 用例**（基线 62 / 567）；`pnpm build` host 232.1 / client 211.9 KiB；`pnpm test:e2e` 9/9。日志 `.tmp/logs/t036-{test,build,e2e}.log`。
- 设计取舍：host 侧 `resolveHttpRequest()` 可能含明文密钥，只留在 host、永不过 unary；客户端只拿 `describeEnvironment()` 的产物，并用测试断言 `JSON.stringify(view)` 不含明文。`{{var}}` 单次展开、不支持嵌套/表达式；describe 失败与无 provider 统一显示“未配置”。
- 遗留：未注册 unary 方法、面板未挂页面（T038）；集合/历史持久化与 `.vibe` 落盘（T037）；密钥写入 UI 待 T038 决定放置位置。

### T037 — 集合与历史持久化（2026-10-29，`task/m4-api-workbench`）

- 目标：集合/文件夹与请求历史的 `.vibe/api` JSON 持久化、原子写、脱敏与 schema 校验；不接 unary/UI（T038）。
- 契约（`src/contracts/api.ts`）：`ApiSavedRequest`/`ApiCollectionFolder`（仅一层文件夹）/`ApiCollection`、`ApiHistoryEntry{id, at, method, url, status?, elapsedMs?, request}`、`ApiHistoryQuery`，`API_STORE_ID_PATTERN`、`API_COLLECTION_FILE_BYTES_MAX`=256 KiB、`API_HISTORY_FILE_BYTES_MAX`=1 MiB、`API_HISTORY_ENTRIES_MAX`=200 等限额与 `isApiStoreId`/`isApiCollection`/`isApiHistoryEntry`/`isApiHistoryQuery` 守卫；`redactHttpRequest()` 是持久化的唯一入口——URL 凭证与敏感 query 参数清除、敏感 header/query/form 行置 `REDACTED`、auth 保留 kind（bearer token / basic password / api-key value 置 `REDACTED`，用户名与键名保留）、JSON body 递归脱敏、multipart 丢弃文件字节（只留 field/fileName/contentType）。
- 文件层（`src/host/api/store-files.ts`）：`.vibe/api` 的路径封闭（realpath + junction/symlink 拒绝，越界 `path_outside_project`）、解析前大小上限、同目录临时文件 + `rename` 原子替换（EPERM/EBUSY/EACCES 有界重试）、坏文件/坏 JSON/超限读作 `undefined`；`ApiStoreError` 稳定码供 T038 映射到 `StudioError`。
- 集合（`src/host/api/collection-store.ts`）：`.vibe/api/collections/<id>.json` 一集合一文件；`save` 先 `isApiCollection` 校验、再 `redactCollection`、再原子写；`read` 坏文件返回 `null`；`list` 按名排序、文件名 id 与内文 id 必须一致、不一致/坏文件计入 `skipped`；`remove` 幂等；`duplicate(id,{id?,name?})` 新集合 id + 全部嵌套新 id，源文件不动，源缺失 `not_found`。
- 历史（`src/host/api/history-store.ts`）：单个有界 `.vibe/api/history.json`（`{version:1, entries}`），最新在前、200 条封顶；`append()` 先脱敏再记录（`at`/`status`/`elapsedMs` 可选，`now`/`nextId` 可注入）；`list({query?, limit?})` 按 method/url/status 子串过滤、`total` 是截断前匹配数、`skipped` 统计非法条目、默认 `limit` 50；`clear()` 删文件；坏文档读作空并在下次 append 重建。
- 验证：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/unit/api-store` 3 文件 / 26 用例通过；`pnpm test` 68 文件 / **614 用例**（基线 65 / 588）；`pnpm build` host 253.4 / client 211.9 KiB；`pnpm test:e2e` 9/9。日志 `.tmp/logs/t037-{typecheck,test,build,e2e}.log`。
- 设计取舍：持久化入口统一走 `redactHttpRequest()`，变量保持 `{{name}}` 原样（只在发送时展开），所以落盘文件不接触已解析的密钥；文本型 body 无法按键判断敏感内容，原样保留；多部件文件字节不落盘（面板在发送前重新附加）；文件夹只支持一层以保持文件格式可校验。
- 遗留：未注册 unary 方法、未挂 UI（T038），也还没有“发送时自动写历史”的调用方；`ApiStoreError` → `StudioError` 的映射留给 T038。

### T038 — 请求构建 UI（2026-10-29，`task/m4-api-workbench`）

- 目标：method/URL/query/headers/body/auth 的表单、发送与取消、校验与可读错误；同时补上 T035–T037 缺失的 host unary 接线。
- 契约与 Host（`src/contracts/api.ts`、`src/host/api/service.ts`、`src/host/index.ts`）：`API_HTTP_SEND_METHOD = 'api.http.send'`；`ApiService.send` 先校验参数与环境文档（`invalid_input` + `details.field`），再 `resolveHttpRequest`（`{{var}}` 展开、每个密钥只 resolve 一次）→ `HttpExecutor.execute`，返回 `{result, unresolved}`；`registerApiMethods` 在 `apply()` 以 `ctx.effect(..., 'vibe-studio: api methods')` 注册，unary 的 `context.signal`（即 `request.signal`）直接传给执行器，客户端中止即取消 host 请求。展开与执行都留在 host，解析后的密钥不进响应。
- `store-files.ts` 新增 `toApiStoreStudioError()`：`invalid_id|invalid_data|too_large → invalid_input`、`path_outside_project → permission_denied`、`not_found → not_found`、`io → internal`；消息用固定文案（store 原始消息含绝对路径，不外泄），`details.reason` 保留原错误码。供 T044 的集合/历史 unary 方法复用。
- 客户端模型（`src/client/api/request-model.ts`）：纯函数 `buildRequestSpec(draft)` → `{ok:true, spec}|{ok:false, issues}`；校验 URL 缺失/非绝对 http(s)/含凭证、`query[i]`·`headers[i]` 行名缺失、header 名 token 与 CR/LF、大小写不敏感重复、JSON 体解析、bearer/api-key 必填、multipart 文件字段名；禁用行保留 `enabled:false` 但不过校验，空行丢弃。`readFileAsBase64`（`FileReader.readAsDataURL` 去前缀）、`fieldNameForFile`。
- 客户端 UI（`RequestForm.tsx`/`RequestBuilder.tsx`）：四个分区（查询参数/请求头/请求体/认证）、body 四种 kind（JSON/text/form/multipart，multipart 支持文件选择）、auth 三种 kind；发送时创建 `AbortController`，取消/卸载中止；`TransportError` 映射为可读标题（超时/被策略拦截/网络/过大/输入无效/内部），host 消息作为明细；结果行 `HTTP {status} {statusText} · {elapsed} ms · {bytes}` 与截断标记；未解析变量单独提示。默认发送器 `createTransportSend()` 走 `callUnary`，`timeoutMs = spec.timeoutMs + 5 s`。`StudioShell` 的 API 页签改为渲染 `RequestBuilder`。
- 验证：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/unit/api-store tests/unit/api-send tests/component/api-request` 7 文件 / 49 用例通过；`pnpm test` 72 文件 / **637 用例**（基线 68 / 614）；`pnpm build` host 256.3 / client 251.4 KiB；`pnpm test:e2e` 9/9。日志 `.tmp/logs/t038-{typecheck,test,build,e2e}.log`。
- 设计取舍：面板只把未展开的 spec 交给 host——`EnvironmentEditor` 的密钥行本来就没有能装值的字段，展开后也不回传，明文密钥始终不进 client 状态。组件测试注入 `ApiSend`，因此断言的是真正会过 unary 的 spec，校验失败的草稿一次都不会发。
- 限制：unary envelope 上限 64 KiB（`MAX_UNARY_BODY_BYTES`），multipart 实际可传文件约 48 KiB，与契约的 4 MiB/文件 不符，大文件需后续专用上传通道；发送后尚未自动写历史/集合（T044）；响应体查看在 T039。

### T039 — 响应查看 UI（2026-10-29，`task/m4-api-workbench`）

- 目标：把 `api.http.send` 的结果变成可读的响应视图——状态/耗时/大小/headers/body，raw 与基础 JSON 美化，10 MB 响应不冻结。
- 组件（`src/client/api/ResponseView.tsx`、`ResponseHeaders.tsx`）：状态徽标按 2xx/3xx/4xx/5xx 着色；元信息 `{elapsed} ms · {bytes}`、content type、重定向次数、截断徽标；`body|headers` 页签，`pretty|raw` 只在 body 可解析为 JSON 时出现。导出纯函数 `buildBodyContent(result)`（`text`/`binary`/`empty` 三态，`HttpResponseBody.text === null` 即二进制，空体按 `bytes` 区分）与 `formatResponseBytes`，T040 可直接复用。`ResponseHeaders` 逐行渲染 `data-vibe-response-header`，空态与“敏感值已由 Host 脱敏”说明；client 不接触密钥。
- 性能策略：不引入虚拟化依赖（项目规则：依赖最小）。body 按 `RESPONSE_PAGE_BYTES = 64 * 1024` 字符分页，`Page n of m` 前后翻页；JSON 只在 ≤ `RESPONSE_PRETTY_MAX_CHARS = 256 * 1024` 时 `JSON.parse` + 重新序列化，超出保持 raw 并显示 `api.response.jsonTooLarge` 提示。这样任何响应在 DOM 中最多一个 64 KiB 文本节点。
- 接线：`RequestBuilder` 已发送分支改为渲染 `ResponseView`，删除 T038 的重复结果行与本地 `formatBytes`；删除随之失效的 `api.request.result.summary` / `api.request.result.truncated`，新增 17 个 `api.response.*` 键，中英同步。
- **真实载体缺陷（手动启动才发现）**：`apply()` 读 `ctx.credentials`（T036 密钥 seam），但 `inject` 只声明了 `connection`；Cordis 对未声明的服务访问直接抛 `cannot get property "credentials" without inject`，插件在 `vibe-dev` 里完全没激活。单测用裸 ctx 调用 `apply()`，绕过了 inject 校验，所以 637 个用例全绿也发现不了。修复：`src/host/index.ts` 的 `inject = ['connection', 'credentials']`。教训：任何 `ctx.<service>` 读取都必须先出现在 `inject`；带新服务依赖时至少启动一次真实 host。
- 验证：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/component/api-response tests/component/api-request` 3 文件 / 25 用例；`pnpm test` **73 文件 / 647 用例**（基线 72 / 637）；`pnpm build` host 256.3 / client 263.8 KiB；`pnpm test:e2e` 9/9。手动 `.tmp/t039-manual.mjs`（dsh `vibe-dev` + 无头 Edge，本地 echo 服务）：10 MB 端点显示 `HTTP 200 OK`、`87 ms · 4.0 MB`、截断徽标、DOM 65536 字符、`第 1 / 64 页`、翻页 1.1 ms；500 端点 `HTTP 500 Internal Server Error` + 32 B 正文；0 控制台错误。证据 `.tmp/logs/t039-web.json`。
- 设计取舍：10 MB 验收在视图层用组件测试证明（真实端点会先被执行器 `maxResponseBytes` 默认 4 MiB 截断），手动检查同时验证了截断提示不会骗人。分页按字符切，超长单行会跨页断开——比一次性塞进 DOM 更可接受。
- 限制：二进制/HTML/图片预览与下载是 T040；响应体上限仍由执行器决定；分页无“跳到第 n 页”输入。

### T040 — 富响应体（2026-10-29，`task/m4-api-workbench`）

- 目标：JSON 改为可折叠树、HTML 进沙箱 iframe、图片按 base64 内联、任意二进制可下载，全部带深度/节点上限。
- `src/client/api/JsonTree.tsx`：`buildJsonTree(value, {maxNodes, maxDepth})` 先建有限模型再渲染，`JSON_TREE_MAX_NODES = 2000`、`JSON_TREE_MAX_DEPTH = 16`、`JSON_TREE_INITIAL_DEPTH = 2`；超预算置 `truncated`，触顶深度返回 `deep: true` + `omitted` 并置 `depthLimited`，两者都有独立说明行而不是静默丢数据。值只用 React 文本节点输出（`"<img ...>"` 原样显示），展开状态按路径存 `overrides`，`text` 变化时清空。`JsonContainer`/`JsonScalar` 拆开是因为判别式 `'object' | 'array'` 的联合成员无法用 `!== 'object' && !== 'array'` 收窄，改用 `isContainer` 守卫。
- `src/client/api/HtmlPreview.tsx`：`<iframe sandbox="" srcDoc={html}>` + `csp="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"`（`@types/react` 没有 `csp`，用 ref 设属性）。沙箱化后脚本、表单、弹窗与外网请求全部失效，HTML 永远不进面板文档。
- `src/client/api/ImagePreview.tsx`：只认 8 种图片 MIME，`data:<type>;base64,...` 交给浏览器解码；SVG 落在 `<img>` 里也不会执行脚本。类型不在白名单时显示说明而不是坏图。
- `ResponseView.tsx` 集成：默认模式按内容开箱——JSON → `tree`、HTML → `html`、其余 `raw`；JSON 额外给 `pretty` 文本视图，HTML 给 `raw` 以便看源码。二进制分支优先内联图片（仅当未截断且 base64 非空），否则显示大小说明；任何有 base64 的二进制都给“下载”按钮，`downloadResponseBody` 用 `Blob` + 对象 URL + `<a download>`，扩展名按 MIME 映射，点击后 `revokeObjectURL`。
- 文案：新增 9 个 `api.response.*` 键（`mode.tree`、`mode.html`、`tree.truncated`、`tree.depth`、`tree.invalid`、`html.sandbox`、`download`、`image.alt`、`image.unsupported`），中英同步；`api.response.binary` 从“暂不支持预览”改为“该类型暂无内联预览”，因为图片现在能预览。
- 验证：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/component/api-rich-response tests/component/api-response tests/component/api-request` 4 文件 / 43 用例；`pnpm test` **74 文件 / 665 用例**（基线 73 / 647）；`pnpm build` host 256.3 / client 279.0 KiB；`pnpm test:e2e` 9/9。新增 `tests/component/api-rich-response/rich-response.test.tsx` 17 用例（节点/深度上限、默认折叠与展开、字符串不当 HTML、无效 JSON、zh-CN、iframe `sandbox=""`+CSP+srcdoc、`window.__xss` 未执行、data URI 与白名单、扩展名映射、Blob 字节与文件名、空体不下载、ResponseView 的 HTML/图片/PDF 集成）；T039 的默认模式断言改成“默认树 + 点美化看 `<pre>`”。
- 手动（真实载体）：`.tmp/t040-manual.mjs` — dsh `vibe-dev` + 无头 Edge，本地服务提供 `/json`、`/html`（含 `<script>window.__xss=1</script>`）、`/png`（1×1 PNG）、`/pdf`。结果 `.tmp/logs/t040-web.json` `ok:true`：JSON 默认树、4 个折叠开关、展开后 `admin` 出现；iframe `sandbox=""`、CSP 正确、`srcdoc` 含脚本但 `window.__xss` 仍为 undefined、面板文本不含 `<h1>`、切 raw 能看到脚本源码；图片 `naturalWidth/Height = 1`、`src` 为 `data:image/png;base64,`；PDF 下载文件名 `response.pdf`、流式读取 59 B 与服务端一致；0 其他控制台错误。
- 设计取舍：节点/深度双上限而不是只限深度——一个 2000 键的对象同样能拖垮渲染；截断时显示计数而不是“静默省略”。被截断的图片不做内联预览，因为半个 PNG 只会显示坏图，下载按钮仍可用。CSP 拒绝没有产生控制台错误（headless Edge 不记录），所以 XSS 验收以 `sandbox` 属性 + `window.__xss` 未定义 + 面板 DOM 不含脚本三点为准。
- 限制：下载走整段 base64 → `atob` → `Uint8Array`，上限仍由执行器 4 MiB（base64 ≤ 16 MiB 契约）决定，大文件需专门通道；图片预览只按 MIME 判断，不校验文件头；HTML 预览固定 280 px 高、无“在新标签打开”。

### T041 — S7 OpenAPI spike（2026-10-29，`task/m4-api-workbench`）

- 目标：用 500 端点样例测 OpenAPI 3.x 解析/映射耗时，验证远程 `$ref` 拦截、循环 `$ref`、SSRF 限制与可读错误。
- `spikes/s7/run.ts`：零新增依赖（Node 内置 + `src/contracts`），脚本内生成 100 路径 × 5 方法 = 500 操作（327,748 B、10 tag、server 变量、allOf/自引用 schema、query/header/cookie、300 个 JSON 体）。链路拆成 parse（JSON + 结构扫描）/ bundle（远程 ref）/ map（参数/体/认证/示例）/ serialize 四段分别计时；每个映射结果用真实 `isHttpRequestSpec` 校验。远程用例只访问自起 `127.0.0.1` fixture，允许清单用例用假 fetch。
- 实测（`pnpm tsx spikes/s7/run.ts`，36/36 PASS，原始数据 `.tmp/logs/s7-results.json`）：500 端点冷启动 **28.67 ms**（parse 12.76 / bundle 3.47 / map 12.45 / serialize 1.31），热启动中位数 **16.15 ms**（12.62–18.57）；250 / 1000 操作中位数 6.69 / 29.26 ms（约 0.03 ms/操作），1000 操作最慢 32.21 ms，验收线 5 s 余量约 170 倍。
- 映射：500/500 契约有效；10 组 tag；体 none 200 / json 300；认证 bearer 350 / basic 50 / api-key 50 / none 50；`{id}` → `{{id}}`；server `{env}/{base}` 代入默认值；唯一警告 30 个 cookie 参数不支持。
- SSRF：默认公网 ref `remote_ref_blocked` 且 **0 fetch**；13/13 策略矩阵（loopback 需显式开关、显式 origin 精确端口、169.254/元数据/`file:`/URL 凭据/RFC1918/阿里云元数据全拒）；loopback 1 次 fetch、同文档去重；302 → 元数据 `remote_ref_redirect` 不跟随；content-length 与 chunked 两种 2 MiB 均 `remote_ref_too_large`；坏 JSON / 404 `remote_ref_failed`。
- 循环：纯别名环抛 `ref_cycle`（`PureA -> PureB -> PureA`），映射时体降级 `none` 并保留警告；结构环 A↔B 4/4 有效（`{"b":{}}`）；自引用数组示例 `{"id":"n1","children":[]}`。
- 失败路径：缺失 ref、>8 MiB、非法 JSON、缺 paths、1005 操作均有稳定错误码；17/17 错误单行 ≤ 300 字符；示例数据里的 `$ref` 字符串 0 fetch 原样保留。Swagger 2.0 冒烟 3/3。
- 报告：`spikes/s7/REPORT.md`，含依赖调研（`@apidevtools/swagger-parser` MIT、`json-schema-ref-parser` MIT、`yaml` ISC）与 T042 实现建议（解析/抓取分离、懒解引用、默认零联网、硬上限）。
- 限制：只支持 JSON；DNS 解析后的 IP 未二次校验；未覆盖 callbacks/webhooks、OpenAPI 3.1 联合类型、本地多文件 ref。

### T042 — OpenAPI 导入（2026-10-29，`task/m4-api-workbench`）

- 目标：Swagger 2.0/OpenAPI 3.x → 可保存的集合；tag 分组、示例 body、远程 `$ref` 限制、端点上限、循环 ref 不崩。
- 结构：`src/host/api/openapi/parser.ts`（形状校验、操作清点、结构 `$ref` 扫描，零 I/O）→ `resolver.ts`（`resolveRemotePolicy` → `bundleRemoteRefs` → 懒解引用，SSRF 唯一闸门）→ `mapper.ts`（示例生成、参数/认证/体映射、`importOpenApi` 管道）。依赖方向 parser ← resolver ← mapper，无环。
- 映射：path 参数 → `{{name}}`；可选 query/header/form 行 `enabled:false`；cookie 参数、GET/HEAD body、禁用 header 只记警告；server 变量代入默认值，缺失 server → `{{baseUrl}}` 前缀（相对 server 也走同一前缀）；auth 生成 `{{scheme}}` / `{{schemeUser}}` / `{{schemePassword}}` 占位符；每个请求先过真实 `isHttpRequestSpec`，不合格计入 `skipped` 而不返回半成品。
- 规模：500 端点（100 路径 × 5 方法）导入 < 5 s（实测约 1 s 内，含 500 次契约校验），500/500 有效、0 skipped、10 组；`ApiCollectionStore.save` 后 `read` 深度相等，占位符未被脱敏。
- 上限：文档 8 MiB、1000 操作、结构遍历 128 层 / 50 万节点、`$ref` 链 32；远程 10 文档 × 1 MiB、单文档 5 s 超时；示例体 4 KiB / 文档总预算 512 KiB（超出记 `example_budget_exceeded` 并降级 none）。
- 循环：别名环在映射时降级 `body none` 并保留 `ref_cycle:` 警告；`resolveRef` 直接调用抛 `ref_cycle`；自引用展开一层后停，互引用 A↔B 有界（`{"b":{}}`），体 < 4 KiB。
- 远程：默认公网 ref `remote_ref_blocked` 且 0 fetch；loopback 需 `allowLoopback`；同文档去重；302 `remote_ref_redirect`；`maxBytes` 超限 `remote_ref_too_large`；嵌套 ref 同一策略；元数据地址即使显式列 origin 也拒绝；相对 ref 拒绝。
- 契约配套：脱敏保留整值 `{{placeholder}}`（header/query/auth/JSON/URL），`new URL()` 的 `%7B%7Bname%7D%7D` 还原为 `{{name}}`；集合文件上限 256 KiB → 2 MiB；单 tag 超过 200 请求拆成 `tag`、`tag (2)` 文件夹。
- 验证：`pnpm typecheck` 0；`pnpm exec vitest run tests/integration/openapi` 5 文件 / 36 用例；`pnpm test` 79 / 702；`pnpm build` host 257.1 / client 279.0 KiB；`pnpm test:e2e` 9/9。

### T043 — 抓包回放（2026-10-29，`task/m4-api-workbench`）

- 目标：把 T024 的 `NetworkEntry` 变成请求草稿（method/url/headers/body），回放与原请求一致；DELETE/PUT/PATCH 等非幂等请求必须先确认，绝不自动重放。
- 结构：`src/host/api/replay.ts` 只做纯转换（`prepareReplay(input, { confirm })`），不持有网络能力、任何分支都不发请求；`src/host/api/service.ts` 注册 `api.replay.prepare`，只校验记录形状并透传 `confirm === true`；`src/client/api/ReplayButton.tsx` 负责确认交互；`RequestBuilder` 用模块级一次性 `takePendingReplay()` 取草稿渲染，绝不自动发送。
- 保真规则：URL 用采集原串（不 `new URL()` 归一化）；header 过滤分四类——HTTP/2 伪头静默丢弃、运行时自有（`host`/`content-length`/`connection`/`accept-encoding` 等）、`content-encoding`、不可信值（`REDACTED`、含 CR/LF、超 `HTTP_HEADER_VALUE_CHARS_MAX`、非法名），被略去的名字进 `omittedHeaders`，同名不同大小写只留第一个；body 仅在声明 content-type 匹配 `^application/(?:[A-Za-z0-9.+-]+\+)?json\b` 且 `JSON.parse` 成功时重建为 JSON 草稿，否则原文 + 原 content-type 走 text；GET/HEAD 一律丢体；> 16 KiB 拒绝；warning 固定顺序 `body_truncated` → `body_unavailable` → `body_dropped` → `url_redacted` → `headers_omitted`。
- 安全：`REPLAY_SAFE_METHODS = ['GET','HEAD','OPTIONS']`；其余方法未显式 `confirm: true` 时返回 `permission_denied`，`details.reason = 'confirmation_required'` 且带 `details.method`；确认后结果仍只含草稿（`requiresConfirmation: true`），发送只能由用户点“发送”。
- 采集侧：`NetworkEntry` 新增 `requestBody`/`requestBodyTruncated`/`requestBodyUnavailable`，采集上限 `MAX_CAPTURED_REQUEST_BODY_BYTES = 16 * 1024`；重定向 hop 保留首个带体的请求，后续 hop 清空。
- 验证：`pnpm typecheck` 0；`pnpm exec vitest run tests/integration/capture-replay` 4 文件 / 45 用例（捕获、回放、草稿往返、service 403 无 fetch）；`pnpm test` 83 / 747（基线 79/702）；`pnpm build` host 264.7 / client 295.7 KiB；`pnpm test:e2e` 9/9；日志 `.tmp/logs/t043-{full-test,build,e2e}.log`。
- 手动：`.tmp/t043-manual.mjs` → `.tmp/logs/t043-web.json` `ok:true`。真实 `vibe-dev` + 无头 Edge，站点记录四个回放：GET 200、POST 201（`{"name":"book","price":12}` + `application/json`）、PUT 200（`plain update` + `text/plain`）、DELETE 204，method/path/body/content-type 与原请求逐项一致；POST/PUT/DELETE 均弹确认（“不是只读请求，回放可能改变 … 上的数据”），弹窗期间站点请求数不变（0 次），取消后仍为 0，GET 无弹窗直接转草稿，草稿载入后不自动发送，0 其他 console 错误。
- 已知限制：`src/host/preview/session.ts` 在 `target.start()`（内部含 `newPage()` + `goto`）之后才启动 network 采集器，因此**首屏加载请求不入缓冲**；手测先开抽屉再点刷新触发抓包。该问题属 T024 遗留，T043 未改产品代码，建议 T044 或单独立项把采集器启动提前到导航前。

### T044 — 集合/历史 UI（2026-10-29，`task/m4-api-workbench`）

- 目标：集合树、保存/重开、历史搜索/重放/清空、空状态；验收是“抓包 → 回放 → 保存 → 重开 ≤ 3 次点击”。
- Host 缝：`ApiService` 新增 `api.collection.{list,get,add,remove}` 与 `api.history.{list,clear}`，全部复用 T037 的 store；`list` 只回摘要（`requestCount` 跨根与文件夹求和），集合体在展开时才读。保存走“**追加一条请求**”而不是写回整份文档——unary 请求体上限 64 KiB，500 端点的集合根本塞不进去，且整份回写会把别的 tab 的并发保存覆盖掉。上限 `API_COLLECTION_ITEMS_MAX` 在服务层判成 `invalid_input` + `details.reason='collection_full'`。
- 脱敏：历史与集合都存**未展开**的请求（`redactHttpRequest`），`Bearer {{token}}` 会被掩码，整值就是 `{{apiKey}}` 的保留；写入失败从不影响发送本身（`recordHistory` 吞异常）。
- 修复：`withCollections`/`withHistory` 原本把服务自己抛的 `collection_full` 交给 `toApiStoreStudioError`，后者只认 `ApiStoreError`，于是被压平成 `internal`（单测先红后绿）。现在 `isStudioError(error)` 直接透传。
- 客户端：`CollectionTree`（摘要行、展开读、两步删除、空/错误/跳过态）、`HistoryList`（最新在前、**搜索走 Host** 而非本地过滤、两步清空、重开不重发）、`ApiWorkbench` 组合请求表 + 集合树 + 历史，`collection-store.ts` / `history-store.ts` 为模块级 store（`useSyncExternalStore` + seq 守卫 + 可注入 API + reset），保存后自动展开默认集合 `saved`，重开经 `draft-store` 的 `openDraftInBuilder` 交接。
- 验证：`pnpm typecheck` 0；`pnpm exec vitest run tests/component/api-collections` 3 文件 / 21 用例；`pnpm exec vitest run tests/unit/api-send/api-service-stores.test.ts` 10 用例；`pnpm test` **87 文件 / 778 用例**（基线 83/747，日志 `.tmp/logs/2026-10-29-t044-test.log`）；`pnpm build` host 272.1 / client 331.7 KiB（`.tmp/logs/2026-10-29-t044-build.log`）；`pnpm test:e2e` 9/9、20.0 s（`.tmp/logs/2026-10-29-t044-e2e.log`）。
- 手动：`.tmp/t044-manual.mjs` → `.tmp/logs/t044-web.json` `ok:true`。真实 `vibe-dev` + 无头 Edge：站点抓包后点回放（第 1 次点击）得到 `GET /api/items` 草稿并带“尚未发送”提示 → 点保存（第 2 次）写盘 `.vibe/api/collections/saved.json`，集合自动展开显示 `GET /api/items` → 点该行（第 3 次）回填表单并提示“已载入保存的请求”，三次点击期间站点请求数不变（4 → 4）；整页 reload 后集合与条目仍在（读盘）；点发送得到 `HTTP 200 OK` 并写入 1 条历史（站点记录到 1 次真实请求）；搜索 `zzz` 0 行、`items` 1 行；从历史重开不重发（提示“已从历史载入请求…保存时已去掉密钥值”）；清空历史与删除集合都先出确认框，确认后列表清空且磁盘文件消失；0 其他 console 错误。清理：DSH/Edge/站点进程已结束（端口只剩 TIME_WAIT），`.vibe/api` 无残留文件。
- 已知限制：T024 的采集器晚启动问题未在 T044 修（手测仍先开抽屉再刷新）；保存默认落到固定集合 `saved`，暂不支持选集合或改集合名；历史无分页（Host 一次返回一页，`pageLimit` 默认 50，超出只提示条数）。

### T045 — 断言（2026-10-30，`task/m4-api-workbench`）

- 目标：状态码 / header / JSONPath / 耗时四类内置断言，pass/fail，错误可读；明确不执行任意 JS（SPEC FR-API-09/12）。
- 形状：**不新增 unary 方法**——`api.http.send` 多一个可选 `assertions`，Host 在响应落地后求值，回 `ApiSendOutcome.assertions`（`{index,passed,actual,failure?}`，与输入等长；没提交就不出现该字段）。放在同一次调用里省一个往返，也避免把响应体再传一遍给客户端判。
- JSONPath：自写 subset，只有 `$` + `.key` + `['k']`/`["k"]`（`\` 转义）+ `[n]`；`..`、`*`、filter 一律 `path_syntax`，不猜。路径在求值前一次性解析成段，求值过程不会抛。
- 比较文本化：字符串原样、`null`/number/boolean 字面量、对象/数组紧凑 JSON——与响应树里看到的一致；`equals` 严格相等、`contains` 子串。actual 截到 500 字符（`…` 收尾），避免把大响应塞进结果。
- 坏输入分两层：列表结构不对（非数组、>50 条、未知 kind、越界值）→ `invalid_input` + `details.field='assertions'`，**一个字都不发**；单条路径语法错 → 只让该条 `path_syntax`，其余照常判。
- 客户端：`AssertionsEditor` 草稿行把数值先存文本（`expected`/`maxMs` 都是 string，半打的数字不丢），`buildAssertions` 在发送前校验，任一行有问题就不发送并就地标红；顶部汇总“通过 x/y”；改任意行即清掉旧结论（否则改过的规则上会挂着上一次的绿）；载入回放/集合/历史草稿时保留检查、清除结论。
- 踩坑：`parseJsonPath` 首版在引号 key 后漏掉闭合引号本身、只认 `]`，于是 `$.data['a b']` 直接返回 null（单测先红后绿）。
- 验证：`pnpm typecheck` 0；`pnpm exec vitest run tests/unit/assertions tests/component/api-request/assertions-editor.test.tsx` 2 文件 / 17 用例；`pnpm test` **89 文件 / 795 用例**（基线 87/778，日志 `.tmp/logs/2026-10-30-t045-test.log`）；`pnpm build` host 278.8 / client 349.4 KiB（`.tmp/logs/2026-10-30-t045-build.log`）；`pnpm test:e2e` 9/9、51.5 s。
- 手动：`.tmp/t045-manual.mjs` → `.tmp/logs/t045-web.json` `ok:true`。真实 `vibe-dev` + 无头 Edge：对本地站点加四类检查（status 200 / header `content-type` contains `json` / `$.items[0].id` equals `item-1` / duration ≤ 5000 ms）→ 一次发送，站点只收到 1 次请求，四行全 pass、汇总“通过 4/4”（耗时 5 ms）；把 status 改成 201 再发 → 该行 fail 且文案“期望状态码 201，实际 200。”，其余三行仍 pass；期望值填 `abc` 再点发送 → 不发请求并提示“状态码须为三位数字（100–599）”；0 其他 console 错误。
- 已知限制：断言不随请求保存（`HttpRequestSpec` 没有该字段，集合/历史只存请求本身）；JSONPath 无通配/递归/filter；单条没有“跳过”开关。

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
6. **`Page.addScriptToEvaluateOnNewDocument` 必须先 `Page.enable`**：在页面级 CDP 会话上单独调用它，Chromium 会返回 `{"identifier":"..."}` 却不把脚本应用到后续文档（Edge 实测，U03）。要覆盖导航后的新文档，同一会话先 `Page.enable` 再注册；`runImmediately: true` 只补当前文档，不能替代。
7. **页面级状态要跟着 `Page.frameNavigated` 复位**：新顶层文档带的是全新的空闲脚本，Host 侧 `active`/`seq` 要同步清零；只用 `frame.parentId === undefined` 判定顶层，否则子帧刷新会把正在进行的拾取打断。

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

### 标注 UI / 客户端状态

1. **跨页签状态放模块级 store**：气泡在预览页、队列在标注页签，两者互斥挂载；状态放进任一组件都会随切换丢失。用模块级数组 + `useSyncExternalStore`（快照在变更前保持同一引用、无变更不发通知），壳层的 tab 徽标与队列列表读同一份数据。
2. **气泡定位不必读 canvas DOM**：舞台框由 `stageSize` + `fitContain` 计算后 flex 居中，元素 `box` 按 `frame/viewport` 缩放即可换算到屏幕坐标；把夹紧/翻转变成一个纯函数 `placeBubble`，几何用例不必挂载组件。
3. **发送失败必须保留草稿**：只有 `await send()` 成功后才从队列删除；失败显示 `role=alert` 并保留条目，避免用户意见因一次剪贴板/传输失败而丢失。
4. **空态不能提前 return**：队列清空的同一渲染里还要显示“发送成功”反馈；若在 `queue.length === 0` 时直接返回 `EmptyState`，反馈会被丢掉。改成始终渲染容器、只条件渲染列表与底部提示。
5. **`pnpm test -- <path>` 在本仓库不过滤**：`--` 之后的路径会被当成重复参数，vitest 仍跑全量。只跑目录用 `pnpm exec vitest run <path>`（HANDOFF §9 已记录，T031 再次踩到）。
6. **闭环入口要放在用户动作的落点**：预览页签与标注页签互斥，保存通知是唯一“刚发生且可见”的位置；把“发送到对话”放在通知里，动作从 4–5 个压到 3 个（点元素 → 保存 → 发送）。G3 初评的“≤3 步”失败正是因为入口藏在另一个页签。发送规则（成功才出队、失败保留草稿、无消息回退剪贴板文案）抽成 `sendQueuedAnnotation` 供队列与通知共用，避免两处行为漂移；通知用 `key={annotation.id}` 重置本地发送状态，防止上一条的结果串到下一条。

### OpenAPI 导入 / 契约

1. **`new URL()` 会编码占位符**：`https://api.example.com/pets/{{petId}}` 序列化后变成 `%7B%7BpetId%7D%7D`（路径与 `URLSearchParams` 都会），保存后环境解析器再也找不到变量。`redactUrl` 在返回前把 `%7B%7B<name>%7D%7D` 还原为 `{{name}}`，并对“整值都是占位符”的敏感字段跳过掩码；混合值（`Bearer {{token}}`）仍按原规则脱敏。
2. **集合条目上限会挡住大文档**：`API_COLLECTION_ITEMS_MAX = 200` 是每个文件夹的上限，500 端点集中在单 tag 时直接 `isApiCollection` 失败。导入器按 200 拆成 `tag`、`tag (2)` 文件夹；`API_COLLECTION_FILE_BYTES_MAX` 同步从 256 KiB 提到 2 MiB，否则 500 端点美化 JSON 装不下。
3. **示例数据里的 `$ref` 不是引用**：`example`/`default`/`enum`/`const`/`examples[*].value`/`x-*` 下的 `$ref` 是字面数据，扫描时切到 `example` 模式，既不解析也不抓取；`examples` 映射的条目对象保留 doc 模式（条目本身可 `$ref`），只把 `value` 当数据。这条来自 S7 spike 的 bug 修复，T042 已带进产品。
4. **映射期错误要降级为警告**：单个参数/auth/示例的 `$ref` 坏掉不应让 500 端点导入整体失败；`mapBody`/`collectParameters`/`mapAuth` 捕获 `OpenApiError` 记 `${code}: ${message}`，只有文档级问题（JSON、版本、操作数、远程策略）才抛出。测试同时覆盖两种路径。

### 抓包回放 / 采集

1. **回放只做纯转换，不碰网络**：`prepareReplay` 放在 `src/host/api/replay.ts`，入参是可序列化的记录，输出草稿；执行器不在它的依赖里，测试无需假 fetch 也能证明“不自动发送”。确认策略在同一函数里短路（未确认直接 `permission_denied`），避免 UI 与 host 各写一份。
2. **header 过滤要分级而不是一刀切**：伪头（`:` 开头）静默丢弃，运行时自有头与 `content-encoding` 记录进 `omittedHeaders`，值不可信（`REDACTED`、CR/LF、超长、非法名）也记录；同名不同大小写只留第一个。全部静默过滤会让用户以为请求被改过却查不到原因。
3. **回放的 URL 不要重新序列化**：`new URL()` 会规范化百分号编码与点段，可能改变服务端路由；直接用采集到的 `entry.url` 原串，只有判断 query 是否需要脱敏时用 `new URL()` 作解析。
4. **采集器启动晚于首屏导航**：`src/host/preview/session.ts` 在 `target.start()` 之后才 `start()` network 采集器，而 Web adapter 的 `start` 已 `newPage()` + `goto`，因此首屏请求不在缓冲里；reload 复用同一页面，后续请求可见。手测必须先开抽屉再刷新。修复方向是把采集器创建提前到导航前（T024 遗留，T043 未改）。
5. **请求表单一次只渲染一个分区**：`RequestForm` 只有当前 `section` 的控件在 DOM 里（header 行只在 headers 页签、body 控件只在 body 页签）。手测脚本读草稿前要先点 `[data-vibe-section="headers"]` / `[data-vibe-section="body"]`，否则拿到空数组；文本体的 content-type 在 `bodyContentType` 而不是 header 行。

### API 集合 / 历史（T044）

1. **服务的错误不要再过一遍通用映射**：`toApiStoreStudioError` 只认 `ApiStoreError`，把别的错误一律压成 `internal`。服务自己抛的 `StudioError`（如 `collection_full`）必须先 `isStudioError` 判过再透传，否则 UI 拿不到 `details.reason`，只能显示“保存失败”。
2. **unary 64 KiB 上限决定存储接口形状**：客户端不能“读整份集合 → 加一条 → 写回”，大集合直接超限；`api.collection.add` 在 Host 侧读-改-写一条请求，客户端永远只发一个 spec。同理列表只回摘要，展开才 `get`。
3. **组件测试要能完全绕开 Host**：`setApiCollectionApi`/`setApiHistoryApi` 注入假实现，测试不碰 `.vibe` 也不碰 transport；“回放 → 保存 → 重开”的验收直接从 `openDraftInBuilder` 交接开始数点击，用假 Host 的 `add` 调用次数证明没有额外保存。
4. **`pnpm test -- <path>` 不过滤**：`test` 是 `vitest run`，位置参数不会缩小范围；只跑某个目录要用 `pnpm exec vitest run <path>`。

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
- **T031 已完成**：预览页拾取后在元素旁弹气泡，保存进入侧栏队列（模块级 store，tab 带数量徽标），支持编辑/取消/发送/移除与空态；发送只在点击时发生，默认复制 `renderAnnotationText`，发送器可注入给 T032 接 composer。限制：队列不落盘（T033）、未做 `vibe-dev` 手测（G3）。
- **T032 已完成**：`src/client/inspect/handoff.ts` 通过 `conversation.input.left` 的作用域 slot 取公开 `inputActions`，按会话保存 composer 快照；标注文本用 `captureInsertion` + `insertText` 插入草稿（已有草稿前置 `\n\n`），只有 `insertText` 明确返回 `false` 才退回 `setDraft`，抛错或无 composer 时回退剪贴板；`insertText`/`setDraft` 都不触发提交。`StudioShell` 把发送器注入 `AnnotationQueue`，状态提示区分“已插入对话草稿”与“已复制到剪贴板”。`pnpm test` 57 文件 / 466 用例、`pnpm build` host 192.8 / client 184.7 KiB；Web（`.tmp/logs/t032-web.json`）与隔离 Desktop（`.tmp/logs/t032-desktop.json`）均 `ok:true`：草稿含完整标注、面板外 0、3 s 后未自动提交、新会话为空且切回原会话草稿仍在、停止后 Edge 全退、真实 profile 未改。限制：附件未接（S2 无公开附件 API）；隔离 Desktop 载体无法新建会话，跨会话隔离以 Web + 组件测试为准。
- **T033 已完成**：标注历史以 `.vibe/annotations` 为唯一事实源，`AnnotationHistoryService` 提供 `annotation.history.{list,get,save,remove}` 四个一元方法（列表返回摘要 + `total` + `skipped`，搜索大小写不敏感并覆盖中文）；侧栏标注页签在队列下方展示历史，可搜索、重新打开（仅入队，不发送）、两步确认删除；气泡保存与队列编辑都会写穿历史，写失败只降级提示。`pnpm test` 59 文件 / 507 用例、`pnpm build` host 199.8 / client 202.1 KiB；手动 `.tmp/logs/t033-history.json` `ok:true`：写入 2 条 → 搜到 1 条 → 重开入队未发送 → 停 Host 写入坏文件 → 重启仍 2 条且提示跳过 1 → 删除 1 条生效，面板 0 异常。限制：客户端 store 名为 `history-store.ts`（大小写冲突）；搜索全量过滤后再截断，未分页。
- **M4 进度**：T035 执行器、T036 环境/变量/密钥、T037 集合与历史持久化、T038 请求构建 UI、T039 响应查看 UI、T040 富响应体、T041 S7 OpenAPI spike、T042 OpenAPI 导入、T043 抓包回放、T044 集合/历史 UI、T045 断言均已完成（`task/m4-api-workbench`，未推送、未合并）。下一项 **T046 G4 评审**：抓包 → 回放 → 保存 → 重开、500 端点导入、密钥不泄漏、SPEC 相关条目。network 采集器晚启动（T024 遗留）仍未处理，建议随 G4 或单独立项修。
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
- Composer handoff：`src/client/inspect/handoff.ts`、`tests/component/annotation/composer-handoff.test.tsx`、`.tmp/logs/t032-{web,desktop}.json`。
- HTTP 执行器：`src/contracts/api.ts`、`src/host/api/{request,executor}.ts`、`tests/unit/http-executor/{request,executor}.test.ts`。
- 环境与密钥：`src/contracts/api.ts`（环境模型与安全视图）、`src/host/api/{secrets,environment}.ts`、`src/client/api/EnvironmentEditor.tsx`、`tests/unit/api-env/`、`tests/component/api/environment-editor.test.tsx`。
- 集合与历史：`src/contracts/api.ts`（集合/历史模型与 `redactHttpRequest`）、`src/host/api/{store-files,collection-store,history-store}.ts`、`tests/unit/api-store/`。
- 请求构建：`src/host/api/service.ts`、`src/client/api/{request-model.ts,RequestForm.tsx,RequestBuilder.tsx}`、`tests/unit/api-send/`、`tests/component/api-request/`。
- 响应查看：`src/client/api/{ResponseView,ResponseHeaders}.tsx`、`tests/component/api-response/`、`.tmp/logs/t039-web.json`、`.tmp/t039-manual.mjs`。
- OpenAPI 导入：`src/host/api/openapi/{parser,resolver,mapper}.ts`、`tests/integration/openapi/`、[S7 报告](../spikes/s7/REPORT.md)。
- 抓包回放：`src/host/api/replay.ts`、`src/client/api/ReplayButton.tsx`、`src/host/preview/network.ts`（采集体上限）、`tests/integration/capture-replay/`、`.tmp/logs/t043-web.json`、`.tmp/t043-manual.mjs`。
- 集合/历史 UI：`src/host/api/service.ts`（collection/history 方法）、`src/client/api/{ApiWorkbench,CollectionTree,HistoryList}.tsx`、`src/client/api/{collection-store,history-store,draft-store}.ts`、`tests/component/api-collections/`、`tests/unit/api-send/api-service-stores.test.ts`、`.tmp/logs/t044-web.json`、`.tmp/t044-manual.mjs`。
- 断言：`src/host/api/assertions.ts`（`parseJsonPath`/`evaluateAssertions`）、`src/client/api/AssertionsEditor.tsx`、`tests/unit/assertions/`、`tests/component/api-request/assertions-editor.test.tsx`、`.tmp/logs/t045-web.json`、`.tmp/t045-manual.mjs`。
- Web 预览：`src/host/targets/web/{adapter,launch}.ts`、`tests/integration/web-adapter/`、`tests/helpers/png.ts`。
- 预览生命周期：`src/host/preview/session.ts`、`src/client/preview/{Toolbar.tsx,lifecycle.ts,local-url.ts}`、`tests/integration/preview/session-lifecycle.test.ts`、`.tmp/logs/t025-{host,desktop}.json`。
- 技术决策：[plan.md](../tasks/plan.md)、[SPEC](./SPEC-vibecoding-studio.md)。
- 发布检查：[PUBLISHING.md](./PUBLISHING.md)。
- 私有仓库：`https://github.com/niobium617/dsh-vibecode-studio`（当前为 private）。
