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
- 界面与产品方向以 `docs/2026-10-28-界面与项目方向.md` 为准；**U01 必须先于 T027**，新增界面不得违反该文档第 1 节六条原则。

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

### - [x] T018 S8 进程生命周期 spike [P]

- **目标**：Vite 启动、端口探测、Windows 进程树清理、端口冲突。
- **验收**：启动 < 10 s；停止无孤儿；端口冲突有可读错误；报告结论。
- **验证**：`pnpm tsx spikes/s8/run.ts`；`spikes/s8/REPORT.md`。
- **文件**：`spikes/s8/{run.ts,REPORT.md}`。
- **验证结果（2026-10-27）**：`spikes/s8/run.ts` 用真实 Vite 8.3.5 + `fixtures/vite-basic`，逐场景测量启动、停止、孤儿与端口冲突；原始数据 `.tmp/logs/s8-results.json`。启动 9 次 spawn 的 HTTP 就绪 393–469 ms（中位 417 ms，预算 10 s），ready 日志 362–380 ms。停止：直接 `child.kill()` 14–15 ms、0 存活（Node 24 对非 detached 子进程使用 job object，`IsProcessInJob=true`，不依赖此行为）；`taskkill /T /F` 435–598 ms、3/3 无存活；`cmd.exe` 中转（`shell:true`）只杀 cmd 时 1 个 vite node 存活且仍占端口，按记录 PID 直接强杀后清零——证明必须记录 PID 并校验。端口冲突 exit 1、366–484 ms，stderr `Error: Port <port> is already in use`。结束时残留进程 0、监听端口 0。`pnpm exec tsc --noEmit` 0 error。报告给出 T019 的启动/就绪/停止/兜底/错误映射结论；`spikes/s8/` 仅 `run.ts` 与 `REPORT.md` 两个文件。

### - [x] T019 Dev server 进程监督

- **目标**：按 S8 结论实现 supervisor：spawn、日志 ring buffer、健康检查、停止、Windows tree kill。
- **验收**：启动/停止/重启；日志可见；无孤儿；单测用假进程。
- **验证**：`pnpm test -- tests/integration/supervisor` + 手动。
- **文件**：`src/host/targets/process/{supervisor,logs}.ts`、tests。
- **验证结果（2026-10-27）**：`src/host/targets/process/supervisor.ts` 实现可注入 spawn/HTTP 探测/进程列举/树杀/端口探测的 supervisor：严格校验 spec（绝对 command/cwd、端口范围、loopback 就绪 URL，非本地 `permission_denied`）、`shell:false` + `windowsHide:true` 启动、50–100 ms 轮询 HTTP 就绪（10 s 预算，超时 `timeout`）、端口冲突/提前退出映射 `preview_failed` + `reason:'port_in_use'|'exited'`、spawn 失败 `target_unavailable`、abort 可中断；启动结束清空上一轮日志，并发 start 合并，ready 幂等，失败可重试。停止记录后代 PID，Windows 用 `taskkill /PID /T /F`，等待退出后在 grace 后按 PID + 命令行精确匹配补杀，校验 survivors 与端口释放（5 s），端口仍占用记 `reason:'port_busy'`。启动失败且子进程已自行退出（如端口冲突）时跳过端口释放等待，避免误报与 5 s 延迟。`logs.ts` 提供 500 条 / 64 KiB / 单行 2000 字符的环形缓冲，按流拆分半行、去 ANSI、保留 seq 且支持 `after`/`limit` 增量读取。`tests/helpers/fake-dev-server.ts` 假进程 + `tests/integration/supervisor/{logs,supervisor}.test.ts` 覆盖生命周期、日志、超时/冲突/abort/spawn 失败、并发、重启、树杀、PID 复用保护、端口占用、非法配置与非本地 URL；全部用假进程，不启动真实长驻服务。验证：`pnpm exec vitest run tests/integration/supervisor` 2 文件 / 23 用例通过；全量 `pnpm exec vitest run` 24 文件 / 171 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 67.4 KiB / client 36.8 KiB。手动（`.tmp/t019-manual.ts`，真实 Vite 8.3.5 + `fixtures/vite-basic`，结果 `.tmp/logs/t019-manual.json`，`pass: true`）：启动 ready 532 ms、日志含 `Local:`/`ready at`；重启 run=2、新 PID、旧日志已清；停止 `portReleased:true`、`survivors:[]`、端口关闭、无残留 node.exe；端口冲突约 1.6 s 返回 `preview_failed`/`port_in_use`。进程查询需限定 `Name -eq "node.exe"`，否则执行查询的 PowerShell 自身会误匹配。

### - [x] T020 Screencast + 帧路由 + canvas

- **目标**：CDP `Page.startScreencast`；最新帧 + seq；用精确 `/api/vibe/stream`（multipart JPEG）为主通道，`/api/vibe/frame?wait=1&after=<seq>` 为回退；client canvas 渲染；断流后切 pull，恢复后切回 stream。
- **验收**：Web ≥ 10 fps；Desktop 手动通过；模拟断流可回退且无内存泄漏。
- **验证**：`pnpm test -- tests/integration/frames` + 手动 Web/Desktop。
- **文件**：`src/host/preview/{screencast,frame-buffer,route}.ts`、`src/client/preview/{Canvas.tsx,transport.ts}`、tests。
- **验证结果（2026-10-27）**：host 侧 `frame-buffer` 只保留最新 JPEG、seq 单调递增，waiter/subscriber 取消即清理；`screencast` 收到帧后立即 ack、base64 解码、4 MiB 上限 + SOI 校验、latest-wins，按绝对 deadline（10 ms 轮询、30 fps、quality 70）限速，停止时清空缓冲；`route` 提供 multipart `/api/vibe/stream`（`multipart/x-mixed-replace; boundary=vibe-frame`，部件带 `Content-Length` 与 `X-Vibe-Seq/Ts/Width/Height`，停止时发结束边界）与 `/api/vibe/frame?wait=1&after=<seq>`（200 JPEG / 204 超时 / 400 非法 / 503 未运行）。client `transport` 以 stream 为主，失败或结束切 pull（2 s 退避）并每 5 s 探测 stream，seq 去重保证切换不重复/不回退；`Canvas` 用 `createImageBitmap` + 单绘制循环合并最新帧，绘制后 `bitmap.close()`，画布尺寸取自帧元数据。`pnpm exec vitest run tests/integration/frames` 4 文件 / 28 用例通过；全量 `pnpm exec vitest run` 28 文件 / 199 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 88.2 KiB / client 58.1 KiB。手动 Web（`.tmp/t020-web.mjs`，DSH 4328 + 动态回环页，报告 `.tmp/logs/t020-web.json`，`ok:true`）：中止 `/api/vibe/stream` 后自动切轮询，25.3 fps、1280×720、12 色、首帧可见；解除后 5 s 内恢复流式，25.3 fps、13 色；25 s 浸泡 host RSS 最后 5 s 仅 +24 KB（25 s 稳态 +4.3 MB，浏览器堆 +190 KB），停止后目标 Edge PID 全部退出，真实 `desktop` profile SHA-256 前后一致。手动 Desktop（隔离 `DSH_HOME=.tmp/desktop-home` + 独立 userData，CDP 9223；`.tmp/t020-desktop.mjs`，`.tmp/logs/t020-desktop.json`，`ok:true`）：`dsh-app://app` 下 5 页签，流式 25.7 fps、25 s 共 1060 帧、画布 1280×720/13 色、渲染器堆 +49 KB、Electron 进程树 RSS 无增长，停止后 Edge 全退出、真实 profile 未改；console 仅预热 503 与预期中止。手测发现并修复 detached `window.fetch` 在 Chromium 抛 `Illegal invocation` 导致 Web 两条通道均无帧的问题（箭头函数保留全局接收者）。限制：Desktop 未单独模拟断流（回退由 Web 覆盖）；本轮未覆盖缩放/整页切换。

### - [x] T021 输入转发（点击/滚轮/键盘）

