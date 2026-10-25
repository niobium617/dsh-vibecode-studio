# VibeCoding Studio — Phase 2 实现计划

> 状态：**已批准（2026-10-25；Plan gate 通过，Phase 3 任务清单已批准）**
> 日期：2026-10-25
> 输入：[已批准 SPEC](../docs/SPEC-vibecoding-studio.md) + [已批准能力地图](../docs/CAPABILITY-MAP.md)
> 产品决策：SPEC 第 11 节 Q1–Q10 的推荐项已随“批准”锁定，本计划不再重开产品范围。
> 本文件不包含产品代码；Phase 3 才拆成可执行任务。

---

## 1. 计划目标

把已批准的需求落成一条**可验证、可回退**的实现路径，先证明四个关键假设，再按模块顺序交付 MVP。

MVP 的完成定义（与 SPEC 第 2.3 节一致）：

- Web 目标可启动/预览/交互，稳定 ≥ 10 fps。
- 元素拾取能产出选择器 + DOM + 源码（React/Vue/Svelte 开发态）+ 标注卡。
- 标注能进入 composer，由用户确认后发送；文本自包含，截图可选。
- 基础 API 工作台可用：请求/环境/集合/历史/cURL/OpenAPI/抓包回放。
- 4 个 agent 工具 + `/vibe` 命令 + bundled skill + 可选 preset 可用。
- Windows 11 + Edge，DSH Web 与 Desktop 都能跑；进程能清理；密钥不泄漏。

**不在本计划内**：小程序、原生桌面、Android/iOS、区域框选、多选、截图附件（除非 S2 直接通过）、断言/视觉回归、团队协作、Mock、GraphQL/WebSocket。它们分别属于 Phase B/C。

---

## 2. 计划级技术决策

这些是 SPEC 没写死、但实现必须选一个的决策。请重点评审。

| # | 决策 | 选择 | 理由 | 验证方式 |
|---|---|---|---|---|
| D1 | 包形态 | 单 npm 包 + 多子路径入口 | 安装/升级/兼容性最简单；内部按模块隔离 | G1 干净 profile 安装 |
| D2 | 构建 | Host 用 TS→ESM；Client 用 `tsdown`/rolldown 产出 loader 包装的 `lib/client.js`；失败则回退 esbuild + 手写 CJS 包装，再失败则参考已安装包的 bundle 结构做最小手写 `client.js` | DSH client 只认 `window.__ModuleLoader__.load({ id, factory })`；必须自己保证格式 | M1 hello-world 能被 DSH 加载 |
| D3 | 预览帧传输 | **MVP 基线用拉取式 JPEG**（`GET` 最新帧 + `X-Vibe-Seq`），S1 通过后再加流式 | 拉取式在 Web/Desktop 的 fetch 桥上最稳；实现简单；10 fps 足够 | S1 对比拉取 vs 流式 |
| D4 | 输入通道 | 点击/滚轮/键盘/文本走 RPC 一元调用；指针悬停由页面内拾取脚本处理，不走 Host 往返 | 避免 60 Hz RPC；降低延迟 | S3 输入延迟测试 |
| D5 | 标注发送 | 只调用 composer 的公开 `InputActions` / `ctx.conversation`；拿不到就复制到剪贴板并提示 | 不自动发送、不逆向私有 store | S2 |
| D6 | 截图附件 | 仅当 S2 找到公开附件路径时启用；否则 MVP 只做“复制截图 + 手动粘贴” | 不把产品堵在私有 API 上 | S2 |
| D7 | 配置校验 | 插件配置用 `@deepseek-ai/schemastery`；持久化 JSON 用手写校验 + 单测 | 与 DSH 生态一致；不引入第二套 schema 运行时 | M1/M4 单测 |
| D8 | API Cookie | MVP 只支持手动 `Cookie` header；P1 再加 jar | 少一个依赖，先覆盖联调主路径 | M4 验收 |
| D9 | OpenAPI 远程 ref | 默认只允许本地文件与 localhost；其他来源必须确认 | 防 SSRF | S7 |
| D10 | 测试宿主 | Vitest + React Testing Library + Playwright；E2E 用临时 `vibe-test` profile + Vite fixture | 与 DSH 技术栈一致；不污染用户 profile | G6 |
| D11 | 数据位置 | 配置/集合在 `.vibe/`；密钥 `ctx.credentials`；截图/抓包在 `.vibe/artifacts/`（默认 gitignore） | 可提交/可清理/不泄密 | M1/M4 |
| D12 | preset | 只维护“最小可用”的 `Vibe Studio` preset，不复制完整 standard | 降低 DSH 升级维护量；标准模式仍可用 | G5 + 升级冒烟 |

