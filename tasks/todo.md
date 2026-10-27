# VibeCoding Studio — Phase 3 任务清单

> 状态：**已批准（2026-10-25；Tasks gate 通过，进入 Phase 4 实现）**
> 日期：2026-10-25
> 来源：[tasks/plan.md](./plan.md)（已批准）、[docs/CAPABILITY-MAP.md](../docs/CAPABILITY-MAP.md)
> 规则：
> - 每个任务 ≤ 1 个专注 session；执行时可拆 `a/b`，但 **ID 不变**。
> - 每个任务必须写清验收与验证命令；没有验证的任务不算完成。
> - 任务按依赖排序，不按重要性排序。
> - `[P]` = 可与同阶段任务并行；`[P1]` = 非 MVP 阻塞；`[GATE]` = 只评审/决策，不写产品代码。
> - 发现计划假设不成立，先更新 `plan.md`/SPEC，不硬写。
> - 执行时只读当前任务一节；不要通读整个清单。

---

## 0. 全局约定

- 包名：`dsh-vibecode-studio`；目录：仓库根目录（以下命令均从仓库根执行）。
- 开发 profile：`vibe-dev`；**不直接修改用户 `desktop` profile**。
- 所有 host/client 通信走 `ctx.connection`；不裸用 `ctx.webServer`。
- 所有页面/接口内容按不可信数据处理；密钥只走 `ctx.credentials`。
- 完成一个任务：勾选 + 在任务下补一行“验证结果”（命令/截图/报告路径）。

---

## M0：Spike Gate（阻塞 M1）

### - [x] T001 S1 传输 spike [P]

- **目标**：最小 host+client 插件，比较拉取式 JPEG 与流式帧在 DSH Web/Desktop 的稳定性。
- **验收**：两种 profile 都能 ≥ 10 fps（1280×800，JPEG q70）；30 s 不断流；切 tab 可恢复；报告给出最终选择。
- **验证**：`pnpm tsx spikes/s1/run.ts` + 手动 Web/Desktop；`spikes/s1/REPORT.md` 含 fps/内存/延迟表。
- **文件**：`spikes/s1/{host,client,run.ts,soak.mjs,REPORT.md}`。
- **验证结果（2026-10-25）**：`pnpm typecheck` 与 `pnpm spike:s1` 通过（pull 301 帧 / stream 300 帧，30 fps，0 gap/error）；Web 与隔离 Desktop 的 30 s pull/stream 验收均为 900–901 帧、30 fps、0 gap/错误/重连/丢帧，切 tab 后 canvas 恢复，metrics POST `saved: true`；10 min stream soak 为 Web 18,001 帧 / Desktop 18,000 帧、30 fps、0 断流/错误/重连，`packageChanged: false`，client/host 内存净增 < 2 MB。证据见 `spikes/s1/REPORT.md`；选型 stream 为主、pull 回退（Plan D3 已更新）。

### - [x] T002 S2 composer handoff spike [P]

- **目标**：从右栏 tab 把文本（和可选截图）放进当前会话 composer，且不自动发送。
- **验收**：文本路径 100% 成功；不自动提交；截图成功或剪贴板回退可用；不 import 私有 store。
- **验证**：手动 Web/Desktop；`spikes/s2/REPORT.md` 记录可用 API 路径与限制。
- **文件**：`spikes/s2/{client.tsx,host.ts,build.ts,package/,run.md,REPORT.md}`。
- **验证结果（2026-10-25）**：`pnpm typecheck` 与 `pnpm spike:s2:build` 通过；Web（`vibe-dev`）和隔离 Desktop 均通过 `conversation.input.left` 的公开 `inputActions` 完成 111 字符 `setDraft`、用户键盘编辑、光标 `insertText`，等待 2 s 后 `phase` 仍为 `plain` 且草稿完整，未自动提交；文本/PNG 剪贴板在两端均可用（Web 读出 `image/png`，Desktop 不透明 origin 无法 CDP 授权但 Electron 剪贴板正常）；console error 为 0。Web 跨会话文本隔离通过，但附件 id 切走再切回后丢失。`createDrafts` + `addAttachments` 在两端返回 accepted，但 `createDrafts` 不在公开 `IConversation`，D6 保持仅剪贴板回退。证据见 `spikes/s2/REPORT.md`。

### - [x] T003 S3 screencast + 输入 + 中文 spike [P]

- **目标**：Playwright + Edge 的 screencast、点击/滚动/键盘、中文输入、延迟测量。
- **验收**：headless/headful 均 ≥ 10 fps；输入延迟 < 200 ms；中文可用，或明确回退方案。
- **验证**：`pnpm tsx spikes/s3/run.ts`；`spikes/s3/REPORT.md` 含 fps/延迟/IME 结论。
- **文件**：`spikes/s3/{run.ts,fixture.html,REPORT.md}`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 与 `pnpm spike:s3 --seconds 10` 通过；headless 988 帧 / 98.7 fps、headful 983 帧 / 98.3 fps（unique fps 同值），首帧 24/18 ms，帧接收延迟 avg/p95 7.4/12.9 ms 与 5.4/8.1 ms；输入最大 26.8/25.2 ms（滚轮最高，点击/键盘/文本 1–9 ms）；中文 `insertText`（你好，世界）、逐字 `type`（中文）、CDP 模拟 IME（你好，composition 5 / composing 6）均通过；焦点 click=text、Tab=ime、Esc 正常；0 console error。限制：真实系统 IME 未在 DSH 载体手测（T022 补）；screencast 需在 T020 限速（约 20.2 KB/帧，98.7 fps ≈ 2 MB/s）。证据见 `spikes/s3/REPORT.md`。

### - [x] T004 S4 拾取 + 源码 spike [P]

- **目标**：Shadow DOM overlay 拾取；React/Vue/Svelte 开发态源码定位。
- **验收**：30 个元素源码命中 ≥ 80%；拾取不触发页面点击；`Esc` 退出；无 console 报错。
- **验证**：`pnpm tsx spikes/s4/run.ts`；`spikes/s4/REPORT.md` + 三框架命中率表。
- **文件**：`spikes/s4/{inject.ts,run.ts,fixtures/*,REPORT.md}`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 与 `pnpm spike:s4` 通过。React/Vue/Svelte 各 10/10，合计 30/30（100%），行号全部精确（delta=0）；选择器唯一 30/30；点击泄漏 0；Esc 三框架均退出；console/pageerror 0；overlay 均在 open Shadow DOM。React 19 已无 `_debugSource`，改用构建期 `data-inspector-*`（`@react-dev-inspector/babel-plugin`）；Vue 的 inspector 属性被移入 vnode `__v_inspector`；Svelte 读 `__svelte_meta`。证据见 `spikes/s4/REPORT.md` 与 `spikes/s4/results.json`。限制：仅 dev 模式、未覆盖 TSX/iframe/重复组件选择器。