- **目标**：CDP `Input.*`；坐标映射；modifiers；点击/滚动/按键。
- **验收**：fixture 表单可点击/输入/滚动；焦点正确；延迟 < 200 ms。
- **验证**：`pnpm test -- tests/integration/input` + 手动。
- **文件**：`src/host/preview/input.ts`、`src/client/preview/InputLayer.tsx`、tests。
- **验证结果（2026-10-27）**：contracts 新增 `PreviewInputEvent` 与 `isPreviewInputEvent`（pointer/wheel/key；拒绝未知键、NaN/越界、非法 action/button、clickCount 1–3、|wheel|>2000、key 长度 0/32+、非法 code、text 1–32、非布尔 modifiers）。host `src/host/preview/input.ts` 懒建单一 CDP 会话、按实时 viewport 把 [0,1] 映射为 CSS px 并夹到 width−1/height−1、按钮集合与 `buttons` 位掩码（释放发 0）、modifiers 位掩码、命中键表（Enter/Tab/方向键/修饰键等）与 `text/unmodifiedText`、串行队列保证 press 先于 release；`stop()` 级联 detach 且幂等，错误统一 `target_unavailable`（`stopped`/`no_viewport`/`cdp_session`/`cdp_failed`）。输入复用 unary `preview.input`（`/api/vibe/request`），未新增路由；Web adapter 能力补 `input: true`；client `InputLayer` 为 canvas 上透明覆盖层，点击聚焦、best-effort pointer capture、非 passive wheel、IME 组合期按键忽略、move 30 ms 节流，`InputForwarder` 单飞行 + 合并 move + 队列上限 64，停止/卸载 `dispose`；`Canvas` 在 ready 时挂载并显示输入提示，en/zh-CN 文案补齐。`pnpm exec vitest run tests/integration/input tests/component/preview` 3 文件 / 23 用例通过；全量 `pnpm test` 31 文件 / 222 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 99.1 KiB / client 66.0 KiB。手动 Host（`.tmp/t021-host.mjs`，真实 Edge + Vite fixture，`.tmp/logs/t021-host.json`，`ok:true`）：点击后焦点 `INPUT#item-name`、键入 `hello`、计数器 `Count: 1`、滚轮 scrollY 0→347；15 次派发最大 26.3 ms / 平均 4.7 ms；停止后目标 Edge PID `[]`。手动 Web（`.tmp/t021-web.mjs`，DSH 4331 + 回环表单 beacon 页，`.tmp/logs/t021-web.json`，`ok:true`）：覆盖层与 canvas 同为 615×345.9 @ (809,234.2)，点击后覆盖层持有焦点，目标收到 focus 与 h/he/hel/hell/hello，click 计数 1，scrollY 500；18 个 `preview.input` 请求全部 HTTP 200，端到端最大 39.3 ms / 平均 13.1 ms；目标 Edge 全退、真实 `desktop` profile SHA-256 未变、无意外 console error。手动 Desktop（隔离 `DSH_HOME` + 独立 userData，CDP 9223，`.tmp/t021-desktop.mjs`，`.tmp/logs/t021-desktop.json`，`ok:true`）：覆盖层与 canvas 同为 543.3×305.6，焦点/输入/点击/滚动均达目标，18 个请求全部 200，最大 14.3 ms / 平均 9.4 ms；目标 Edge 全退、真实 profile 未改。限制：Desktop 自动化按 25 ms/字符合成键入时目标只收到首字符，150 ms/字符（接近人类速度）全部到达；Web 25 ms 与 host 直连连续按键均正常，判断为 Desktop 载体下 Edge 对过密合成键事件的合并/节流，留 T022 真 IME 手测复核。

### - [x] T022 中文输入

- **目标**：隐藏 textarea + `compositionstart/update/end` → `Input.insertText`；回退文案。
- **验收**：fixture 输入“你好，世界”正确；失败时有明确限制提示。
- **验证**：手动 fixture + `spikes/s3` 结论。
- **文件**：`src/client/preview/ImeInput.tsx`、`src/host/preview/input.ts`。
- **验证结果（2026-10-27）**：contracts 新增 `{kind:'text', text}` 与 `isInsertableText`（非空、≤1024 码点、拒绝孤立代理、只允许 kind/text 两键）；host 优先 `Input.insertText`，被拒时按码点 `dispatchKeyEvent` 回退（≤256 码点），两条路径都失败返回 `target_unavailable`/`insert_text_failed` 且错误不含原文。client 新增隐藏 textarea（1px、opacity 0、非 display:none、tabIndex −1），只在 `compositionend` 提交最终文本（emoji/代理对按码点计数），组合期间的按键与 `Process` 忽略；点击目标时把 textarea 移到点击点并聚焦；`Ctrl/Cmd+V` 不拦截以走 paste 回退；失活/停止/切换预览时清空值与组合状态；失败时显示 `role="status"` 限制提示（逐字输入或粘贴），不自动提交、不复述用户文本。`pnpm exec vitest run tests/integration/input tests/component/preview` 4 文件 / 39 用例通过；全量 `pnpm test` 32 文件 / 238 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 100.5 KiB / client 72.2 KiB。手动 Host（真实 Edge + Vite fixture，`.tmp/t022-host.mjs`，`.tmp/logs/t022-host.json`，`ok:true`）：点击后 `INPUT#item-name` 获得焦点，一次 text 事件后 value = `你好，世界`，3 次派发最大 8.6 ms / 平均 6.9 ms，停止后 Edge 全部退出。手动 Web（DSH 4332 + 回环表单，CDP `Input.imeSetComposition`→`Input.insertText` 驱动真实 Chromium IME 管线，`.tmp/t022-web.mjs`，`.tmp/logs/t022-web.json`，`ok:true`）：点击后活动元素为隐藏 TEXTAREA；组合中间态（`nihao`/候选）未产生 text 请求、也未触达目标；提交后仅 1 个 `{kind:'text',text:'你好，世界'}`，目标收到完整值，textarea 清空，无部分/中间值；强制 `/api/vibe/request` 的 text 请求 500 后目标值不变且出现中文限制提示（`role=status`，无 alert），解除后重试恢复；粘贴事件被 textarea 接管并整段送达；请求状态含 200/500，最大 15.7 ms / 平均 8.1 ms；目标 Edge 全退、真实 `desktop` profile SHA-256 未变、无意外 console error。手动 Desktop（隔离 `DSH_HOME` + 独立 userData，CDP 9223，`.tmp/t022-desktop.mjs`，`.tmp/logs/t022-desktop.json`，`ok:true`）：同样流程通过（提交值、单次请求、失败提示、恢复、粘贴），200 请求最大 59.6 ms / 平均 16.7 ms，失败注入通过渲染进程 fetch 包装完成（`dsh-app://` 无法被 Playwright route 拦截），未改产品代码；目标 Edge 全退、真实 profile 未改。限制：自动化以 CDP 模拟 IME 组合，不能替代 Microsoft Pinyin 系统级真手测；仍建议在 `vibe-dev` Web 与隔离 Desktop 手测组合中途候选、上屏、emoji、超长输入与切换预览。

### - [x] T023 Console 采集与抽屉

- **目标**：CDP `Runtime.consoleAPICalled`/`exceptionThrown`；ring buffer；UI 过滤/清空。
- **验收**：错误/警告可见；上限生效；清空可用。
- **验证**：integration + component test。
- **文件**：`src/host/preview/console.ts`、`src/client/preview/ConsoleDrawer.tsx`、tests。

- **验证结果（2026-10-28）**：contracts 新增 `preview.console.list` / `preview.console.clear` 两个一元方法（`after`/`limit` 严格校验，`MAX_CONSOLE_ENTRIES=500`、单条文本 500 字节），不新增全局路由；host 新增 `src/host/preview/console.ts`：独立 CDP 会话在 `Runtime.enable` 前挂 `Runtime.consoleAPICalled` / `Runtime.exceptionThrown`，按 info/debug/warn/error 分级，异常合并 `description`，来源先 `redactUrl` 再截 512 字节且行号 +1；页面文本先去 ANSI/控制字符并归一 CRLF，再按 UTF-8 截断；ring buffer 500 条 / 64 KiB，超出淘汰最旧并累计 `dropped`，`seq` 跨 clear 单调；`stop()` 移除监听（`off` 可选）、detach 且清空缓冲；采集失败不阻断预览，只把快照能力降为 `console:false`。route 在 `release()` 中先停采集器再停输入/adapter；`consoleList` 未运行 `target_unavailable`、能力缺失 `unsupported`、非法 query `invalid_input`。client 新增 `ConsoleDrawer`：1 s 轮询 `after` 增量、按 id 去重、本地 500 上限、Host `lastSeq` 回退时全量重取、`clearEpoch` 防在途响应回填、all/error/warn/info 过滤、清空同时清 Host 与本地、失败 `role="status"`、来源按纯文本渲染；仅当快照 `capabilities.console` 为 true 时挂到 Canvas；en/zh-CN 文案补齐。`pnpm exec vitest run tests/integration/console tests/component/preview/console-drawer.test.tsx` 3 文件 / 22 用例通过；全量 `pnpm test` 35 文件 / 260 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 116.1 KiB / client 83.4 KiB。手动 Host（真实 Edge + Vite fixture，`.tmp/t023-host.mjs`，`.tmp/logs/t023-host.json`，`ok:true`）：info/warn/error 与异步 throw 均入缓冲（异常文本含 `boom-exception`），Vite/React DevTools 既有日志也正常采集；510 条 `console.log` 后缓冲恰为 500 条、`lastSeq=517`、`dropped=17`、首条 `bulk-10`；clear 返回 `{cleared:500,lastSeq:517}`，快照为空且 seq 不变，随后 `console.error('after-clear')` 得到唯一 `console-518`；停止后目标 Edge 全退。限制：T023 只要求 integration + component，未做 Web/隔离 Desktop 载体手测；异常 `description` 可能自带堆栈，已受单条文本上限约束。
### - [x] T024 Network 采集与抽屉