### 2.1 计划新增的取舍（需要你确认）

1. **MVP 帧传输先拉取，不先做流式**：如果 S1 证明流式在 Desktop 也稳，再把拉取作为回退，不改变接口。
2. **MVP 不做 Cookie jar**：需要登录态的接口，先手动贴 `Cookie` header；P1 再补。
3. **`/vibe` 命令先返回状态和操作提示，不保证能直接打开右栏 tab**：右栏由 UI 按钮/快捷键打开；如果 DSH 有公开的 client 事件 seam，P1 再让命令直接开 tab。
4. **截图附件是可选增强**：S2 不通过就不进 MVP，不影响“标注 → 修改”的主闭环。
5. **小程序不进 MVP**：Web 闭环跑通后再开 B 阶段。

---

## 3. 工作分解（按模块）

> 这里是“工作包”级别，不是原子任务。Phase 3 会把每个工作包拆成 ≤ 1 个专注 session 的任务。

### 3.1 `studio-contracts`（基础，阻塞所有模块）

**交付：**

- `TargetKind`、`TargetConfig`、`TargetCapabilities`、`TargetSession` 接口。
- `Annotation`、`ElementContext`、`SourceContext`、`ConsoleEntry`、`NetworkEntry` schema + 文本渲染器。
- `StudioError` 错误码；`ArtifactRef`；`SessionId`/`TargetId` 品牌类型。
- 上下文预算常量与截断工具（annotation ≤ 4 KB，observe ≤ 8 KB）。
- 不可信内容包裹器（`<untrusted-page-content>`）。

**验证：**

- 纯函数单测：序列化/反序列化、预算截断、脱敏、不可信包裹。
- 类型检查：其他模块只从 contracts 取跨模块类型。

### 3.2 `studio-shell`（客户端组合根）

**交付：**

- 右栏 tab 注册：`id: dsh-vibecode-studio`，`kind: vibe-studio`，`keepMounted: true`，guide 入口。
- 内部页签：预览 / API / 验证 / 设置；空/错/加载状态。
- 目标切换器、状态徽标、快捷键、i18n（zh-CN 默认 + en）。
- 设置：origin 允许列表、保留期、上下文预算、截图开关、日志级别。
- 持久化：`.vibe/studio.json` 读写；原子写；坏数据回退默认值。
- 组合各模块公开面板；不 import 模块内部。

**验证：**

- M1 hello-world：tab 在 Web/Desktop 出现，切 tab/会话不丢状态。
- 设置改动能即时生效或明确提示重启。
- 组件测试覆盖空/错/加载状态。

### 3.3 `target-adapters`（Host）

**交付：**

- `TargetAdapter` 注册表；能力声明；目标配置校验。
- `WebTargetAdapter`：URL 或 `command + cwd + port`；启动/停止/健康检查/日志。
- 进程监督：spawn、端口探测、日志 ring buffer、Windows 进程树清理（`taskkill /T /F`）。
- API/CLI 目标的最小实现（无 UI，供 API 工作台/日志使用）。
- 为 Phase B 预留 Electron/Tauri/小程序 adapter 的注册位，不实现。

**验证：**

- 启动 Vite fixture < 10 s；停止后端口释放、无孤儿进程。
- 端口占用/命令失败/健康检查超时有明确错误。
- 单测用假 adapter 覆盖生命周期。

### 3.4 `preview`（Host + Client）

**交付：**

- Playwright 启动 Edge（`channel: 'msedge'`）；CDP session；`Page.startScreencast`。
- 帧缓冲：只保留最新帧 + seq；拉取式 `GET` 路由；S1 通过后加流式。
- 输入：鼠标点击/滚轮、键盘、文本；坐标映射；隐藏 textarea + composition 处理中文。
- 截图：`page.screenshot({ clip })`；artifact 存储。
- Console：CDP `Runtime.consoleAPICalled` / `exceptionThrown`；ring buffer。
- Network：CDP `Network.*`；请求/响应摘要；body 按需取；上限与脱敏。
- 导航/刷新/视口/外部打开；目标 origin 限制。
- 预览面板：canvas 渲染、工具栏、状态、底部抽屉（标注/Console/Network）。

