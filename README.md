# DSH Vibecode Studio

> A visual feedback loop for **DeepSeek Harness**: preview your local web app inside DSH, point at what is wrong, and hand structured notes to the coding agent — no screenshot ping-pong.

**Status: pre-alpha.** This repository is in the spike phase. Nothing is installable as a product yet; the only working code is the S1 transport experiment under `spikes/s1/`. S1 is complete: Web and Desktop both sustain 30 fps over 10-minute stream soaks, with pull retained as a fallback (see the [transport report](spikes/s1/REPORT.md)).

[中文简介](#中文简介) · [Design](docs/SPEC-vibecoding-studio.md) · [Task plan](tasks/todo.md)

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
- Composer handoff that inserts a structured, editable message.
- Session-scoped page tabs for multi-page flows.
- Credentials never reach the page; UI only reads `describe` metadata.

## Repository layout

```text
docs/        product spec, capability map, DSH ecosystem notes
tasks/       implementation plan, ordered task list, handoff state
spikes/
  s1/        T001 transport spike: pull JPEG vs multipart stream
```

The product package will arrive in `packages/` after the spike gates pass. Until then, `spikes/s1/` is the only executable code.

## Development

Requirements: Node.js 24, pnpm 11, and DeepSeek Harness `0.2.1-rc.2` or newer for manual plugin runs.

```bash
pnpm install
pnpm typecheck
pnpm spike:s1:build          # bundle host/client (required before linking)
pnpm spike:s1                # local 10 s pull-vs-stream benchmark
node spikes/s1/soak.mjs ...  # 10 min Web/Desktop soak; see spikes/s1/REPORT.md
```

`spikes/s1/package/lib/` is generated and gitignored. Run `pnpm spike:s1:build` before `dsh plugin --profile vibe-dev add link:spikes/s1/package`; otherwise DSH links a package with no host/client entry points. Do not rebuild the linked package while a benchmark or soak is running; DSH hot-reloads the client and invalidates the measurement.

The S1 spike installs into a throwaway DSH profile (`vibe-dev`); it must never be installed into `desktop` or `web` directly.

### Engineering guardrails

- All host/client traffic goes through `ctx.connection`; no direct `ctx.webServer` use.
- Page and API content are treated as untrusted; secrets live only in `ctx.credentials`.
- Preview targets are localhost by default. `file:`, `chrome:`, `devtools:`, cloud metadata, and private-network targets are rejected.
- CDP attaches only to an already-started, approved endpoint and is never exposed to the network.
- No automatic sending, approving, committing, or screenshot-only evidence.

See [docs/SPEC-vibecoding-studio.md](docs/SPEC-vibecoding-studio.md) for the full contract and [tasks/todo.md](tasks/todo.md) for the ordered plan.

## Contributing

Early-stage contributions are welcome, especially protocol and transport reviews. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security reports should follow [SECURITY.md](SECURITY.md).

## 中文简介

DSH Vibecode Studio 是 DeepSeek Harness 的可视化 Vibe Coding 插件：在侧栏里预览本地 Web 应用，直接点选元素并写下修改意见，再把这些结构化批注交给编码 Agent。当前处于 pre-alpha 阶段，仓库里只有 S1 传输 spike 可以运行；预览、标注、批注箱与 composer 交接会在后续任务中逐步落地。

## License

[MIT](LICENSE)