- **目标**：CDP Network 事件；请求/响应摘要；body 按需；上限与脱敏；UI。
- **验收**：method/url/status/time 可见；4xx/5xx 标记；敏感 header 脱敏。
- **验证**：integration + component test。
- **文件**：`src/host/preview/network.ts`、`src/client/preview/NetworkDrawer.tsx`、tests。

- **验证结果（2026-10-28）**：contracts 新增 `preview.network.list` / `preview.network.clear` / `preview.network.body` 三个一元方法（`after`/`limit` 严格校验，`MAX_NETWORK_ENTRIES=300`、`MAX_NETWORK_BODY_BYTES=64 KiB`），不新增全局路由。host 新增 `src/host/preview/network.ts`：独立 CDP 会话先挂 `requestWillBeSent`/`responseReceived`/`loadingFinished`/`loadingFailed` 再 `Network.enable`（总缓冲 20 MiB、单资源 5 MiB）；请求/响应按 `requestId` 合并，4xx/5xx 记 `error`，`loadingFailed` 的 `canceled` 记 `aborted`；header 上限 64 条、单值 512 字节并先 `redactHeaders`，URL 先 `redactUrl` 再截 512 字节，非 http(s) 请求拒绝；ring buffer 300 条 / 256 KiB，淘汰最旧并累计 `dropped`；采用 revision 游标，pending 行更新后会再次下发，client 按 id 原位替换；`seq` 跨 clear 单调；body 仅按需 `Network.getResponseBody`，文本按 UTF-8 截断（下限 64 字节）、base64 解码后按字节截断，body 不脱敏只截断，失败映射 `not_found`；`stop()` 移除监听、detach 并清空缓冲。route 在 `release()` 中按 console → network → input → adapter 顺序清理；`networkList` 未运行 `target_unavailable`、能力缺失 `unsupported`、非法 query/params `invalid_input`。client 新增 `NetworkDrawer`：500 ms 轮询 revision 增量、按 id 合并、pending→completed 原位更新、`clearEpoch` 防在途响应回填、All/Failed 过滤、4xx/5xx 红色与 `data-error` 标记、清空同时清 Host 与本地、展开时按需取 body 并缓存、header/body 按纯文本渲染、失败 `role="status"`；仅当快照 `capabilities.network` 为 true 时挂到 Canvas；en/zh-CN 文案补齐。聚焦 `pnpm exec vitest run tests/integration/network tests/component/preview/network-drawer.test.tsx` 3 文件 / 27 用例通过；全量 `pnpm test` 38 文件 / 287 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 134.2 KiB / client 102.1 KiB。限制：T024 只要求 integration + component，未做真实 Edge 手测，抽屉在真实载体的布局/轮询开销留 T025/G2；未采集 POST body/WebSocket/SSE 事件。

### - [x] T025 预览工具栏与生命周期

- **目标**：工具栏（目标/URL/刷新/视口/外部打开）；浏览器崩溃/断线提示；关 tab/停目标清理。
- **验收**：操作可用；崩溃可重启；5 s 内进程退出；无孤儿。
- **验证**：手动矩阵 + integration。
- **文件**：`src/client/preview/Toolbar.tsx`、`src/host/preview/session.ts`、tests。

- **验证结果（2026-10-28）**：contracts 新增 `preview.session.navigate` / `preview.session.reload` / `preview.session.viewport` / `preview.targets` 四个一元方法，`PreviewSessionSnapshot` 增加 `kind`，`PreviewStartParams` 支持可选 `kind`，并新增严格参数校验（URL 1..2048 去空白、viewport 有限数值、target 仅 `{id,kind}`）；不新增全局路由。host 把会话服务迁到 `src/host/preview/session.ts`（`route.ts` 仅保留 stream/frame 路由与 re-export）：`snapshot()`、stream 与 `start()` 都会调用 `checkHealth()`，adapter `isAlive()` 为 false 时置 `failed` + `target_unavailable`，只提示不自动重连；重启先 `release()` 旧句柄再取新句柄；reload 无 adapter 实现时回退 `navigate(url)`；`setViewport` 复用目标配置校验（占位 URL），保留 `deviceScaleFactor`，越界 `invalid_input`；`listTargets` 仅暴露 `{id,kind}`。Web adapter 增加 `reload`/`setViewport`/`isAlive`（`ready && browser.isConnected() && !page.isClosed()`），registry 的必选方法校验扩展。client 新增 `Toolbar`（目标下拉、URL 表单、刷新/前往、视口 64–7680 应用、外部打开仅 loopback、状态行、崩溃提示 + Restart/Stop）与 `local-url` 校验；Canvas 1 s 轮询状态、500 ms 帧统计、动作 busy/错误包装、重启复用 start；`lifecycle` 用模块级 active 标记区分内部 tab 切换与面板关闭，只有 shell 卸载才调用 stop（15 s 超时），失败不复活标记。聚焦 `pnpm exec vitest run tests/integration/preview/session-lifecycle.test.ts tests/component/preview/toolbar.test.tsx tests/unit/preview/lifecycle.test.ts` 3 文件 / 14 用例通过；全量 `pnpm test` 41 文件 / 301 用例通过；`pnpm typecheck` 0 error；`pnpm build` host 140.5 KiB / client 115.1 KiB。手动矩阵：Host 真 Edge（`.tmp/t025-host.mjs`，`.tmp/logs/t025-host.json` ok）navigate/reload/viewport 生效，崩溃 101 ms 检出且 1.5 s 后仍 `failed`、Edge 进程 0，重启为新会话，stop 调用 301 ms、进程 4471 ms 内退出、无孤儿；隔离 Desktop（`.tmp/t025-desktop.mjs`，`.tmp/logs/t025-desktop.json` ok，中文载体）工具栏刷新/视口 900×700/导航均生效，Console 与 Network 抽屉在真实载体有数据，杀 Edge 后出现断开提示且不自动重启，Restart 恢复，内部切到“检查”再回“预览”会话保留且无重载，停止后 3820 ms 内 Edge 全退、无孤儿，真实 desktop profile 哈希前后一致。限制：崩溃后不会自动恢复；改 DPR 需重启会话；Desktop 的 `window.open` 返回 null 属正常拦截路径；未在真实载体验证“关闭整个 DSH 面板”触发的 stop（由 lifecycle 单测覆盖）。

### - [x] T026 G2 Preview 评审 [GATE]

- **目标**：验证预览闭环与性能。
- **验收**：10 fps；点击/输入/滚动；Console/Network；停止清理；SPEC 相关条目通过。
- **验证**：手动 + `pnpm test`；记录到 `tasks/todo.md`。
- **文件**：无。

- **验证结果（2026-10-28）**：**G2 通过（GO）**，未改产品代码。基线 `pnpm typecheck` 0 error、`pnpm test` 41 文件 / 301 用例通过、`pnpm build` host 140.5 KiB / client 115.1 KiB。手动矩阵三端均先经工具栏设 1280×800（SPEC FR-PRE-04 口径）：**Host 真 Edge**（`.tmp/t026-host.mjs`，`.tmp/logs/t026-host.json`，`ok:true`）带全页 CSS 动画持续 10 s 得 258–259 帧 / 25.8–25.9 fps（p50 间隔 41–42 ms、p95 49–50 ms）；点击 `#item-name` 聚焦、键入 `hello`、计数器 0→1、滚轮 scrollY 0→267；点击到首帧 49–54 ms、输入 ack 1–2 ms；Console 采集到 log/warn/error/异步 throw（`g2-async-boom`），Network 采集 200 与连接失败（`outcome=error`），`network.body` 602 字节；停止调用 354–377 ms、Edge 1357 ms 内全退、无孤儿。**Web**（`.tmp/t026-web.mjs`，`.tmp/logs/t026-web.json`，`ok:true`）`vibe-dev` + headless Edge 面板，流式模式 10 s 244 帧 / 24.4 fps；聚焦/键入 `hello`/点击计数 1/滚轮 500 均生效；Console 16 条、Network 39 条；停止后 2940 ms Edge 全退、无孤儿。**隔离 Desktop**（`.tmp/t026-desktop.mjs`，`.tmp/logs/t026-desktop.json`，`ok:true`，CDP 9225）流式 10 s 250 帧 / 25.0 fps；聚焦/键入/点击/滚动均生效；Console 32 条、Network 71 条；停止后 4886 ms Edge 全退、无孤儿，真实 `desktop` profile 哈希前后一致。**SPEC 相关条目**：FR-PRE-01/03/06/07/10 由 T025 手动矩阵与 shell 用例覆盖（切 tab 会话保留、重启、视口、外部打开按钮可用、崩溃提示），FR-PRE-02/05/08 本次三端实测，FR-PRE-04 本次实测 ≥10 fps；FR-PRE-09（多目标独立会话）当前仅注册 web 目标，未验证，属 SHOULD，留到多目标任务。输入反馈 <200 ms：Host 点击到首帧 49–54 ms，Web/Desktop 沿用 T021/T022 的请求延迟（最大 39.3/59.6 ms）加 ~40 ms 帧间隔。限制：Desktop 预览 Edge 在后台被遮挡时 rAF 计时器会被 Chromium 节流，测量前脚本用 `SetForegroundWindow` 拉起预览窗口；停止清理 Desktop 4886 ms 接近 5 s 上限；未验证真实“关闭整个 DSH 面板”的 stop（仅 lifecycle 单测）。