**验证：**

- 1280×800 ≥ 10 fps；输入反馈 < 200 ms。
- 点击/滚动/键盘/中文输入在 fixture 表单可用。
- Console/Network 与浏览器 DevTools 基本一致；大响应不卡 UI。
- 关闭 tab / 停止目标后浏览器与进程被清理。

### 3.5 `visual-inspect`（Host + Client）

**交付：**

- 拾取脚本：Shadow DOM overlay、hover 高亮、点击选择、`Esc` 取消、`Alt+Click`。
- 选择器生成：testid > id > aria/name > 稳定 class 路径 > nth-of-type。
- DOM 片段：去 script/style、深度/长度截断、文本截断。
- 源码适配：React fiber、Vue `__file`、Svelte `__svelte_meta`；失败回退。
- 标注模型/存储/历史；标注气泡 + 侧栏队列。
- 区域框选（P1）不实现；接口预留。
- Console/Network 错误 → 标注（P1）。

**验证：**

- React/Vue/Svelte fixture 各 10 个元素，源码命中 ≥ 80%。
- 拾取不触发页面点击/跳转；`Esc` 可退出。
- 标注文本 ≤ 4 KB；页面文本被不可信包裹。
- 历史持久化、重新打开、删除。

### 3.6 `api-workbench`（Host + Client）

**交付：**

- HTTP 执行：method/url/query/headers/body/auth；超时/取消/重定向；响应上限。
- 响应查看：状态/耗时/大小/headers/body；JSON 树/原始/HTML 沙箱/图片/文本；虚拟化。
- 环境/变量：`{{baseUrl}}`、`{{token}}`；未解析提示；密钥 `ctx.credentials`（UI 只读 describe）。
- 集合/文件夹/历史：JSON 持久化、原子写、搜索、重放、清空。
- cURL 导入/导出（常见 flag 子集）。
- OpenAPI 3.x/Swagger 2.0 导入：tag 分组、示例 body、远程 ref 限制、端点上限。
- 抓包回放：NetworkEntry → 请求草稿；不自动发送非幂等请求。
- 断言（P1）：状态码/header/JSONPath/耗时；不执行任意 JS。

**验证：**

- 请求构建/发送/取消/超时/大响应可用。
- 500 端点 OpenAPI < 5 s 导入；远程 ref 被拦截。
- 导出的集合/日志/模型上下文无明文密钥。
- 抓包回放与原始请求 method/url/headers/body 一致。

### 3.7 `verify-loop`（Host + Client）

**交付（MVP 基础）：**

- 检查项：目标在线、页面可加载、无 console error、无失败请求。
- 结果 schema：pass/fail/skip + 证据（console/network/artifact id）。
- 验证面板：运行、结果列表、证据跳转。
- 不自动 commit/回滚。

**P1：** 选择器/文本/接口断言、截图对比、`workspace-changes` diff 关联。

**验证：**

- fixture 页面故意制造 console error / 500，检查项能捕获。
- 结果 ≤ 4 KB；证据按需取。

### 3.8 `agent-integration`（Host）

**交付：**

- 工具：
  - `vibe_status`：目标/预览/错误/标注计数。
  - `vibe_observe`：有界 DOM/console/network 摘要。
  - `vibe_annotation_get`：按 id 取完整标注。
  - `vibe_preview`：reload/navigate/screenshot/start/stop；start/stop 走 ask/审批。
- `/vibe` 命令：返回状态 + 下一步建议（不保证开 tab）。
- bundled skill：`skills/vibecoding-studio/SKILL.md` + `references/`。
- 可选 preset：`Vibe Studio`（最小工具集，完整列表手写）。
- hooks：文件编辑后标记“预览可能过期”；`tools/pre-execute` 拦截越权预览动作。
- 上下文预算：默认摘要 + artifact id；不返回图片；不可信边界。

**验证：**

- preset 会话中 4 个工具可见并可调用；standard 会话不受影响。
- `vibe_preview` 越权/非 localhost 被拒。
- 工具结果 ≤ 8 KB；无截图/base64。
- skill 能被 `skill` 工具加载。