### - [x] T005 G0 Spike 评审 [GATE]

- **目标**：汇总 S1–S4；确定帧传输基线（拉取/流式）、IME 回退、截图回退、源码回退。
- **验收**：`spikes/G0.md` 有 go/no-go 与每条回退的最终选择；若有阻塞，更新 `plan.md`。
- **验证**：人工评审；不写产品代码。
- **文件**：`spikes/G0.md`。
- **验证结果（2026-10-26）**：人工复核 S1–S4 报告与随附证据（`s1/bench.json`、`s3/results.json`、`s4/results.json`），未重跑 spike、未写产品代码。结论 **GO**：帧传输 stream 为主、pull 为回退；输入走 CDP 一元请求；中文主路径为隐藏 textarea + `compositionend` + `Input.insertText`，T022 系统 IME 手测失败时回退逐字/粘贴；截图仅复制 PNG 手动粘贴，不依赖非公开 `createDrafts`；源码按 React 构建期属性 / Vue vnode `__v_inspector` / Svelte `__svelte_meta` 适配，未命中则降级为选择器/DOM。无阻塞项，`plan.md` 无需新增修改。证据见 `spikes/G0.md`。

---

## M1：Foundation

> 依赖：G0 通过。T006 先做；T007/T008/T009 可在 T006 后并行；T010 依赖 T007/T009；T011 依赖 T008；T012 依赖 T006；T013 依赖 T009；T014 依赖 T010/T013。

### - [x] T006 包脚手架与工具链

- **目标**：`package.json`、TS strict、构建/测试脚本、目录骨架；host 能产出 ESM。
- **验收**：`pnpm install`、`pnpm typecheck`、`pnpm test`（smoke）、`pnpm build` 全绿；无 DSH 依赖错误。
- **验证**：上述命令；`pnpm build` 产出 `lib/index.js`。
- **文件**：`package.json`、`tsconfig.json`、`vitest.config.ts`、`scripts/*`、`src/host/index.ts`、`src/client/index.ts`。
- **验证结果（2026-10-26）**：`pnpm install`（already up to date）、`pnpm typecheck`（0 error）、`pnpm test`（Vitest 5.0.5，1 文件 / 3 用例通过）、`pnpm build` 全绿。`lib/index.js` 已生成（108 B，ESM `export { apply, name }`），构建脚本内 `import()` 自检通过；仓库无 DSH 运行时依赖。包名由 dev workspace `dsh-vibecode-studio-dev` 改为产品包 `dsh-vibecode-studio@0.1.0`（暂保留 `private`，T060 打包时处理）；`lib/` 已加入 `.gitignore`。

### - [x] T007 Client bundle loader 包装

- **目标**：把最小 client 插件打成 `window.__ModuleLoader__.load({ id, factory })` 格式的 `lib/client.js`，在 DSH 中加载。
- **验收**：`vibe-dev` 启动后出现 hello tab；无 loader 报错；React/JSX 正常。
- **验证**：`pnpm build:client`；`dsh --profile vibe-dev`；手动打开 tab。
- **文件**：`scripts/build-client.mjs`、`src/client/index.ts`、`src/client/hello.tsx`、`lib/client.js`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 0 error、`pnpm test` 4/4、`pnpm build:client` 通过，产出 loader 包装的 `lib/client.js`（3.2 KiB）。packages 以 link 装入 `vibe-dev` 后启动 `dsh --profile vibe-dev --no-open --host 127.0.0.1 --port 4317`；headless Edge 打开右栏“新标签页”菜单可见 **Vibe Studio**，点击后 `[data-vibe-hello="1"]` 渲染，点击按钮计数 0→1（React state 生效）；`dsh-vibecode-studio/client.js` 响应 200，console/pageerror 0，无 loader 报错。为让 DSH 识别包，另补了 `cordis.patch.yml` 与 `package.json` 的 `dsh.bundle`/`dsh.client.inject`（renderer、sidebar-right）。限制：本轮只验证 Web 载体；Desktop 留到 T015。

### - [x] T008 Host 插件骨架与 Config

- **目标**：`name`/`inject`/`apply`；`Config` 用 schemastery；服务注册位；profile 安装说明。
- **验收**：`--dump-config` 含本插件；非法配置被拒；启动无报错。
- **验证**：`dsh --profile vibe-dev --dump-config`；改坏配置做负例。
- **文件**：`src/host/index.ts`、`src/host/config.ts`、`profiles/vibe-dev/README.md`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 0 error；`pnpm test` 2 文件 / 10 用例通过（新增 `tests/unit/config.test.ts` 6 例）；`pnpm build` 生成 `lib/index.js` 2.4 KiB，构建脚本内 `import()` 自检通过。`dsh --profile vibe-dev --dump-config` 输出含 `# == dsh-vibecode-studio`、`- id: vibe-studio`、`name: dsh-vibecode-studio`；`.tmp/t008-valid.yml` 覆盖值（debug / localhost:5173 / 14 天）出现在 dump 中。负例用 `--patch .tmp/t008-invalid.yml` 实际启动（4319）：`dsh: warning: 1 entry did not activate`，`vibe-studio (dsh-vibecode-studio): ValidationError: invalid config: - $.logLevel expected "debug" | "info" | "warn" | "error" but got "verbose"`，其余 DSH 正常服务；`--dump-config` 本身不校验配置。默认配置在 4317 启动 20 s，无 warning/error，超时退出（124）；两个端口均已释放。语义校验补在 `resolveConfig()`（拒绝未知键、规范化并去重 origin、要求至少一个 origin）。

### - [x] T009 Contracts v1