---

## M2.5：UI Layout v2（T027 前置）

> 依赖：G2。**阻塞 T027**：T027 的 overlay 需要基于定稿后的画布几何取坐标。范围只限预览页排版与引导文案，不新增功能。
> 依据：`docs/2026-10-28-界面与项目方向.md` 第 2 节；用户《M1界面修改意见》。

### - [x] U01 预览界面精简（Layout v2）

- **目标**：画布优先。状态压成单行；视口等参数移入设置页或“更多”菜单；Console/Network 改为底部常驻 tab + 覆盖式抽屉；补空状态/失败态引导。
- **验收**：
  - 右栏宽 320/400/500px、窗口高 900px：无横向溢出，画布高度 ≥ 面板 60%。
  - 常驻行 ≤ 3（状态条、地址行、底部 tab）；视口宽高输入不再常驻预览页。
  - 抽屉开合不改变画布尺寸；点击/键入/滚动仍正常。
  - 帧率约 25 fps 不下降；浏览器 console 0 error。
  - 手动回归 P1–P5、V1–V6、I1–I8、C1–C5、N1–N6、L1–L7、S1–S7（编号见 `docs/2026-10-28-手动测试手册.md`）。
- **验证**：`pnpm typecheck`、`pnpm test`、`pnpm build`；`vibe-dev` + headless Edge 在 320/400/500px 三档各截图 + 断言；组件测试更新。
- **文件**：`src/client/preview/{Canvas,Toolbar,PreviewTabs,ConsoleDrawer,NetworkDrawer}.tsx`、`src/client/shell/StudioShell.tsx`、`src/client/shell/settings/{SettingsPage,PreviewSettings}.tsx`、`src/client/locales/*.json`、tests（实现无 CSS 文件，全部内联样式）。
- **验证结果（2026-10-28）**：
  - 静态检查：`pnpm typecheck` 0 error；`pnpm test` 43 文件 / 319 用例通过（新增 `preview-tabs.test.tsx`、`preview-settings.test.tsx`，重写 toolbar/console/network/studio-shell 用例）；`pnpm build` host 140.5 KiB / client 140.9 KiB。
  - 真实载体（`.tmp/u01-verify.mjs` → `.tmp/logs/u01-verify.json`，`vibe-dev` + headless Edge 1440×900，右栏强制 320/400/500px，`ok:true`）：三档面板宽均无横向溢出（document/预览根/状态行/地址行 scrollWidth == clientWidth，预览根 scrollHeight == clientHeight）；舞台（画布区域）高 657.6px = 面板 768.6px 的 **85.6% ≥ 60%**，实际位图按 16:9 居中letterbox（320px 宽时位图 304×171 = 22.2%，受几何限制，非布局问题）；常驻行恰 3（工具条/舞台/tab），视口宽高输入 0；抽屉开/关（Console→Network→关）canvas 恒为 304×171；fps 264 帧 / 10.1 s = **26.2 fps**（状态条运行中 · 30 fps 为目标值），≥ 20；点击/键入 `hello`/滚轮 500px 均经 InputLayer 生效；Console 18 条、Network 46 条，tab 标签 `控制台 (17)` / `网络 (42)`；失败态（不可达 4399）显示 3 条检查项 + 重启按钮，重启到良好地址成功；停止后 3086 ms 内 9 个目标 Edge 进程全退、无孤儿、状态回空闲。
  - console：正常流程 0 error；唯一一条 503 是**故意**启动不可达目标时 `preview.session.start` 的设计性错误响应（浏览器对任何 5xx 都会记录），非缺陷。首轮发现并已修复：`/api/vibe/request` 返回 501 `unsupported` 两次（Console/Network 抽屉在 Stop 过程中仍轮询已释放句柄的会话）——`Canvas` 现在在 `busy === 'stop'` 时立即停用抽屉并关闭已开抽屉，末轮 501 = 0。
  - 截图：`.tmp/logs/u01-{320,400,500}.png`、`u01-failure.png`、`u01-stopped.png`。
  - 限制：真实系统中文 IME、外部浏览器打开跳转、以及 P/V/I/C/N/L/S 全量手测矩阵未自动化（本轮覆盖 P1–P5/V1–V6/I1–I8/C1–C5/N1–N6 的脚本等价项，L/S 类（切 tab、关闭面板）沿用 T025 手测与 lifecycle 单测结论）；失败态测试必然产生 1 条 503 日志。

---

## M3：Inspect + Annotation

> 依赖：G2 + **U01**（画布几何定稿，T027 overlay 依赖它）。T028 可在 U01 后与 T027 并行。T030 依赖 T009；T031 依赖 T010/T030；T032 依赖 T031；T033 依赖 T030。

### - [x] T027 拾取 overlay 与选择器

- **目标**：注入脚本、Shadow DOM overlay、hover/click、`Esc`、`Alt+Click`；选择器生成。
- **验收**：不触发页面原点击；选择器唯一或标注“非唯一”；10 个元素抽测通过。
- **验证**：复用 S4 harness + integration。
- **文件**：`src/host/inspect/{inject.ts,selector.ts}`、`src/client/inspect/Picker.tsx`、tests。
- **验证结果（2026-10-28）**：
  - 静态检查：`pnpm typecheck` 0 error；`pnpm test` 49 文件 / 363 用例通过（新增 `unit/preview/picker.test.ts`、`component/inspect/{selector,page-script,picker-ui}.test.ts*`、`integration/preview/{picker-service,picker-edge}.test.ts`，toolbar 用例补 2 条）；`pnpm build` host 159.6 KiB / client 149.1 KiB。完整日志 `.tmp/logs/t027-full.log`、`.tmp/logs/t027-build.log`。
  - 真实 Edge（`tests/integration/preview/picker-edge.test.ts`，Vite fixture 临时端口 + 900×700）：10 种形状全部通过——`data-testid`、唯一 `id`、`aria-label`、`name`、语义 class、`#pick-panel > ul > li:nth-of-type(2)`、重复 class、生成式 `css-1x2y3z`、开放 Shadow DOM `#inner`、深层 `div:nth-of-type(2) > span`；每次 hover 均画出 overlay，点击后 `element.getRootNode().querySelector(selector) === element` 为 true，box 与元素 rect 一致，`unique` 均为 true。
  - 不触发页面原点击：10 次拾取期间页面自身 `click`/`pointerdown` 计数均为 0；关闭模式下的普通点击泄漏 `click:1` 且不计为拾取；`Alt+Click` 在关闭状态下仍拾取 `#email` 并吞掉事件；`Esc` 上报 cancel、移除 overlay、保留上一次拾取；teardown 后 overlay 移除、无 Edge 进程残留。
  - 机制：CDP `Runtime.enable → Runtime.addBinding → Page.addScriptToEvaluateOnNewDocument → Runtime.evaluate`；选择器函数随脚本序列化（模块常量已移入函数体，避免页面内 free variable），`buildPickerScript` 拒绝 esbuild `keepNames` 泄漏；open Shadow DOM overlay（`all: initial`、z-index 2147483647、`pointer-events:none`）、仅顶层帧安装、`pointermove` 穿透 open shadow 命中、捕获阶段吞掉 press/click、重复安装替换旧实例。
  - 降级与生命周期：脚本被页面拒绝时 `capabilities.pick=false` 且预览不失败；navigate/reload 重置 active；释放会话时先 dispose picker 再停 adapter（单测覆盖命令顺序与幂等）。
  - 客户端：工具栏 `⌖` 开关（仅 ready 且 `capabilities.pick` 时可用）、拾取中顶栏提示 + 画布 crosshair、拾取卡片（selector 可整段选中复制、唯一/非唯一徽标、tag/classes/box、可收起）；轮询 active 300 ms / idle 1000 ms；Esc 由页面上报后 UI 自动同步。
  - 限制：拾取卡片只做组件测试（T027 验证要求为 S4 harness + integration），未做 `vibe-dev` 截图；`text/html/role/source` 仍为空占位，由 T028/T029 填充。