---

## 4. 里程碑与 Gate

### M0：Spike Gate（先做，阻塞后续）

执行 S1–S4；产出 4 份结论（通过/失败/回退）。**Gate G0 不通过就不进入 M1 的产品实现**，只调整方案。

### M1：Foundation

- 包脚手架、构建、host/client hello-world、contracts、shell 骨架、connection 路由、测试 harness、`vibe-dev` profile。
- **G1**：干净 `vibe-dev` profile 能加载 tab；host/client 通信通；typecheck/test/build 绿。

### M2：Preview

- target-adapters + Web preview + frames + input + console/network + preview UI。
- **G2**：fixture 页面 10 fps；点击/输入/滚动可用；Console/Network 可见；停止后进程清理。

### M3：Inspect + Annotation

- picker + selector/DOM/source + annotation + bubble/queue + composer handoff。
- **G3**：50 元素抽测源码命中 ≥ 80%；标注 ≤ 4 KB；从拾取到 composer ≤ 3 步；不自动发送。

### M4：API Workbench

- HTTP + env + collections + history + cURL + OpenAPI + capture replay + UI。
- **G4**：完整跑一次“抓包 → 回放 → 保存 → 重新打开”；500 端点 spec 导入；密钥不泄漏。

### M5：Agent Integration

- tools + command + skill + preset + hooks + budget。
- **G5**：preset 中工具可用；standard 不受影响；越权被拒；skill 可加载。

### M6：Verify + Hardening

- 基础验证、E2E、30 分钟 soak、100 次标注、安全清单、打包、文档。
- **G6**：SPEC 第 2.3 节 1–8 条全部达标；`pnpm build/test/typecheck` 绿；干净 profile 安装成功。

---

## 5. Spike 计划（S1–S4）

> 所有 spike 放 `spikes/<id>/`，只写最小验证代码；结论写 `spikes/<id>/REPORT.md`。Spike 代码不进入发布包。

### S1：传输（Host ↔ Client）

**问题**：在 DSH Web 与 Desktop 下，客户端能否稳定拿到 10 fps 的 JPEG 帧？拉取式与流式哪个更稳？

**最小验证：**

1. 建一个临时插件（host + client），host 注册：
   - `ctx.connection.fetch.register({ path: '/vibe/frame', methods: ['GET'], requestBody: 'buffered', fetch })`，返回最新 JPEG + `X-Vibe-Seq`。
   - 可选：`/vibe/frames` 返回 `multipart/x-mixed-replace` 流。
2. client 在右栏 tab 里用 `fetch('/api/vibe/frame')` 轮询，画到 canvas；记录 fps、丢帧、首帧时间。
3. 在 Web profile 与 Desktop profile 各跑 60 s；中途刷新/断网/重连。
4. 对比拉取 vs 流式的 CPU/内存/延迟。

**通过标准：**

- 两种 profile 都能 ≥ 10 fps（1280×800，JPEG q70）。
- 30 s 无不可恢复断流；切 tab 后恢复。
- 内存增长 < 50 MB/10 min。

**回退：**

- 流式失败 → 只做拉取，5–10 fps。
- Desktop fetch 桥接失败 → 预览在外部浏览器打开，Studio 只做拾取/标注（降级模式）。

**产出：** `spikes/s1-transport/REPORT.md`，含 fps/latency/内存表与最终选择。

### S2：Composer Handoff

**问题**：右栏 tab 能否把文本（以及可选截图）放进当前会话 composer，且不自动发送？

**最小验证：**

1. 在右栏 tab 里尝试三条路径：
   - `ctx.uiSession` / session-scoped `inputActions.setDraft(text)`。
   - 在 composer 的公开 slot 注册一个“桥”组件，捕获 `InputActions` 并暴露给 Studio。
   - `ctx.conversation.send(text)`（仅作为最后手段，且默认不调用）。
2. 文本验证：插入后光标/草稿正确，用户可编辑，未自动提交。
3. 截图验证：把 canvas `toBlob()` 转 `File`，尝试 `createDrafts` + `addAttachments`；若不可达，验证剪贴板 `ClipboardItem` 回退。
4. 在 Web/Desktop 各跑一次；切会话后不串。

**通过标准：**