- **目标**：`TargetKind/TargetConfig/TargetCapabilities/TargetSession`、`Annotation`、`ElementContext`、`SourceContext`、`ConsoleEntry`、`NetworkEntry`、`StudioError`、`ArtifactRef`、预算/截断、不可信包裹。
- **验收**：纯类型/纯函数；单测覆盖序列化、预算、脱敏、包裹；无运行时依赖。
- **验证**：`pnpm test -- tests/unit/contracts`。
- **文件**：`src/contracts/*`、`tests/unit/contracts/*`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/unit/contracts` → 6 文件 / 34 用例通过；全量 `pnpm test` → 8 文件 / 44 用例通过；`pnpm build` 通过。注意：`pnpm test -- tests/unit/contracts` 在 vitest 下不会过滤，实际跑全量，已改用 `pnpm exec vitest run <path>`。覆盖：Annotation JSON round-trip 与坏数据拒绝、品牌 ID、UTF-8 预算与 CJK/emoji 安全截断、注解渲染 ≤4 KB、Console/Network 单行摘要与 500 B 预算、header/query/JSON body 脱敏、`<untrusted-page-content>` 边界逃逸与实体膨胀预算。所有 `src/contracts/*` 只互相引用，无第三方或 Node/DOM 运行时依赖；`TargetSession`/`ArtifactRef` 等为纯类型契约。

### - [x] T010 Client shell + 右栏 tab

- **目标**：注册 `Vibe Studio` tab（`keepMounted`、全屏、guide）；内部页签占位；空/错/加载状态；i18n 骨架。
- **验收**：tab 可开/全屏；切 tab/会话不丢；占位页可见；组件测试通过。
- **验证**：手动 + `pnpm exec vitest run tests/component/shell`。
- **文件**：`src/client/shell/*`、`src/client/locales/{zh-CN,en}.json`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/component/shell` 3 文件 / 13 用例、全量 `pnpm test` 11 文件 / 57 用例通过；`pnpm build` host 2.4 KiB / client 12.0 KiB。`vibe-dev` + headless Edge 实测：guide 卡片可开 tab，四个内部页签（预览/检查/标注/API）切换与占位文案正确，全屏进入/退出保持当前页签，收起右栏再展开、关闭 tab 后重开均保留“标注”页签，client.js 200、console/pageerror 0。新增 devDependencies `jsdom`/`@testing-library/react`/`@testing-library/dom`（仅测试）。限制：未单独脚本化切 Session；运行中切换系统语言需重载。

### - [x] T011 Connection 传输骨架

- **目标**：host 用 `fetch.register` 注册精确 `/api/vibe/*` 路由（health + 一元请求）；client 用文档相对 `fetch`；不使用 `rpc.handle`（S1 已证第三方插件会因缺少 `webServer` inject 失败）；Web/Desktop 都通。
- **验收**：health 返回；一元请求成功；未认证/跨源被拒；Desktop 可用。
- **验证**：手动 Web/Desktop；`pnpm exec vitest run tests/integration/transport`（`pnpm test -- <path>` 不会过滤，见下方命令更正）。
- **文件**：`src/host/transport/*`、`src/client/transport/*`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/integration/transport` 2 文件 / 26 用例、全量 `pnpm test` 13 文件 / 83 用例通过；`pnpm build` host 11.8 KiB / client 12.0 KiB。实现：`src/contracts/transport.ts` 共享路径与信封契约，`src/host/transport/*`（`UnaryRegistry` + health/unary 两条精确路由，方法表可扩展），`src/client/transport/*`（文档相对 fetch、超时/调用方中止、稳定错误映射），`tests/helpers/fake-host.ts`。真实载体：`vibe-dev` 加 `--patch .tmp/t011-disable-spikes.yml` 临时禁用 s1/s2 同路径路由（不改 profile 文件），raw HTTP 9/9——无 cookie health 401、token 303 + Set-Cookie、认证 health 200、`Origin: http://evil.example` 403、`Host: evil.example` 403、认证 `studio.ping` 200 echo、`text/plain` 415；headless Edge 页面内执行 client transport，文档相对 `api/vibe/health` / `api/vibe/request` 均成功、ping echo `{source:'web'}`、未知方法映射 `not_found/404`、除该预期 404 外 console 0；隔离 Desktop（`.tmp/desktop-home` + 独立 userData + loopback 9223，`dsh-app://app`）health 与 ping 均成功、console 0，进程树已清理。限制：client transport 尚未接入 `src/client/index.ts` 的出厂 bundle（按 T011 文件边界，待后续 UI 任务接线）；未认证/跨源拒绝来自 DSH Connection 自身，插件不重复实现。

### - [x] T012 测试 harness + fixture

- **目标**：Vitest、React Testing Library、Playwright 配置；Vite fixture 骨架；假 adapter。
- **验收**：示例单测/集成/E2E 全绿；fixture 可启动。
- **验证**：`pnpm test`、`pnpm test:e2e`。
- **文件**：`tests/*`、`fixtures/vite-basic/*`、`playwright.config.ts`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 0 error；Vitest 拆为 `node`（smoke/unit/integration）与 `component`（jsdom + 统一 cleanup）两个 project，全量 `pnpm test` 14 文件 / 89 用例通过（原 13/83 + 假 adapter 6 例），`pnpm exec vitest run tests/component/shell` 仍为 3 文件 / 13 用例。新增 `playwright.config.ts`（`channel: 'msedge'`、headless、1280×800、webServer 自动拉起 fixture、产物写 `.tmp/playwright-results`），`pnpm test:e2e` 3/3 通过（首屏与计数、中文表单、`/api/echo` 与 `/api/boom`）；fixture 监听 `127.0.0.1:4320`，测试结束无 LISTENING 残留。`fixtures/vite-basic` 为 React 19 + Vite 8 骨架（计数器、表单、列表、控制台错误按钮，`/api/echo`、`/api/boom`、`/api/slow`），可用 `pnpm fixture:dev` 单独启动。新增 `tests/helpers/fake-adapter.ts` 生命周期替身（并发 start 合并、重复 start 复用、stop 幂等、启动失败态）及 6 个集成用例。`pnpm build` 通过（host 11.8 KiB / client 12.0 KiB）。新增 devDependencies `@playwright/test@1.64.1`、`@types/react-dom@18.0.0`；Playwright 使用本机 Edge，未下载浏览器。

### - [x] T013 `.vibe` 配置存储

- **目标**：`studio.json` 读写、原子写、校验、默认值、坏数据回退。
- **验收**：round-trip；坏 JSON 不崩溃；路径限定项目内。
- **验证**：`pnpm test -- tests/unit/studio-store`。
- **文件**：`src/host/studio/store.ts`、`tests/unit/studio-store.test.ts`。
- **验证结果（2026-10-26）**：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/unit/studio-store` 1 文件 / 10 用例通过；全量 `pnpm test` 15 文件 / 99 用例通过；`pnpm build` 通过（host 11.8 KiB / client 12.0 KiB，store 尚未接入 host 入口，体积不变）。实现：`StudioStore` 以 `realpath` 解析项目根、`.vibe` 与 `studio.json` 并做包含校验，拒绝指向项目外的 junction/symlink；读取对缺失文件返回 `missing` + 默认值，对坏 JSON、超版本、超 256 KiB、字段非法返回 `invalid` + 回收后的默认值 + `issues`，不抛异常、不改写原文件；写入先 `parseStudioDocument` 校验（含 origin 归一化、去重、范围检查），再在 `.vibe` 内同目录临时文件 `wx` 写入 + `rename` 原子替换，失败清理临时文件。测试覆盖 round-trip/去重/换行、缺文件、坏 JSON 保留原文件、字段级回收、版本不支持、未知键、非法写入不建目录、超大文件、`.vibe` junction 逃逸、项目目录缺失；临时目录均建在 `.tmp/studio-store-*` 并在用例后删除，无残留。命令更正：本仓库用 `pnpm exec vitest run tests/unit/studio-store`（`pnpm test -- <path>` 不过滤）。

### - [x] T014 设置面板（基础）

- **目标**：origin 允许列表、保留期、上下文预算、截图开关、日志级别；持久化。
- **验收**：UI 改动持久化；服务读取同一配置；非法值有提示。
- **验证**：组件测试 + 手动。
- **文件**：`src/client/shell/settings/*`、`src/host/studio/settings.ts`。
- **验证结果（2026-10-27）**：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/unit/studio-settings.test.ts tests/component/shell/settings.test.tsx tests/component/shell/studio-shell.test.tsx` 3 文件 / 19 用例通过；全量 `pnpm test` 17 文件 / 114 用例通过；`pnpm build` 通过（host 25.8 KiB / client 36.8 KiB）。实现：`settings.ts` 懒读 `StudioStore`，把文档值应用到与 health 共享的同一 `VibeStudioConfig` 对象；`studio.settings.get/update` 注册到 unary transport，update 合并后严格校验，非法值返回 `invalid_input` + `issues` 且不落盘；`SettingsPage` 本地校验数字范围与空 origin，Host issues 映射到字段，保存后显示“已保存”。手动：`.tmp/t014-verify.mjs` 在 `vibe-dev` + headless Edge（`--patch .tmp/t014-profile-patch.yml` 临时禁用 s1/s2 同路径路由）两轮启动——首轮为默认值 + “尚未保存”提示；保存后 `.vibe/studio.json` 写入 version 1（retentionDays 14 / contextBudgetBytes 16384 / screenshotEnabled false / logLevel debug / 新增 origin），health 返回同一组值；retentionDays 输入 0 出现字段提示且文件不变；重启后表单仍为保存值、无提示；console 0。测试生成的 `.vibe/` 已删除，4322–4324 仅 TIME_WAIT、无 dsh/Edge 残留。表单加 `noValidate`，避免浏览器原生校验绕过组件内翻译提示。

### - [x] T015 G1 Foundation 评审 [GATE]

- **目标**：干净 `vibe-dev` profile 安装；tab 可见；health 通；全量检查。
- **验收**：`pnpm typecheck/test/build` 绿；Web/Desktop 均能开 tab；未改 desktop profile。
- **验证**：上述命令 + 手动；`tasks/todo.md` 勾选记录。
- **文件**：无。
- **验证结果（2026-10-27）**：`pnpm typecheck` 0 error；`pnpm test` 17 文件 / 114 用例；`pnpm build` host 25.8 KiB / client 36.8 KiB；`pnpm test:e2e` 3/3。根因处理：`vibe-dev` 的 s1/s2 spike 与 studio 抢 `/api/vibe/health`，在 profile patch 层新增 `disabled: true`（改前备份 `.tmp/logs/vibe-dev-cordis.patch.yml.bak-2026-10-27`，删两行即可恢复）；不带 `--patch` 启动后 `studio.ping` 与 `studio.settings.get` 均 200，health 返回 `plugin: dsh-vibecode-studio`。Web（headless Edge，4327）打开右栏 Vibe Studio：5 页签（预览/检查/标注/API/设置）、设置页回填默认值 + 未保存提示、health 同源，console 0。Desktop（隔离 `DSH_HOME=.tmp/desktop-home`，CDP 9223）同样 5 页签 + 设置页、health 200；真实 `desktop` profile 前后 SHA-256 一致（`850eb26…b6a7c`），未修改。2 条 503 为 Host 就绪前预热轮询噪声，无其他 console 错误。结束后无 LISTENING 端口、无 dsh/Desktop/Edge 残留、未生成 `.vibe`。

---

## M2：Preview

> 依赖：G1。T016 先做；T017/T018/T019 可在 T016 后并行；T020 依赖 T017/T019；T021 依赖 T020；T022 依赖 T021；T023/T024 依赖 T017；T025 依赖 T016–T024。

### - [x] T016 Target 模型、配置与 adapter 注册表

- **目标**：目标配置校验、能力声明、adapter 注册、假 adapter、错误码。
- **验收**：非法配置/未知 adapter 有明确错误；假 adapter 生命周期单测通过。
- **验证**：`pnpm test -- tests/unit/targets`。
- **文件**：`src/host/targets/{types,registry,validate}.ts`、tests。
- **验证结果（2026-10-27）**：`src/host/targets/types.ts` 定义 `TargetAdapter`（id/kind/capabilities/start/stop，可选 navigate/screenshot）与 `ValidatedTargetConfig`、`DEFAULT_VIEWPORT`、`assertCapability`；`validate.ts` 校验 id/name/kind/url/command/cwd/port/viewport，拒绝未知键、非 http(s)、凭证 URL、相对 cwd、越界端口/viewport，错误统一为 `invalid_config` + `details.field`，url 归一化、viewport 默认 1280×720@1；`registry.ts` 每 kind 一个 adapter，重复 kind/id、缺 capability 均 `invalid_config`，未知 kind 报 `unsupported: unknown target adapter "x"`，已知未注册 kind 报 `no target adapter registered`。`apply()` 向 `vibeStudio` 服务增加空 `targets` registry（T017+ 注册）。`tests/helpers/fake-adapter.ts` 改为实现真实契约（保留 status/sessions/logs 观测）。验证：`pnpm exec vitest run tests/unit/targets` 3 文件 / 21 用例通过；`pnpm typecheck` 0 error；全量 `pnpm test` 20 文件 / 135 用例通过；`pnpm build` host 34.6 KiB / client 36.8 KiB。同步更新 `tests/unit/config.test.ts` 的服务槽断言（新增 `targets`）。

### - [x] T017 Web target adapter（启动/导航/截图）

- **目标**：Playwright 启动 Edge（`channel: 'msedge'`）；导航、viewport、截图、关闭；暂不做 screencast。
- **验收**：fixture 页面可打开；截图正确；Edge 缺失时有明确提示；关闭无残留。
- **验证**：`pnpm exec vitest run tests/integration/web-adapter`。
- **文件**：`src/host/targets/web/{adapter,launch}.ts`、tests。
- **验证结果（2026-10-27）**：`src/host/targets/web/launch.ts` 懒加载 `playwright-core`（缺失 → `target_unavailable`），`launchEdge()` 仅用本机 `channel: 'msedge'`、默认 headless；`toStartError`（缺失 Edge → `target_unavailable`，消息不含本机路径；其他 → `preview_failed`）、`toNavigationError`（超时 → `timeout`，`net::ERR_CONNECTION_*` → `target_unavailable`，其他 → `preview_failed`）、`toScreenshotError`。`adapter.ts` 实现 `TargetAdapter` 生命周期（start 合并并发调用、stop 幂等、失败可重试）、viewport/deviceScaleFactor/colorScheme=light 上下文、`navigate`（成功后更新 session url）、`screenshot`（PNG、viewport 尺寸、动画禁用）、非 loopback 目标默认 `permission_denied`（`allowNonLocal` 显式放开）、`file:`/`chrome:` 等 scheme `unsupported`；能力声明只开 `screenshot`。`apply()` 注册 web adapter。验证：`pnpm exec vitest run tests/integration/web-adapter` 2 文件 / 13 用例通过；`pnpm typecheck` 0 error；全量 `pnpm test` 22 文件 / 148 用例通过；`pnpm build` host 43.4 KiB / client 36.8 KiB，产物中 `playwright-core` 仍为懒加载；`pnpm test:e2e` 3/3。真实 Edge + 临时端口 Vite fixture：800×600 PNG 解码校验（左上白底、>1000 深色文字像素）、导航 query 生效、关闭后 `browser.isConnected()===false` 且无 `playwright_chromiumdev_profile` msedge 进程、可再次启动为 `fixture-2`；不可达端口导航稳定返回 `target_unavailable` 且 session 保持 ready；用真实 Playwright「可执行文件不存在」错误与模拟缺失 channel 验证 Edge 缺失提示。附加测试助手 `tests/helpers/png.ts`（无第三方依赖的 8-bit PNG 解码）。

### - [ ] T018 S8 进程生命周期 spike [P]

- **目标**：Vite 启动、端口探测、Windows 进程树清理、端口冲突。
- **验收**：启动 < 10 s；停止无孤儿；端口冲突有可读错误；报告结论。
- **验证**：`pnpm tsx spikes/s8/run.ts`；`spikes/s8/REPORT.md`。
- **文件**：`spikes/s8/{run.ts,REPORT.md}`。

### - [ ] T019 Dev server 进程监督

- **目标**：按 S8 结论实现 supervisor：spawn、日志 ring buffer、健康检查、停止、Windows tree kill。
- **验收**：启动/停止/重启；日志可见；无孤儿；单测用假进程。
- **验证**：`pnpm test -- tests/integration/supervisor` + 手动。
- **文件**：`src/host/targets/process/{supervisor,logs}.ts`、tests。

### - [ ] T020 Screencast + 帧路由 + canvas

- **目标**：CDP `Page.startScreencast`；最新帧 + seq；用精确 `/api/vibe/stream`（multipart JPEG）为主通道，`/api/vibe/frame?wait=1&after=<seq>` 为回退；client canvas 渲染；断流后切 pull，恢复后切回 stream。
- **验收**：Web ≥ 10 fps；Desktop 手动通过；模拟断流可回退且无内存泄漏。
- **验证**：`pnpm test -- tests/integration/frames` + 手动 Web/Desktop。
- **文件**：`src/host/preview/{screencast,frame-buffer,route}.ts`、`src/client/preview/{Canvas.tsx,transport.ts}`、tests。

### - [ ] T021 输入转发（点击/滚轮/键盘）

- **目标**：CDP `Input.*`；坐标映射；modifiers；点击/滚动/按键。
- **验收**：fixture 表单可点击/输入/滚动；焦点正确；延迟 < 200 ms。
- **验证**：`pnpm test -- tests/integration/input` + 手动。
- **文件**：`src/host/preview/input.ts`、`src/client/preview/InputLayer.tsx`、tests。

### - [ ] T022 中文输入

- **目标**：隐藏 textarea + `compositionstart/update/end` → `Input.insertText`；回退文案。
- **验收**：fixture 输入“你好，世界”正确；失败时有明确限制提示。
- **验证**：手动 fixture + `spikes/s3` 结论。
- **文件**：`src/client/preview/ImeInput.tsx`、`src/host/preview/input.ts`。

### - [ ] T023 Console 采集与抽屉

- **目标**：CDP `Runtime.consoleAPICalled`/`exceptionThrown`；ring buffer；UI 过滤/清空。
- **验收**：错误/警告可见；上限生效；清空可用。
- **验证**：integration + component test。
- **文件**：`src/host/preview/console.ts`、`src/client/preview/ConsoleDrawer.tsx`、tests。

### - [ ] T024 Network 采集与抽屉

- **目标**：CDP Network 事件；请求/响应摘要；body 按需；上限与脱敏；UI。
- **验收**：method/url/status/time 可见；4xx/5xx 标记；敏感 header 脱敏。
- **验证**：integration + component test。
- **文件**：`src/host/preview/network.ts`、`src/client/preview/NetworkDrawer.tsx`、tests。

### - [ ] T025 预览工具栏与生命周期

- **目标**：工具栏（目标/URL/刷新/视口/外部打开）；浏览器崩溃/断线提示；关 tab/停目标清理。
- **验收**：操作可用；崩溃可重启；5 s 内进程退出；无孤儿。
- **验证**：手动矩阵 + integration。
- **文件**：`src/client/preview/Toolbar.tsx`、`src/host/preview/session.ts`、tests。

### - [ ] T026 G2 Preview 评审 [GATE]

- **目标**：验证预览闭环与性能。
- **验收**：10 fps；点击/输入/滚动；Console/Network；停止清理；SPEC 相关条目通过。
- **验证**：手动 + `pnpm test`；记录到 `tasks/todo.md`。
- **文件**：无。

---

## M3：Inspect + Annotation

> 依赖：G2；T027 可先在 S4 harness 上开发。T030 依赖 T009；T031 依赖 T010/T030；T032 依赖 T031；T033 依赖 T030。

### - [ ] T027 拾取 overlay 与选择器

- **目标**：注入脚本、Shadow DOM overlay、hover/click、`Esc`、`Alt+Click`；选择器生成。
- **验收**：不触发页面原点击；选择器唯一或标注“非唯一”；10 个元素抽测通过。
- **验证**：复用 S4 harness + integration。
- **文件**：`src/host/inspect/{inject.ts,selector.ts}`、`src/client/inspect/Picker.tsx`、tests。

### - [ ] T028 元素上下文提取

- **目标**：DOM 片段、文本、role/name、box、可见性；深度/长度上限。
- **验收**：DOM ≤ 2 KB；文本 ≤ 200 字；box/role 正确；单测通过。
- **验证**：`pnpm test -- tests/unit/inspect-context`。
- **文件**：`src/host/inspect/{dom,accessibility}.ts`、tests。

### - [ ] T029 源码适配（React/Vue/Svelte）

- **目标**：React fiber、Vue `__file`、Svelte `__svelte_meta`；不可用回退。
- **验收**：30 个元素 ≥ 80%；生产态/无 source 时不报错；回退明确。
- **验证**：三 fixture + `pnpm test -- tests/e2e/source-adapters`。
- **文件**：`src/host/inspect/source/{react,vue,svelte,index}.ts`、tests。

### - [ ] T030 标注模型、存储与文本渲染

- **目标**：`Annotation` schema、序列化、文本渲染、预算、`.vibe/annotations` 存储。
- **验收**：round-trip；≤ 4 KB；不可信包裹；坏数据回退。
- **验证**：`pnpm test -- tests/unit/annotation`。
- **文件**：`src/contracts/annotation/*`、`src/host/inspect/annotation-store.ts`、tests。

### - [ ] T031 标注气泡与队列

- **目标**：元素旁气泡、侧栏队列、编辑/取消/发送；空状态。
- **验收**：拾取 → 写意见 → 放入对话 ≤ 3 步；组件测试通过。
- **验证**：`pnpm test -- tests/component/annotation` + 手动。
- **文件**：`src/client/inspect/{AnnotationBubble,AnnotationQueue}.tsx`、tests。

### - [ ] T032 Composer handoff

- **目标**：按 S2 结论走公开 API 插入草稿；不自动发送；截图/剪贴板回退。
- **验收**：文本 100% 成功；不自动提交；附件路径或剪贴板回退可用；切会话不串。
- **验证**：手动 Web/Desktop + integration。
- **文件**：`src/client/inspect/handoff.ts`、`src/client/inspect/handoff.test.ts`。

### - [ ] T033 标注历史

- **目标**：列表、搜索、重新打开、删除；持久化。
- **验收**：重启后仍在；坏数据不崩溃；删除生效。
- **验证**：`pnpm test -- tests/unit/annotation-history` + 手动。
- **文件**：`src/host/inspect/history.ts`、`src/client/inspect/History.tsx`、tests。

### - [ ] T034 G3 Inspect 评审 [GATE]

- **目标**：验证圈选/标注/发送闭环与预算。
- **验收**：50 元素源码 ≥ 80%；标注 ≤ 4 KB；3 步内进 composer；不自动发送。
- **验证**：手动 + `pnpm test`；记录结果。
- **文件**：无。

---

## M4：API Workbench

> 依赖：G1；可与 M2 并行。T035/T036/T037 可并行；T038 依赖 T035/T036；T039 依赖 T038；T040 依赖 T035；T041 独立；T042 依赖 T041；T043 依赖 T024/T037；T044 依赖 T037/T038/T043；T045 依赖 T035；T046 汇总。

### - [ ] T035 HTTP 执行器

- **目标**：method/url/query/headers/body/auth；超时/取消/重定向/响应上限。
- **验收**：JSON/form/multipart；取消不泄漏；重定向可控；大响应截断；单测通过。
- **验证**：`pnpm test -- tests/unit/http-executor` + 本地 echo server。
- **文件**：`src/host/api/{executor,request}.ts`、tests。

### - [ ] T036 环境、变量与密钥

- **目标**：环境模型、`{{var}}` 解析、`ctx.credentials` 集成；UI 只读 describe。
- **验收**：未解析变量有提示；密钥不回传客户端；单测通过。
- **验证**：`pnpm test -- tests/unit/api-env`。
- **文件**：`src/host/api/{environment,secrets}.ts`、`src/client/api/EnvironmentEditor.tsx`、tests。

### - [ ] T037 集合与历史持久化

- **目标**：集合/文件夹/历史 JSON；原子写；脱敏；schema 校验。
- **验收**：保存/重开/复制/删除；历史搜索/清空；无明文密钥。
- **验证**：`pnpm test -- tests/unit/api-store`。
- **文件**：`src/host/api/{collection-store,history-store}.ts`、tests。

### - [ ] T038 请求构建 UI

- **目标**：method/URL/query/headers/body/auth；发送/取消；校验与错误提示。
- **验收**：常见 JSON/form/multipart 可发；错误可读；组件测试通过。
- **验证**：`pnpm test -- tests/component/api-request` + 手动。
- **文件**：`src/client/api/{RequestBuilder,RequestForm}.tsx`、tests。

### - [ ] T039 响应查看 UI（基础）

- **目标**：状态/耗时/大小/headers/body；raw/文本/JSON 基础美化；大响应虚拟化。
- **验收**：10 MB 响应不冻结；错误状态可读；组件测试通过。
- **验证**：`pnpm test -- tests/component/api-response` + 手动。
- **文件**：`src/client/api/{ResponseView,ResponseHeaders}.tsx`、tests。

### - [ ] T040 富响应体（JSON 树/HTML/图片/二进制）

- **目标**：可折叠 JSON 树、HTML 沙箱 iframe、图片预览、二进制下载；深度/节点上限。
- **验收**：XSS 沙箱；大 JSON 不卡；图片正确；组件测试。
- **验证**：`pnpm test -- tests/component/api-rich-response` + 手动。
- **文件**：`src/client/api/{JsonTree,HtmlPreview,ImagePreview}.tsx`、tests。

### - [ ] T041 S7 OpenAPI spike [P]

- **目标**：500 端点、远程 ref、循环 ref、SSRF 限制、导入耗时。
- **验收**：< 5 s；远程 ref 拦截；错误可读；报告。
- **验证**：`pnpm tsx spikes/s7/run.ts`；`spikes/s7/REPORT.md`。
- **文件**：`spikes/s7/{run.ts,REPORT.md}`。

### - [ ] T042 OpenAPI 导入

- **目标**：Swagger 2.0/OpenAPI 3.x；tag 分组；示例 body；远程 ref 限制；端点上限。
- **验收**：500 端点可用；循环 ref 不崩；导入结果可保存；单测通过。
- **验证**：`pnpm test -- tests/integration/openapi`。
- **文件**：`src/host/api/openapi/{parser,resolver,mapper}.ts`、tests。

### - [ ] T043 抓包回放

- **目标**：`NetworkEntry` → 请求草稿；method/url/headers/body；不自动发送非幂等。
- **验收**：回放与原请求一致；DELETE/PUT/PATCH 需确认；避免自动重放。
- **验证**：`pnpm test -- tests/integration/capture-replay` + 手动。
- **文件**：`src/host/api/replay.ts`、`src/client/api/ReplayButton.tsx`、tests。

### - [ ] T044 集合/历史 UI

- **目标**：集合树、保存/重开、历史搜索/重放/清空；空状态。
- **验收**：抓包 → 回放 → 保存 → 重开 ≤ 3 次点击；组件测试。
- **验证**：`pnpm test -- tests/component/api-collections` + 手动。
- **文件**：`src/client/api/{CollectionTree,HistoryList}.tsx`、tests。

### - [ ] T045 断言（P1）

- **目标**：状态码/header/JSONPath/耗时；pass/fail；不执行任意 JS。
- **验收**：四类断言可用；错误可读；单测通过。
- **验证**：`pnpm test -- tests/unit/assertions`。
- **文件**：`src/host/api/assertions.ts`、`src/client/api/AssertionsEditor.tsx`、tests。

### - [ ] T046 G4 API 评审 [GATE]

- **目标**：验证 API 工作台闭环与安全。
- **验收**：抓包 → 回放 → 保存 → 重开；500 端点导入；密钥不泄漏；SPEC 相关条目通过。
- **验证**：手动 + `pnpm test`；记录结果。
- **文件**：无。

---

## M5：Agent Integration

> 依赖：G3/G4 的公开接口。T047 先做；T048 依赖 T020/T030；T049 依赖 T020；T050 依赖 T047；T051 依赖 T047；T052 依赖 T047/T051；T053 依赖 T020/T030；T054 汇总。

### - [ ] T047 工具 schema 与注册

- **目标**：`vibe_status`/`vibe_observe`/`vibe_annotation_get`/`vibe_preview` 的 schema、注册、假服务测试。
- **验收**：schema 可被模型调用；preset 中可见；错误码统一；单测通过。
- **验证**：`pnpm test -- tests/unit/tools`。
- **文件**：`src/host/agent/tools/{definitions,register}.ts`、tests。

### - [ ] T048 status/observe/annotation 实现

- **目标**：三个工具的实际数据；摘要 + artifact id；预算截断。
- **验收**：默认 ≤ 8 KB；数据正确；不可信包裹；单测通过。
- **验证**：`pnpm test -- tests/integration/tools`。
- **文件**：`src/host/agent/tools/{status,observe,annotation}.ts`、tests。

### - [ ] T049 preview 工具与门禁

- **目标**：reload/navigate/screenshot/start/stop；origin 限制；start/stop 走 ask/审批。
- **验收**：越权/非 localhost 被拒；审批触发；单测通过。
- **验证**：`pnpm test -- tests/integration/preview-tool`。
- **文件**：`src/host/agent/tools/preview.ts`、tests。

### - [ ] T050 `/vibe` 命令

- **目标**：注册命令；返回状态 + 下一步建议；不执行危险动作。
- **验收**：命令可见；输出 ≤ 2 KB；无副作用；单测通过。
- **验证**：`pnpm test -- tests/integration/command` + 手动。
- **文件**：`src/host/agent/commands/vibe.ts`、tests。

### - [ ] T051 Bundled skill

- **目标**：`SKILL.md` + `references/`；`bundledSkillDir` 挂载；说明何时用工具、如何省上下文。
- **验收**：`skill` 工具能加载；SKILL.md ≤ 8192 字符；引用路径有效。
- **验证**：手动 + `pnpm test -- tests/integration/skill`。
- **文件**：`skills/vibecoding-studio/{SKILL.md,references/*}`、`src/host/agent/skills.ts`。

### - [ ] T052 `Vibe Studio` preset

- **目标**：最小工具集 preset（fs/fs-search/bash/pwsh/jobs/web/skill/plan/todo/ask-user/compaction + vibe 工具）；不改 standard。
- **验收**：preset 可选；工具可见；standard 不受影响；`--dump-config` 正常。
- **验证**：手动 + `dsh --profile vibe-dev --dump-config`。
- **文件**：`presets/vibe-studio/*`、`src/host/agent/preset.ts`。

### - [ ] T053 Hooks（过期提示/越权拦截）

- **目标**：文件编辑后标记预览“可能过期”；`tools/pre-execute` 拦截越权预览动作。
- **验收**：编辑后 UI 有提示；越权被 deny；不误伤 standard；单测通过。
- **验证**：`pnpm test -- tests/integration/hooks`。
- **文件**：`src/host/agent/hooks/{stale,guard}.ts`、tests。

### - [ ] T054 G5 Agent 评审 [GATE]

- **目标**：验证工具/preset/skill/门禁/预算。
- **验收**：preset 工具可用；standard 不受影响；越权被拒；skill 加载；结果 ≤ 8 KB。
- **验证**：手动 + `pnpm test`；记录结果。
- **文件**：无。

---

## M6：Verify + Hardening

> 依赖：M2–M5。T055 先做；T056 依赖 T055；T057 依赖 M3/M5；T058/T059 依赖功能完成；T060 最后；T061 汇总。

### - [ ] T055 验证服务（基础检查）

- **目标**：目标在线、页面可加载、无 console error、无失败请求；结果 schema。
- **验收**：fixture 故意报错/500 能捕获；结果 ≤ 4 KB；单测通过。
- **验证**：`pnpm test -- tests/integration/verify`。
- **文件**：`src/host/verify/{service,checks}.ts`、tests。

### - [ ] T056 验证面板

- **目标**：运行、结果列表、证据跳转、空/错状态。
- **验收**：一键运行；证据可跳 Console/Network；组件测试。
- **验证**：`pnpm test -- tests/component/verify` + 手动。
- **文件**：`src/client/verify/*`、tests。

### - [ ] T057 E2E 主链路

- **目标**：DSH + Vite fixture：打开 Studio → 拾取 → 标注 → 放入对话 → 发送 → 预览可见。
- **验收**：E2E 稳定通过；无 flaky；失败有截图/日志。
- **验证**：`pnpm test:e2e`。
- **文件**：`tests/e2e/studio.spec.ts`、`playwright.config.ts`。

### - [ ] T058 Soak/性能

- **目标**：30 分钟使用 + 100 次标注；内存/进程/帧率；修复暴露的问题。
- **验收**：无崩溃、无进程泄漏、内存增长可解释；报告。
- **验证**：`pnpm test:soak` + 手动；`tasks/soak-report.md`。
- **文件**：`tests/soak/*`、报告。

### - [ ] T059 安全加固

- **目标**：脱敏审计、origin 白名单、SSRF、prompt injection fixture、CDP 暴露检查、清理。
- **验收**：SPEC 3.2/9 的安全项全过；报告；修复项关闭。
- **验证**：`pnpm test:security` + 手动检查。
- **文件**：`tests/security/*`、`docs/SECURITY.md`。

### - [ ] T060 打包与文档

- **目标**：`files` 白名单、client bundle、README/USER-GUIDE/RELEASE；干净 profile 安装；`npm pack` 检查。
- **验收**：包内只含允许文件；干净安装可用；文档覆盖安装/使用/限制。
- **验证**：`pnpm build`、`npm pack --dry-run`、干净 `vibe-dev` 安装。
- **文件**：`package.json`、`README.md`、`docs/{USER-GUIDE,SECURITY,RELEASE}.md`。

### - [ ] T061 G6 最终评审 [GATE]

- **目标**：对照 SPEC 第 2.3 节 1–8 条逐项验收。
- **验收**：全部达标；`pnpm typecheck/test/build` 绿；干净安装；MVP 可交付。
- **验证**：逐条清单 + 命令输出；记录到 `tasks/todo.md`。
- **文件**：无。

---

## Phase B/C Backlog（不在本轮）

> 只登记，不排期；进入 B/C 前重新走 SPEC/Plan 门禁。

- B01 区域框选、多选、组合标注。
- B02 截图作为用户附件（若 S2 未通过）。
- B03 原生嵌入模式（Vite/Next dev 插件）。
- B04 Electron adapter。
- B05 Tauri/WebView2 adapter。
- B06 断言、截图对比、workspace-changes diff 关联。
- B07 微信小程序 adapter。
- B08 原生 Windows（UIA + 截图 + 输入）。
- B09 Android（ADB/UIAutomator）。
- B10 WebSocket/SSE/GraphQL、Mock Server、测试导出/CI。
- B11 团队协作/共享集合/云同步。
- B12 独立 popout 窗口、远程预览。

---

## 任务统计与关键路径

| 阶段 | 任务数 | 说明 |
|---|---|---|
| M0 Spike | 5 | T001–T005 |
| M1 Foundation | 10 | T006–T015 |
| M2 Preview | 11 | T016–T026 |
| M3 Inspect | 8 | T027–T034 |
| M4 API | 12 | T035–T046 |
| M5 Agent | 8 | T047–T054 |
| M6 Hardening | 7 | T055–T061 |
| **合计** | **61** | 不含 B/C backlog |

**关键路径：**

```
T001–T004 → T005 → T006 → T007/T008/T009 → T010/T011/T012/T013/T014 → T015
→ T016/T017/T019/T020/T021/T022/T023/T024/T025 → T026
→ T027/T028/T029/T030/T031/T032/T033 → T034
→ T047/T048/T049/T050/T051/T052/T053 → T054
→ T055/T056/T057/T058/T059/T060 → T061
```

**可并行块：**

- T001–T004（四个 spike）。
- G1 后：M2（Preview）与 M4（API）两条线并行。
- T027–T029（拾取/源码）可在 S4 harness 上先行，不必等 M2 全部完成。
- T035–T037（HTTP/环境/存储）可并行；T041（OpenAPI spike）独立。
- T047（工具 schema）可在 contracts 稳定后先写。

---

## 评审点

1. **任务粒度**：61 个任务是否过粗/过细？特别看 T020（screencast+帧+canvas）、T039/T040（响应 UI）、T042（OpenAPI）、T048（三个工具）。
2. **依赖顺序**：M2 与 M4 并行、M3 提前在 S4 harness 上开发，是否认同？
3. **Gate 标准**：G0–G6 的验收是否够硬，能否作为继续/回退依据？
4. **P1 标记**：T045 断言标了 P1；还有哪些应该标 P1 或移出 MVP？
5. **文件路径**：目录骨架是否合理；有无遗漏的测试/fixture。

批准后进入 **Phase 4：实现**，从 T001 开始；每个任务完成即勾选并记录验证结果。

---

## 批准记录

- 2026-10-25：用户回复“批准”，接受 61 个任务、依赖顺序与 G0–G6 评审门禁。
- 执行规则：按任务顺序推进；发现计划假设不成立时先更新 `plan.md`/SPEC，再继续。