### - [x] T028 元素上下文提取

- **目标**：DOM 片段、文本、role/name、box、可见性；深度/长度上限。
- **验收**：DOM ≤ 2 KB；文本 ≤ 200 字；box/role 正确；单测通过。
- **验证**：`pnpm test -- tests/unit/inspect-context`。
- **文件**：`src/host/inspect/{dom,accessibility}.ts`、tests。
- **验证结果（2026-10-28）**：
  - 静态检查：`pnpm typecheck` 0 error；`pnpm test` 51 文件 / 384 用例通过（新增 `tests/unit/inspect-context/{dom,accessibility}.test.ts` 2 文件 / 20 用例；`unit/preview/picker.test.ts` 补 T028 字段解析与上限断言；`component/inspect/page-script.test.ts` 更新 payload）；`pnpm build` host 172.8 KiB / client 149.1 KiB。日志 `.tmp/logs/t028-{typecheck,full,build}.log`。
  - 页面侧：`src/host/inspect/dom.ts` 的 `extractDomContext()` 克隆节点、去掉 `script/style/template/noscript`、深度 ≤ 6、元素节点 ≤ 200，`outerHTML` 空白归一后按 UTF-8 截到 2048 B（连同 `…` 计入预算，半截标签回退到最后一个完整标签）；文本取 `innerText`（缺失时用去脚本克隆的 `textContent`），空白折叠后截到 200 码点（含 `…`）；可见性 = 已连接、无 `hidden`、rect 宽高 > 0、`display/visibility/opacity` 非隐藏、`checkVisibility({checkOpacity,checkVisibilityCSS})` 不否决。
  - 无障碍：`src/host/inspect/accessibility.ts` 的 `describeAccessibility(element, roles)` 先按 `aria-labelledby → aria-label → 原生（alt/value/label/legend/caption/figcaption）→ title → placeholder → 文本内容` 计算名称（landmark 不用文本内容），再取显式 `role`（白名单 `ARIA_ROLES`，非法 token 丢弃）或原生映射（button/a/input 分类型/select/textarea/h1–h6/img/nav/main/aside/form/section/table/tr/td/li 等）；名称截 200 码点。
  - 信任边界：页面回传的 `html/text/role/name/visible` 在 `normalizePickedElement()` 里经 `normalizeDomSnippet`（≤ 2 KB UTF-8，去控制字符）、`normalizeElementText`（≤ 200 码点）、`normalizeRole`（单 token + ARIA 白名单）、`normalizeAccessibleName`、`normalizeVisibility`（仅字面 `true`）重新校验；`ElementContext` 新增 `name` 与 `visible` 并更新 `isElementContext`，注解文本同步输出 `name`/`visible`。
  - 注入复用：`buildPickerScript()` 组合 `buildSelector` + `extractDomContext` + `describeAccessibility` + `installVibePicker`，角色白名单以 JSON 参数传入页面（避免序列化函数引用模块常量），仍拒绝 esbuild `keepNames` 泄漏；提取异常只让该字段留空，不影响拾取。
  - 真实 Edge（`tests/integration/preview/picker-edge.test.ts`）10 种元素：role/name/text/visible 全部符合预期（button/input/li/span、aria-label、Shadow DOM 内按钮、nth-of-type 路径），html 非空且 ≤ 2048 B，box 仍与元素 rect 一致。
  - 限制：无障碍名称是近似实现（非完整 accessibility tree），`aria-owns`/`aria-describedby` 与嵌套 landmark 特例未覆盖；拾取卡片尚未展示 text/role（T029/T030 使用这些字段）。

### - [x] T029 源码适配（React/Vue/Svelte）

- **目标**：React fiber、Vue `__file`、Svelte `__svelte_meta`；不可用回退。
- **验收**：30 个元素 ≥ 80%；生产态/无 source 时不报错；回退明确。
- **验证**：三 fixture + `pnpm test -- tests/e2e/source-adapters`。
- **文件**：`src/host/inspect/source/{react,vue,svelte,index}.ts`、tests。
- **验证结果（2026-10-28）**：
  - 静态检查：`pnpm typecheck` 0 error；`pnpm test` 52 文件 / 404 用例通过（新增 `tests/unit/inspect-context/source.test.ts` 17 用例；`component/inspect/page-script.test.ts` payload 补 `source` 并新增页面内适配器断言；`component/inspect/picker-ui.test.tsx` 新增 PickCard 源码行；`unit/preview/picker.test.ts` 补脚本组合断言）；`pnpm build` host 181.0 KiB / client 150.0 KiB。日志 `.tmp/logs/t029-{vitest-3,build,e2e-2}.log`。
  - E2E：`pnpm test:e2e` 9 用例通过（fixture 3 + 新增 `tests/e2e/source-adapters.spec.ts` 6）。三 fixture `fixtures/source/{react,vue,svelte}` 各 30 个 `id` 元素，dev 下 30/30 命中（框架 + 文件 basename + 行号 ±2，实际 0 miss，高于 80% 门槛），控制台/页面错误为 0；每个框架另用真实鼠标点击 `#title` 复核与合成点击一致。
  - 适配器与回退：`react.ts` 先读 `@react-dev-inspector/babel-plugin` 注入的 `data-inspector-relative-path/-line/-column`（React 19 无 `_debugSource`），再走 React 18 dev fiber `_debugSource`，否则 `null`；`vue.ts` 先读 vnode 隐藏 prop `__v_inspector` 与 `__vue_inspector_store__.vnodeToPos`，再读遗留 `data-v-inspector`，最后组件 `__file`（仅文件、无行号），否则 `null`；`svelte.ts` 从元素向上 ≤ 64 层读 `__svelte_meta.loc`，否则 `null`。每个适配器全程 `try/catch`，页面对象被改写只会退化为 `null`，不影响拾取。
  - 生产回退：三个 fixture 用 Vite `build()` + `preview()`（输出 `.tmp/source-adapters/<框架>`）跑同一拾取脚本，30/30 拾取仍成功且 `source === null`，无控制台/页面错误——无 source 不是错误，UI 显示“无源码信息”。测试内显式固定 `process.env.NODE_ENV`，否则先启动的 dev server 会把后续 build 的 Vue/Svelte 插件留在 dev 模式而误带 `__file`/`__svelte_meta`。
  - 信任边界：页面回传的 `source` 经 `normalizeSourceContext()`（`src/host/inspect/source/index.ts`）重新校验：框架白名单、文件去控制字符/折叠空白/截 512 码点、`via` 限 `SOURCE_VIAS` 风格 token、行列为 0–1,000,000 的整数，越界置 `null`；未知字段丢弃。
  - 注入复用与依赖：仍由 `buildPickerScript()` 用 `toString()` 组合 `reactSource/vueSource/svelteSource` 并作为第 5 个参数传给 `installVibePicker`，未改 T027/T028 结构；未新增依赖（`@react-dev-inspector/babel-plugin`、`vite-plugin-vue-inspector`、`@sveltejs/vite-plugin-svelte` 均已在 devDependencies）。
  - 限制：React 19 需在目标项目 dev 构建里启用 inspector babel 插件才有一级路径；Vue `__file` 回退只有文件没有行号（不计命中）；Svelte 4 的 `add_location` 与生产态均无行号；`spikes/s4/REPORT.md` 的结论仍适用于手写 fixture，真实项目插件的版本差异需在 G3 复核。

### - [x] T030 标注模型、存储与文本渲染