- 文本路径 100% 成功，且不自动发送。
- 截图附件路径：成功则记录；失败则剪贴板回退可用。
- 不依赖私有 store/内部 import。

**回退：** 只做文本 + “复制标注/截图”按钮。

**产出：** `spikes/s2-handoff/REPORT.md`，含可用 API 路径与限制。

### S3：Screencast + 输入 + 中文

**问题**：Playwright + Edge 的 screencast 能否支撑日常操作？中文输入是否可用？

**最小验证：**

1. Node 脚本：`playwright-core` 启动 Edge（headless 与 headful 各一次），打开 fixture 页面。
2. `Page.startScreencast` → 统计 fps；`Input.dispatchMouseEvent` 点击/滚动；`Input.dispatchKeyEvent` 输入。
3. 中文：Studio 侧隐藏 textarea + `compositionstart/update/end` → `Input.insertText`；在 fixture 表单输入“你好，世界”。
4. 测量点击到画面变化、输入到画面变化的延迟。

**通过标准：**

- headless/headful 均 ≥ 10 fps；输入延迟 < 200 ms。
- 点击/滚动/键盘可用；中文文本正确进入输入框。
- 页面无焦点错乱；`Esc`/Tab 不卡死。

**回退：**

- 中文失败 → MVP 只支持英文/粘贴，中文用“外部浏览器打开”完成；在 UI 明示。
- headless 渲染异常 → 默认 headful，或外部打开。

**产出：** `spikes/s3-screencast/REPORT.md`，含 fps/延迟/IME 结论。

### S4：拾取 + 源码

**问题**：注入 overlay 能否稳定拾取元素，并在 React/Vue/Svelte 开发态拿到源码？

**最小验证：**

1. 建三个最小 fixture：Vite + React、Vue、Svelte，各有一个表单/列表/按钮。
2. 注入拾取脚本（Shadow DOM overlay + capture 阶段拦截）；点击 10 个元素/框架。
3. 提取：选择器、tag、文本、role、box、DOM 片段；React fiber / Vue `__file` / Svelte `__svelte_meta`。
4. 人工核对源码文件/行号；记录失败原因。

**通过标准：**

- 选择器在页面内可唯一命中（或明确标注“非唯一”）。
- React/Vue/Svelte 源码命中 ≥ 80%（30 个元素合计）。
- 拾取不触发页面原点击；`Esc` 退出；无 console 报错。

**回退：**

- 某框架失败 → 标记“源码不可用”，只给选择器/DOM；不影响标注。
- overlay 被 CSP/iframe 限制 → 提示“此页面不支持拾取”，建议区域截图/文字。

**产出：** `spikes/s4-picker/REPORT.md` + 三框架命中率表。

### 支持性 Spike（可在 M2/M4 并行）

- **S7 OpenAPI**：500 端点 spec、远程 ref、循环 ref、超大 schema；通过标准 < 5 s、SSRF 拦截、错误可读。
- **S8 进程生命周期**：Vite 启动、端口探测、Windows 进程树清理、端口占用；通过标准 < 10 s 启动、停止无孤儿。

> S5（Electron/Tauri）、S6（小程序）留到 Phase B 前再做；不在 MVP 关键路径。

---

## 6. 并行与关键路径

**关键路径：**

```
S1–S4 → M1 → M2 → M3 → M5 → M6
```

**可并行：**

- M1 完成后，M2（preview）与 M4（api-workbench）可并行。
- M3 的 picker/source 可先在 S4 harness 上开发，等 M2 帧/输入稳定后集成。
- M5 的工具 schema/skill 可在 M1 后先写，工具实现等 M3/M4 接口稳定。
- S7/S8 在 M2/M4 期间并行。
- 文档/示例可随模块推进，不必等 M6。

**必须串行：**

- contracts 先于所有模块。
- preview 的帧/输入稳定先于 M3 的端到端标注。
- 标注 handoff 先于 M5 的工具/验证闭环。
- M6 的 soak/安全/打包在所有功能之后。

---

## 7. 验证与质量门

### 7.1 每个 Gate 的命令

```bash
pnpm typecheck
pnpm test
pnpm build
dsh --profile vibe-dev --dump-config
# E2E（M2 起）
pnpm test:e2e
```

### 7.2 测试金字塔

