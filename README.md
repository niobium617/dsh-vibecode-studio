# DSH Vibecode Studio

> A visual feedback loop for **DeepSeek Harness**: preview your local web app inside DSH, point at what is wrong, and hand structured notes to the coding agent — no screenshot ping-pong.

**Status: pre-alpha.** The M0 spike gate is complete. Transport, composer handoff, screencast/input/Chinese IME, and element/source mapping are verified; the G0 review selected stream-first frames with a pull fallback, one-shot CDP input, clipboard-only screenshots, and per-framework source adapters. Nothing is installable as a product yet — product code starts with M1, and the only working code is under `spikes/`. See the [G0 review](spikes/G0.md) for the go/no-go and fallback decisions.

[中文简介](#中文简介) · [Design](docs/SPEC-vibecoding-studio.md) · [Task plan](tasks/todo.md) · [Dev log](docs/DEVLOG.md)

## 中文简介

DSH Vibecode Studio 是面向 **DeepSeek Harness（DSH）** 的可视化 Vibe Coding 插件：在 DSH 侧栏里直接预览本地 Web 应用，点选页面元素写下修改意见，再把这些带上下文的批注交给编码 Agent，省掉“截图 → 粘贴 → 用文字描述”的来回。

### 它解决什么问题

Vibe coding 的关键是让 Agent “看见”结果。截图会丢失元素身份、交互上下文和截图外信息；本插件把预览本身变成反馈界面：

1. 本地 Web 应用在 DSH 右栏中预览，帧以流式 JPEG 传输，断流时回退到拉取式 JPEG。
2. 点击页面元素即可添加批注，无需离开预览。
3. 多条批注先进入批注队列，审核后再交接，不自动发送。
4. Agent 收到的是结构化上下文——路由、选择器、元素信息、源码位置和修改意见，而不是一张不透明的图片。

### 当前进度

- **M0 / G0 已通过**：S1 传输、S2 composer 交接、S3 screencast/输入/中文、S4 拾取/源码四个 spike 均完成，结论与回退方案见 [spikes/G0.md](spikes/G0.md)。
- **下一阶段 M1**：搭建产品包脚手架、host/client 骨架、contracts、connection 路由与测试 harness。
- **尚未发布**：目前只有 `spikes/` 下的实验代码，暂不能作为插件安装；产品包将从 `packages/` 开始。

### 计划中的 MVP

- 仅限 localhost 的内嵌预览，默认 30 fps 流式 JPEG，拉取式回退。
- 页面元素拾取与标注 overlay，支持 React / Vue / Svelte 开发态源码定位。
- 批注队列、气泡与历史；交接前可审核。
- 通过公开 `InputActions` 把结构化文本写入 composer 草稿，**不自动发送**；截图走“复制 PNG + 手动粘贴”。
- 会话级多页面 tab；密钥只存放在 `ctx.credentials`，UI 只读取 `describe` 元数据。
- 后续模块：API 工作台、Agent 工具与 `/vibe` 命令、验证与打包。

### 安全边界

- 预览目标默认只允许 localhost；拒绝 `file:`、`chrome:`、`devtools:`、云元数据与私网地址。
- 不自动发送批注、不自动批准、不自动提交；截图不作为唯一证据。
- host/client 通信只走 `ctx.connection`，不直接使用 `ctx.webServer`。
- CDP 只连接已启动或已批准的 loopback 端点，不暴露到网络，并清理进程树。

### 快速开始（开发 spike）

需要 Node.js 24、pnpm 11，以及 DSH `0.2.1-rc.2` 或更新版本。

```bash
pnpm install
pnpm typecheck
pnpm spike:s1                 # 本地 10 s 拉取 vs 流式基准
pnpm spike:s3 --seconds 10    # screencast / 输入 / 中文
pnpm spike:s4                 # React / Vue / Svelte 拾取与源码命中
```

完整设计见 [SPEC](docs/SPEC-vibecoding-studio.md)，任务顺序见 [todo.md](tasks/todo.md)，开发记录见 [DEVLOG](docs/DEVLOG.md)。

## Why

Vibe coding works best when the agent can *see* the result. Today that usually means taking a screenshot, pasting it into chat, and describing the problem in prose. That loses element identity, interaction context, and anything the screenshot does not show.

DSH Vibecode Studio turns the preview itself into the feedback surface:

1. The app runs on localhost and is previewed in a DSH sidebar tab.
2. Click any element to attach a note without leaving the page.
3. Collect several notes into a batch, review them, and send them to the composer.
4. The agent receives structured context — route, selector, bounding box, note — instead of an opaque image.

The agent stays in control. Notes are prepared for the composer; nothing is sent, approved, or committed automatically.

## Planned MVP

- Localhost-only embedded preview with a streaming JPEG transport and a pull-JPEG fallback (S1 verified both; see the [transport report](spikes/s1/REPORT.md)).
- Element picker and annotation overlay rendered above the live preview.
- Batch annotation tray with review before handoff.
- Composer handoff that inserts a structured, editable message; screenshots use a copy-and-paste fallback until DSH exposes a public attachment API.
- Session-scoped page tabs for multi-page flows.
- Credentials never reach the page; UI only reads `describe` metadata.

## Repository layout

```text
docs/        product spec, capability map, DSH ecosystem notes
tasks/       implementation plan, ordered task list, handoff state
spikes/
  s1/        T001 transport spike: pull JPEG vs multipart stream
  s2/        T002 composer handoff spike: public InputActions + clipboard fallback
  s3/        T003 screencast, input latency, and Chinese IME spike
  s4/        T004 element picking and React/Vue/Svelte source mapping spike
  G0.md      T005 spike review: go/no-go and final fallback decisions
```

G0 has passed; the product package will arrive in `packages/` as M1 begins. Until then, `spikes/` is the only executable code.

## Development

Requirements: Node.js 24, pnpm 11, and DeepSeek Harness `0.2.1-rc.2` or newer for manual plugin runs.

```bash
pnpm install
pnpm typecheck
pnpm spike:s1:build          # bundle S1 host/client (required before linking)
pnpm spike:s1                # local 10 s pull-vs-stream benchmark
node spikes/s1/soak.mjs ...  # 10 min Web/Desktop soak; see spikes/s1/REPORT.md
pnpm spike:s2:build          # bundle S2 host/client (required before linking)
pnpm spike:s3 --seconds 10   # screencast, input latency, Chinese IME
pnpm spike:s4                # picker and React/Vue/Svelte source hits
```

`spikes/s1/package/lib/` and `spikes/s2/package/lib/` are generated and gitignored. Build before linking with `dsh plugin --profile vibe-dev add link:<absolute-path>`; otherwise DSH links a package with no host/client entry points. Do not rebuild a linked package while a benchmark, soak, or manual acceptance run is active; DSH hot-reloads the client and invalidates the result. S2 manual steps and its clipboard limitations are in [spikes/s2/run.md](spikes/s2/run.md).

The spikes install into a throwaway DSH profile (`vibe-dev`); they must never be installed into `desktop` or `web` directly.

### Engineering guardrails

- All host/client traffic goes through `ctx.connection`; no direct `ctx.webServer` use.
- Page and API content are treated as untrusted; secrets live only in `ctx.credentials`.
- Preview targets are localhost by default. `file:`, `chrome:`, `devtools:`, cloud metadata, and private-network targets are rejected.
- CDP attaches only to an already-started, approved endpoint and is never exposed to the network.
- No automatic sending, approving, committing, or screenshot-only evidence.

See [docs/SPEC-vibecoding-studio.md](docs/SPEC-vibecoding-studio.md) for the full contract and [tasks/todo.md](tasks/todo.md) for the ordered plan.

## Contributing

Early-stage contributions are welcome, especially protocol and transport reviews. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security reports should follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