- **目标**：`Annotation` schema、序列化、文本渲染、预算、`.vibe/annotations` 存储。
- **验收**：round-trip；≤ 4 KB；不可信包裹；坏数据回退。
- **验证**：`pnpm test -- tests/unit/annotation`。
- **文件**：`src/contracts/annotation/*`、`src/host/inspect/annotation-store.ts`、tests。
- **验证结果（2026-10-28）**：
  - 模型与渲染：`src/contracts/annotation.ts`（T009 已建）提供 `Annotation`/`isAnnotation`/`serializeAnnotation`/`deserializeAnnotation`/`renderAnnotationText`；本次新增并导出 `isAnnotationId`（id 直接用作 `.vibe/annotations/<id>.json` 文件名，正则禁止路径分隔符与前导点），`isAnnotation` 复用它。
  - 存储：新增 `src/host/inspect/annotation-store.ts`。`save()` 先 `isAnnotation` 校验、序列化后按 UTF-8 字节限 64 KiB，再在 `.vibe/annotations` 同目录写 `wx` 临时文件并 `rename` 原子替换；`read()` 对缺失、损坏 JSON、形状不合法、超过 64 KiB、symlink 或解析到目录外的文件一律返回 `null`；`list()` 只认 `<合法 id>.json`、跳过坏文件、按 `createdAt` 倒序（同时间按 id）；`remove()` 返回是否真的删除；`.vibe` 或 `.vibe/annotations` 为越界 junction/symlink 时抛 `path_outside_project`。`src/host/index.ts` 导出 store 与常量。
  - 验收对应：`tests/unit/annotation/annotation-store.test.ts`（10 用例）覆盖 save→read→render 往返、渲染结果 ≤ `ANNOTATION_BUDGET_BYTES`（4 KB）且 `<untrusted-page-content>` 边界在磁盘往返后仍只出现一次、损坏/形状非法/超大文件回退为 `null` 且 `list` 跳过、非法与超限存储被拒且不落盘、非法 id 不触达文件系统、删除与空历史、`.vibe` junction 越界拒绝；原有 `tests/unit/contracts/annotation.test.ts` 9 用例继续通过。
  - 静态检查与构建：`pnpm typecheck` 0 error；`pnpm test` 53 文件 / 414 用例；`pnpm build` host 192.8 KiB / client 150.0 KiB。日志 `.tmp/logs/t030-{typecheck,test,build}.log`。
  - 限制：store 尚未接入 host 服务/agent 工具（T031 用模型、T033 做历史列表与搜索）；未替目标项目写 `.vibe/annotations` 的 gitignore；同一 id 并发保存以最后完成的 `rename` 为准，无文件锁；未做跨进程历史大小/保留期清理（`retentionDays` 属 T033/G3）。

### - [x] T031 标注气泡与队列

- **目标**：元素旁气泡、侧栏队列、编辑/取消/发送；空状态。
- **验收**：拾取 → 写意见 → 放入对话 ≤ 3 步；组件测试通过。
- **验证**：`pnpm test -- tests/component/annotation` + 手动。
- **文件**：`src/client/inspect/{AnnotationBubble,AnnotationQueue}.tsx`、tests。
- **验证结果（2026-10-28）**：
  - 气泡：`src/client/inspect/AnnotationBubble.tsx` 导出纯函数 `placeBubble`（把元素 `box` 按 `frame/viewport` 缩放后放在元素下方，越界右移夹紧、下方不足时翻到上方，帧小于气泡时贴边钳制，零视口按 1 px 防除零）与 `AnnotationBubble`（`role=group`、代码头 `tag.classes`、`autoFocus`、2 000 字符上限、空意见拒绝并以 `role=status` 说明、`Ctrl/Cmd+Enter` 保存、`Esc` 取消）。
  - 队列：`src/client/inspect/AnnotationQueue.tsx` 提供模块级 store（`useSyncExternalStore`：`addAnnotationToQueue`/`updateQueuedAnnotation`/`removeQueuedAnnotation`/`clearAnnotationQueue`/`annotationQueueSnapshot`，快照在下次变更前保持同一引用）、`createElementAnnotation`（复用 T030 `Annotation` 与 `asTargetId`）、`renderAnnotationText` 发送文本；列表最新在前，显示选择器、时间、源码末段行、意见，动作“发送到对话/编辑/移除”，编辑支持保存/取消与空值提示；空态复用 shell `EmptyState`。
  - 发送：注入式 `AnnotationSender`，默认 `copyAnnotationToClipboard(renderAnnotationText(...))`（S2 回退）；**只在点击时发送**，成功后移除草稿并显示发送器返回消息或默认文案，失败保留草稿并 `role=alert`；发送中禁用该条动作。未接 composer，T032 再替换发送器。
  - 接线：`Canvas.tsx` 在拾取后按舞台框计算 `placeBubble` 并把保存结果入队，同时显示“已加入队列 / 查看队列”提示；`StudioShell.tsx` 的标注页签渲染队列，并在有草稿时给 tab 加数量徽标（`aria-hidden`，不改变可访问名）。两语各 +20 key，key 集合 160/160 一致。
  - 验收对应：`tests/component/annotation/annotation-bubble.test.tsx`（11）、`annotation-queue.test.tsx`（19）、`annotation-shell.test.tsx`（2），覆盖定位/空意见/Ctrl+Enter/Esc、增删改与通知、无自动发送、发送成功/失败/剪贴板回退/发送中禁用、跨重挂载保留、壳层徽标与列表、中文文案。
  - 静态检查与构建：`pnpm typecheck` 0 error；`pnpm test` 56 文件 / 446 用例；`pnpm build` host 192.8 KiB / client 179.4 KiB。日志 `.tmp/logs/t031-{typecheck,test,build}.log`。
  - 限制：队列只在面板会话内存中，重开 DSH 面板即清空（持久化/历史属 T033）；未做 `vibe-dev` + headless Edge 的真实气泡定位截图，3 步闭环的真机证据留 G3/T034；尚未接 composer，发送目前落到剪贴板；气泡位置在视口变化后不重算（拾取时一次计算），滚动页面时元素框仍是拾取瞬间的值。

### - [x] T032 Composer handoff

- **目标**：按 S2 结论走公开 API 插入草稿；不自动发送；截图/剪贴板回退。
- **验收**：文本 100% 成功；不自动提交；附件路径或剪贴板回退可用；切会话不串。
- **验证**：手动 Web/Desktop + integration。
- **文件**：`src/client/inspect/handoff.ts`、`src/client/inspect/handoff.test.ts`。
- **验证结果（2026-10-28）**：
  - 桥接：`src/client/inspect/handoff.ts` 用 `conversation.input.left` 的作用域 slot（id + order + `inject: (sessionId) => ({ sessionId })`）取公开 `inputActions`；模块级 `Map<sessionId, attachment>` + `activeSessionId`，只在快照变化时通知；`ComposerHandoffSlot` 为 null 渲染，只 attach/detach 并用 `useInput` 镜像草稿/阶段，不写输入。
  - 插入：`handoffAnnotationText` 优先 `captureInsertion()` + `insertText(text, span)`（用户已有草稿时前置 `\n\n`），`insertText` 明确返回 `false` 时才 `setDraft(草稿 + 文本)`；抛错或没有 composer 时 `copyTextToClipboard` 回退。任何路径都不调用 `submit`，发送器 `createComposerHandoffSender` 返回“已插入对话草稿，尚未发送。”或剪贴板文案。
  - 接线：`src/client/index.ts` 注册 slot；`StudioShell.tsx` 把发送器注入 T031 `AnnotationQueue` 的 `send`；两语各 +1 key（`annotation.item.inserted`），复用 `renderAnnotationText`。
  - 验收对应：`tests/component/annotation/composer-handoff.test.tsx` 20 用例覆盖光标插入/分隔符/`false`→`setDraft`/抛错与缺 composer→剪贴板/从不 submit/会话隔离（后挂载生效、过期 detach 忽略、退回上一会话、各会话草稿独立）/快照稳定性与通知次数/两语文案；`tests/component/annotation` 4 文件 / 52 用例。
  - 手动 Web（`.tmp/logs/t032-web.json`，`ok:true`）：真实会话拾取 → 队列 1 → 发送后 composer 含完整标注、面板外 marker 0、3 s 后仍在（未自动提交）、队列清空、草稿按会话持久化（`localStorage['dsh.conversation.<id>']`）；新建会话 composer 为空且新会话草稿不含 marker；切回原会话草稿仍在、marker 仅出现在 composer；console 0 error。
  - 手动隔离 Desktop（`.tmp/logs/t032-desktop.json`，`ok:true`）：拾取 `#root > main > section:nth-of-type(2) > form`（唯一 1）→ 保存 → 发送后状态“已插入对话草稿，尚未发送。”、composer 含完整标注、面板外 0（点击前/后/3 s 后）、队列清空、草稿按会话持久化；停止预览目标 Edge 9 个 PID → 0、真实 `desktop` profile 哈希未变；3 条启动期 503 属隔离宿主预热噪声，无 pageerror。
  - 静态检查与构建：`pnpm typecheck` 0 error；`pnpm exec vitest run tests/component/annotation` 4 文件 / 52 用例；`pnpm test` 57 文件 / 466 用例；`pnpm build` host 192.8 KiB / client 184.7 KiB。日志 `.tmp/logs/t032-{typecheck,test,build}.log`。
  - 限制：未接附件（S2 无公开附件 API，截图仍“复制 + 手动粘贴”，T034/G3 复核）；隔离 Desktop 载体点 `新建会话` 不建会话（`.tmp/logs/t032-desktop-probe{,2}.json`：行不变、无 toast、无报错），跨会话隔离以 Web 手动 + 组件测试为准；草稿持久化依赖 DSH 自身 `localStorage`，本项目不另存。