| 层级 | 内容 | 何时 |
|---|---|---|
| 单元 | contracts 序列化/预算/脱敏；选择器；OpenAPI 映射；变量解析 | 每个模块 |
| 集成 | 假 adapter 生命周期；connection 路由；API 执行；composer handoff | M1–M4 |
| 组件 | 标注卡、API 表单、验证结果、空/错状态 | M2–M4 |
| E2E | DSH + Vite fixture：打开 Studio → 拾取 → 标注 → 发送 → 预览 | M3 起 |
| 手工 | Windows/Edge/Web/Desktop、IME、全屏、切 tab、进程清理 | 每个 Gate |
| 安全 | 脱敏、origin 白名单、SSRF、prompt injection fixture | M4/M6 |

### 7.3 性能/稳定性门

- 预览 ≥ 10 fps；输入 < 200 ms；Studio 打开 < 2 s（已有 dev server）。
- 30 分钟 soak + 100 次标注：无崩溃、无进程泄漏、内存增长可解释。
- API 大响应（10 MB）不冻结 UI；OpenAPI 500 端点 < 5 s。
- 关闭 tab/停止目标后 5 s 内进程退出。

### 7.4 安全门（M6 必须全过）

- 集合/日志/模型上下文无明文密钥。
- 非 localhost / `file:` / 元数据地址被拒。
- 页面文本不能改变 agent 指令（fixture 注入测试）。
- CDP 不监听公网；进程树清理。
- 截图/产物保留期与一键清理可用。

---

## 8. 风险与缓解（计划级）

| 风险 | 触发点 | 缓解 | 回退 |
|---|---|---|---|
| Client bundle 包装不被 DSH 接受 | M1 hello-world | 复制已安装包的 loader 约定；先做最小 bundle | esbuild + 手写包装；再不行就参考已安装包产物手写最小 `client.js` |
| Desktop 帧传输失败 | S1 | 拉取式基线；短轮询 | 外部浏览器 + 只读拾取 |
| 中文输入失败 | S3 | 隐藏 textarea + composition | 明示限制；外部浏览器输入 |
| 源码映射命中低 | S4 | 三框架适配 + 选择器回退 | 只给选择器/DOM |
| preset 与 DSH 升级漂移 | G5/升级 | 最小 preset + 升级冒烟 | 不默认启用 preset，改为文档指导 |
| 范围膨胀 | 任意阶段 | MVP 切分写死；新需求进 B/C | 砍功能，不砍闭环 |
| DSH API 变动 | 升级 rc | 薄适配层 + 兼容测试 | 锁版本，暂不升级 |
| 性能/内存 | M2/M6 | 帧合并、上限、空闲回收 | 降 fps/分辨率 |

---

## 9. 交付物清单

- `docs/CAPABILITY-MAP.md`（已建）
- `docs/SPEC-vibecoding-studio.md`（已批准）
- `tasks/plan.md`（本文件）
- `tasks/todo.md`（Phase 3 生成）
- `spikes/s1..s4/REPORT.md` + 最小 harness
- `src/` 包（host/client/contracts/shared）
- `skills/vibecoding-studio/`
- `presets/vibe-studio/`
- `tests/`（unit/integration/e2e）
- `fixtures/`（Vite React/Vue/Svelte demo）
- `docs/USER-GUIDE.md`、`docs/SECURITY.md`、`docs/RELEASE.md`
- `profiles/vibe-dev` 安装说明（不直接改用户 desktop profile）

---

## 10. 计划评审点

请重点看：

1. **第 2 节 D1–D12**：有没有你不同意的技术选择，尤其是 D2（client 构建）、D3（拉取式帧）、D5/D6（composer/截图回退）、D12（最小 preset）。
2. **第 3 节工作包**：有没有漏掉的模块职责，或某个工作包明显过大。
3. **第 4 节 Gate**：验收标准是否够具体、能否作为“继续/回退”的判断。
4. **第 5 节 Spike**：S1–S4 的通过标准是否合理；是否要加/减。
5. **第 6 节并行**：关键路径是否认同。

批准后进入 **Phase 3：任务拆分**，产出 `tasks/todo.md`（每个任务 ≤ 1 个专注 session，带验收与验证命令），然后才开始写代码。

> 本轮仍然不写产品代码、不建脚手架、不改 DSH profile。