### - [x] T033 标注历史

- **目标**：列表、搜索、重新打开、删除；持久化。
- **验收**：重启后仍在；坏数据不崩溃；删除生效。
- **验证**：`pnpm test -- tests/unit/annotation-history` + 手动。
- **文件**：`src/host/inspect/history.ts`、`src/client/inspect/History.tsx`、tests。
- **验证结果（2026-10-28）**：
  - 契约：`src/contracts/annotation.ts` 新增 `AnnotationHistoryQuery`/`Entry`/`Result` 与 `isAnnotationHistoryQuery`、`isAnnotationIdParams`、`matchesAnnotationQuery`、`toAnnotationHistoryEntry`；查询上限 200 字符，`limit` 默认 50、最大 200；搜索对 id/targetId/意见/选择器/标签/可访问名/文本/源码文件做大小写不敏感子串匹配（中文同样生效）；列表项只带摘要（意见截断 300 字符 + `…`、选择器/标签/源码位置），不带 `element.html`。`src/contracts/transport.ts` 新增 `annotation.history.{list,get,save,remove}`。
  - Host：`src/host/inspect/history.ts` 新增 `AnnotationHistoryService`（`list`/`get`/`save`/`remove`）与 `registerAnnotationHistoryMethods`；`list` 返回 `{entries,total,skipped}`，`get` 对缺失/损坏返回 `not_found`，`remove` 对未知 id 返回 `{removed:false}`；store 错误映射为稳定码（`invalid_annotation`/`annotation_too_large`→`invalid_input`、`project_missing`→`not_found`、`path_outside_project`→`permission_denied`、`invalid_project_path`→`invalid_config`、`io`→`internal`）。`annotation-store.ts` 新增 `listWithIssues()`（`list()` 委托它），坏 JSON、空文件、字段不合法、超 64 KiB、符号链接/越界文件计 `skipped` 而不抛错；`src/host/index.ts` 用 `ctx.effect` 注册四个方法并把 `annotationHistory` 放进 `ctx.provide('vibeStudio')`。
  - Client store：`src/client/inspect/history-store.ts` 沿用 T031 模块级写法（`useSyncExternalStore` + 注入式 `AnnotationHistoryApi`），`requestSeq` 保证快速输入时最新请求胜出；`persistAnnotation` 失败返回 `false` 不抛；`reopenAnnotationFromHistory` 只把记录放回队列，`removeHistoryAnnotation` 删除后刷新列表。
  - UI：`src/client/inspect/History.tsx` 渲染标题/计数、搜索框、加载/错误（可重试）/空态/无匹配（可清空搜索）/坏数据提示，条目显示选择器、本地时间、源码末段、意见，动作为“重新打开/删除”，删除需二次确认；全部动作带 `data-vibe-history-*` 钩子。`StudioShell.tsx` 在标注页签把队列与历史并列，并向队列注入 `persist`；`Canvas.tsx` 气泡保存后写入历史，失败只把提示降级为“已加入队列，但没能保存到历史。”；`AnnotationQueue.tsx` 编辑保存后写穿历史（`persist` 可选，既有队列用例不受影响）。两语各 +23 key，key 集合 184/184 一致。
  - 验收对应：`tests/unit/annotation-history/history.test.ts` 27 用例（排序/摘要字段/意见截断/空目录/limit 与 total/坏文件与超限跳过/查询校验/越界链接/搜索各字段与中文/`get` 缺失与损坏/保存校验与覆盖/删除与重启后仍删除/unary 信封 400 与 404/注入 store）；`tests/component/annotation/annotation-history.test.tsx` 14 用例（空态、条目渲染、坏数据提示、错误重试、中文、搜索与清空、重新打开入队且不发送、打开失败、两步删除/取消/已不存在/失败保留、与队列互不干扰）。
  - 验收对应（手动，`.tmp/logs/t033-history.json`，`ok:true`）：真实 Host 通过 `annotation.history.save` 写入 2 条（HTTP 200，磁盘 2 文件）→ 面板列出 2 条 → 搜索“品牌色”只剩 1 条 → 重新打开后队列 1 条、composer 仍为空（未自动发送）→ 停 Host、写入坏文件 `ann-t033-broken.json` → 重启后列表仍 2 条并提示“已跳过 1 个无法读取的标注文件。”→ UI 两步确认删除 1 条：状态“标注已删除。”、该文件已删、另一条仍在、列表剩 1；面板无 pageerror（7 条 DSH 自身 mux/资源断线属停/重启噪声，单独记录）。清理只删本轮 3 个 id，空的 `.vibe/annotations`、`.vibe` 已移除，端口无 LISTEN 残留。
  - 静态检查与构建：`pnpm typecheck` 0 error；`pnpm test` 59 文件 / 507 用例；`pnpm build` host 199.8 KiB / client 202.1 KiB。日志 `.tmp/logs/t033-{unit,component,full,typecheck,build,history}.log`。
  - 计划偏差/限制：客户端 store 命名为 `history-store.ts`（`history.ts` 与 `History.tsx` 仅大小写不同，会被 TS `forceConsistentCasingInFileNames` 拒绝）；列表按 `limit` 截断但搜索在 Host 端对全量过滤（当前目录规模可接受，未做索引/分页）；历史仅是本地记录，不进入聊天、不随发送删除；保存失败不影响队列；未接 region/截图来源的历史展示。

### - [x] T034 G3 Inspect 评审 [GATE]

- **目标**：验证圈选/标注/发送闭环与预算。
- **验收**：50 元素源码 ≥ 80%；标注 ≤ 4 KB；3 步内进 composer；不自动发送。
- **验证**：手动 + `pnpm test`；记录结果。
- **文件**：无。
- **评审结果（2026-10-29，不改产品代码）**：
  - 基线：`pnpm typecheck` 0 error；`pnpm test` 59 文件 / 507 用例；`pnpm test:e2e` 9/9（含三框架 dev 各 30/30、生产各 30/30 `source: null`）。日志 `.tmp/logs/g3-{typecheck,test,e2e}.log`。
  - ① 50 元素源码命中：**通过**。评审脚本 `.tmp/g3/source-sample.ts`（真实 `buildPickerScript` + `normalizePickedElement`，Vite dev server + headless Edge）在 React 17 / Vue 17 / Svelte 16 共 50 个元素上命中 50（100%，门槛 80%），0 miss、0 console/pageerror，结果 `.tmp/logs/g3-source.json`。与 `pnpm test:e2e` 的 90 元素（30×3，全部命中）互相印证。
  - ② 标注 ≤ 4 KB：**通过**。`.tmp/g3/budget.ts` 走真实 `renderAnnotationText`：常规中文 1,235 B；2,000 字中文 + >2 KB HTML 4,094 B；2,000 ASCII 4,096 B；1,000 emoji 4,096 B，均 ≤ 4,096 且无断开的代理对（`.tmp/logs/g3-budget.json`）。真实载体 `.tmp/g3/live.mjs`：2,000 字中文意见送入 composer 后实测 **4,095 B**。
  - ③ 3 步内进 composer：**初评未达标 → 用户批准返工后通过**。初评实测（不改产品代码）动作为：开启“拾取”(1) → 点击画布元素(2) → 输入意见 + `Ctrl+Enter` 保存(3) → 点击“查看队列”(4) → 点击“发送”(5)；从点击元素算起 4 个动作，根因是预览页签没有发送入口。返工：保存通知新增“发送到对话”（`src/client/inspect/AnnotationSaveNotice.tsx`，由 `StudioShell` 注入 composer handoff 发送器），复测动作为 点击元素(1) → 输入 + 保存(2) → 发送(3)，**3 个动作直达 composer**；计入“开启拾取”为 4 个（原先 5 个）。证据 `.tmp/logs/g3-live.json`（`ok:true`，动作序列 `pick-element → save-bubble → send-now`）。
  - ④ 不自动发送：**通过**。保存气泡后 composer 仍为空、页面外 marker 0；点击发送后状态“已插入对话草稿，尚未发送。”，4 s 后 composer 文本逐字节不变（4,095 B），面板外 marker 0，无用户消息出现，console 0；`handoff.ts` 只用 `captureInsertion`/`insertText`/可选 `setDraft`，无 `submit`/`send` 路径。
  - 附带发现（非本次验收阻断项）：2,000 字中文意见在 composer 里被截到约 1,617 字（4,095 B 预算），气泡没有“已截断”提示；`fixtures/vite-basic` 预览拾取 `source: null`（真实项目需装 dev 构建插件，属 T029 已知限制）；保存时面板不在标注页签，`[data-vibe-annotation-item]` 计数为 0 属测量时序，非缺陷；评审写入的 `.vibe/annotations/a-mvsaxlbb-1.json` 已删除，端口与 Edge 无残留。
  - 返工验证（经用户批准，仅动保存通知与发送路径，不碰拾取/上下文/预算）：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / 514 用例（新增 `tests/component/annotation/annotation-save-notice.test.tsx` 7 用例：不自动发送、成功清队列、无消息回退剪贴板文案、失败保留队列并可重试、发送中禁用、历史失败仍可发送、中文文案）；`pnpm test:e2e` 9/9；`pnpm build` host 199.8 / client 204.1 KiB；真实 Web 复测 `.tmp/logs/g3-live.json` `ok:true`（composer 4,095 B ≤ 4,096、保存后 composer 空、发送后 4 s 逐字节不变、面板外 marker 0、发送后队列 0 条、console 0）。
  - 结论：**返工后 4 项验收全部通过，G3 GO**。第 3 项按用户确认的口径“点元素 → 保存 → 发送 = 3 次点击”达标（另需先开启拾取，如实记录为额外 1 次点击）；附带问题（2,000 字中文意见在 composer 截断到约 1,617 字且无提示、`fixtures/vite-basic` `source: null` 属 T029 已知限制）不阻断验收，已记入 HANDOFF 遗留。

---

## M3.5：M3 界面优化（用户《M3修改意见》）

> 依赖：M3 已合并 `main`。范围只限标注气泡、队列与历史的界面和状态逻辑；不改拾取、上下文、预算、存储格式与发送语义（仍不自动提交）。依据：`界面审查/M3修改意见.docx`（未入库）与 `docs/2026-10-28-界面与项目方向.md` §1。

### - [x] U02 标注发送入口与状态归位

- **目标**：气泡增加直达发送；状态提示从列表底部移入对应卡片，随该标注的操作同步更新或解除；历史删除改为弹窗确认。
- **验收**：
  1. 气泡按钮顺序为“加入标注队列 / 发送到对话 / 取消”；点击“发送到对话”= 保存到历史 + 插入对话草稿（不自动提交），失败保留队列草稿可重试。
  2. 所有状态提示只出现在对应标注卡片内、“移除/删除”按钮右侧；队列与历史列表底部不再有状态行。
  3. 状态按标注 id 同步：重开 → 历史卡片显示“已重新放入上方队列，尚未发送。”；队列移除该条 → 该状态解除；队列/气泡/通知发送成功 → 旧状态解除，历史卡片显示“已插入对话草稿，尚未发送。”；发送失败 → 卡片内提示且保留草稿。
  4. 历史删除改为弹窗确认，取消/Esc 可退出；删除成功后无残留“标注已删除”提示，失败在弹窗内提示。
  5. `pnpm typecheck` 0 error、`pnpm test` 全绿、`pnpm build`、`pnpm test:e2e` 9/9；`vibe-dev` + headless Edge 实测按钮排版与状态流转（DOM 断言 + 截图）。
- **验证**：组件测试覆盖气泡三按钮顺序与发送、队列/历史状态同步、删除弹窗；真实载体手测。
- **文件**：`src/client/inspect/{AnnotationBubble,AnnotationQueue,History,AnnotationSaveNotice}.tsx`、新增 `src/client/inspect/annotation-status.ts`、`src/client/preview/Canvas.tsx`、`src/client/locales/*.json`、tests。
- **结果（2026-10-29）**：新增 `annotation-status.ts`（模块级 `Map<id, {kind, message}>` + `useSyncExternalStore`，队列/历史按 id 共享同一条提示；`setAnnotationStatus` 同值不重复通知，`clearAnnotationStatus` 用于移除/编辑/删除）。`AnnotationBubble` 增加 `onSend` 与三按钮行（`加入标注队列 / 发送到对话 / 取消`，发送为强调色，`data-vibe-bubble-send` 与队列的 `data-vibe-annotation-send` 区分；`Ctrl+Enter` 仍只入队），`Canvas` 新增 `queuePickedComment`/`sendPickedComment`（发送 = 入队 + 落盘 + `sendQueuedAnnotation`，落盘失败只降级提示、不阻断发送），`QueueNotice` 改为 `{annotation, persisted, sent}`。`AnnotationSaveNotice` 新增 `sent`/`initialMessage`，气泡直达发送的结果在通知挂载后到达也能显示，并把“发送”按钮收起。队列/历史底部状态行删除，提示改到卡片内“移除/删除”右侧；队列移除与编辑会清除该 id 的提示；历史重开写“已重新放入上方队列，尚未发送。”，发送成功写“已插入对话草稿，尚未发送。”。历史删除改为 `role="dialog"` 弹窗（遮罩点击/Esc/取消可退出，失败提示留在弹窗内），删除成功后不再残留“标注已删除”。两语：+`annotation.bubble.send`、+`annotation.history.deleteConfirm.{title,body}`，−`annotation.history.{deleted,gone}`（184→185，en/zh 对齐）。
- **验证结果（2026-10-29）**：`pnpm typecheck` 0 error；`pnpm test` 60 文件 / **529 用例**（新增 12：气泡三按钮顺序、气泡发送、`Ctrl+Enter` 不入发送、队列卡片内提示位置、移除清提示、发送失败提示在卡片内、历史提示位置、队列发送替换重开提示、队列移除清历史提示、删除弹窗确认/取消/Esc/已消失/失败、通知 `sent` 初值与挂载后到达、失败保留重试）；`pnpm build` host 200.6 / client 210.7 KiB；`pnpm test:e2e` 9/9。真实载体（`.tmp/u02-verify.mjs` → `.tmp/logs/u02-verify.json`，`ok:true`，0 console error，12 个动作）：气泡按钮为“加入标注队列/发送到对话/取消”；点“发送到对话”后通知“已插入对话草稿，尚未发送。”、composer 含完整标注、面板外 marker 0、队列 0 条、历史 1 条且提示“已插入对话草稿，尚未发送。”、列表底部状态 0 条；重开后队列 1 条、两边显示“已重新放入上方队列，尚未发送。”；队列移除后历史提示清空；删除弹窗 Esc/取消均退出且条目保留，确认后条目消失、无残留提示；3 s 后 composer 逐字节不变（未自动提交）。截图 `.tmp/logs/u02-{01-bubble,02-history-status,03-delete-dialog}.png`。清理：测试写入的 `.vibe/annotations` 与其空目录已删除，4320/4338 无监听残留。
- **口径说明**：验收第 3 条“发送后解除两个队列中的状态”按“旧提示解除、历史卡片改为显示新的‘已插入对话草稿，尚未发送。’”实现——发送成功后草稿出队，若完全不显示结果，用户将看不到“已插入”这条本应出现的提示。

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
| M2.5 UI Layout v2 | 1 | U01（2026-10-28 插入，阻塞 T027） |
| M3 Inspect | 8 | T027–T034 |
| M4 API | 12 | T035–T046 |
| M5 Agent | 8 | T047–T054 |
| M6 Hardening | 7 | T055–T061 |
| **合计** | **62** | 不含 B/C backlog |

**关键路径：**

```
T001–T004 → T005 → T006 → T007/T008/T009 → T010/T011/T012/T013/T014 → T015
→ T016/T017/T019/T020/T021/T022/T023/T024/T025 → T026
→ U01 → T027/T028/T029/T030/T031/T032/T033 → T034
→ T047/T048/T049/T050/T051/T052/T053 → T054
→ T055/T056/T057/T058/T059/T060 → T061
```

**可并行块：**

- T001–T004（四个 spike）。
- G1 后：M2（Preview）与 M4（API）两条线并行。
- T028/T029（上下文/源码）可在 U01 期间用 S4 harness 先行；**T027 overlay 必须等 U01 定稿画布几何**。
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
- 2026-10-28：按用户界面反馈（本地 `M1阶段界面审查/M1界面修改意见.docx`，未入库）新增 **U01 预览界面精简（Layout v2）**，置于 T027 之前；依据与产品方向见 `docs/2026-10-28-界面与项目方向.md`。其余任务范围不变，总数 62。
- 执行规则：按任务顺序推进；发现计划假设不成立时先更新 `plan.md`/SPEC，再继续。
