# VibeCoding Studio — 会话交接

> 更新时间：2026-10-28
> 用途：清理/切换对话后，新会话从这里恢复，不依赖旧聊天记录。
> 当前阶段：**Phase 4 实现（M0/G0 已通过，M1 已通过 G1，M2 已通过 G2）**；T001–T026 已完成，下一项 **U01 预览界面精简（Layout v2）**，完成后才进入 T027 拾取 overlay。

---

## 1. 一句话状态

DSH 的 VibeCoding Studio 插件已完成需求/可行性 SPEC、能力地图、实现计划，任务清单已批准。**T001 S1 传输 spike 已通过**：Web 与 Desktop 的 pull/stream 均达到 30 fps，10 min stream soak 无断流，选定 stream 为主、pull 为回退。证据见 `spikes/s1/REPORT.md`。**T002 S2 composer handoff spike 已通过**：右栏通过 `conversation.input.left` 的公开 `inputActions` 写入文本，不自动提交；文本/PNG 剪贴板在 Web/Desktop 可用；`createDrafts` 非公开且附件跨会话丢失，MVP 只做剪贴板回退。证据见 `spikes/s2/REPORT.md`。**T003 S3 screencast + 输入 + 中文 spike 已通过**：headless 98.7 fps / headful 98.3 fps（unique 同值），输入最大 26.8/25.2 ms，中文 `insertText`/逐字 `type`/模拟 IME 均正确，焦点/Tab/Esc 正常。限制：真实系统 IME 待 T022 手测；screencast 需在 T020 限速。证据见 `spikes/s3/REPORT.md`。**T004 S4 拾取 + 源码 spike 已通过**：React/Vue/Svelte 各 10/10，合计 30/30（100%），行号精确、选择器唯一 30/30、点击泄漏 0、Esc 正常、0 console/pageerror；React 19 已无 `_debugSource`，改用构建期 `data-inspector-*`；Vue 读 vnode `__v_inspector`；Svelte 读 `__svelte_meta`。证据见 `spikes/s4/REPORT.md`。**T005 G0 评审已通过（GO）**：stream 为主、pull 为回退；中文走隐藏 textarea + `insertText`，T022 系统 IME 手测失败时回退逐字/粘贴；截图只走复制 PNG 手动粘贴；源码按三框架适配、未命中降级选择器/DOM。无阻塞，证据见 `spikes/G0.md`。**T006 包脚手架已完成**：根包改为 `dsh-vibecode-studio@0.1.0`，`pnpm install/typecheck/test/build` 全绿，host 产出 ESM `lib/index.js`。**T007 client loader 已完成**：`lib/client.js` 为 `__ModuleLoader__` 包装，link 进 `vibe-dev` 后右栏菜单出现 Vibe Studio，hello 面板渲染、React 计数 0→1、client.js 200、console 0、无 loader 报错（Web）；Vitest smoke 4/4。**T008 host Config 已完成**：`Config`（5 项）+ `resolveConfig()` 语义校验，`apply()` 通过 `ctx.provide('vibeStudio', { config })` 注册服务；`--dump-config` 含 `vibe-studio`/包名，非法 `logLevel` 启动报 `ValidationError` 且插件不激活，默认配置 20 s 启动无 warning/error；`pnpm typecheck` 0 error、Vitest 10/10、`pnpm build` 通过；`profiles/vibe-dev/README.md` 记录安装/配置/负例/移除。**T009 Contracts v1 已完成**：`src/contracts/*` 提供 target/session、annotation、element/source、console/network、artifact、品牌 ID、稳定错误码；4 KB 注解/8 KB observe 预算与 UTF-8 安全截断、header/URL/JSON 脱敏、`<untrusted-page-content>` 包裹（先转义再截断）；contracts 单测 6 文件 / 34 用例、全量 8 文件 / 44 用例、typecheck/build 通过，无第三方运行时依赖。**T010 client shell 已完成**：`src/client/shell/*` 提供标题、预览/检查/标注/API 四个内部页签、空/错/加载状态与错误边界，模块级 store 保证收起或重开 tab 后仍停在原页签；`src/client/locales/{en,zh-CN}.json` + `i18n.ts` 骨架（en→key 回退、`{name}` 插值、`zh*`→zh-CN）；headless Edge 实测 guide 开 tab、全屏进出、收起/展开、关闭重开均保留“标注”，client.js 200、console 0；`pnpm exec vitest run tests/component/shell` 3 文件 / 13 用例，全量 11 文件 / 57 用例，typecheck/build 通过（client 12.0 KiB）。**T011 传输骨架已完成**：host 通过 `ctx.connection.fetch.register` 注册 `/api/vibe/health` 与 `/api/vibe/request`（`UnaryRegistry` 内置 `studio.ping`，严格方法/内容类型/64 KiB/JSON 校验），client `fetchHealth()`/`callUnary()` 使用文档相对路径、超时/中止与稳定错误映射；传输集成测试 2 文件 / 26 用例、全量 13 文件 / 83 用例通过，typecheck/build 通过（host 11.8 KiB / client 12.0 KiB）。真实载体：`vibe-dev`（launch overlay 临时禁用 s1/s2 同路径路由）raw HTTP 9/9——未认证 401、跨源 403、坏 Host 403、认证 health/unary 200、错误 content-type 415；headless Edge 与隔离 Desktop（`dsh-app://app`）页面内 client transport 均成功、console 0。client transport 尚未接入出厂 `lib/client.js`，留待后续 UI 任务。**T012 测试 harness + fixture 已完成**：Vitest 分 `node`/`component` 两个 project（jsdom + 统一 cleanup），Playwright 配好 `channel: 'msedge'` 与 webServer 自动拉起 `fixtures/vite-basic`（React 19 + Vite 8，含表单/列表/计数器、`/api/echo`、`/api/boom`、`/api/slow`），假 adapter 生命周期替身已就位；全量 14 文件 / 89 用例、E2E 3/3 通过，fixture 端口 4320 无残留。**T013 `.vibe` 配置存储已完成**：`src/host/studio/store.ts` 提供 `StudioStore`，读取缺失/坏 JSON/超版本/超大/字段非法均回退默认值并给出 `issues`（不崩溃、不改写原文件），写入先校验再同目录临时文件 + `rename` 原子替换，项目根/`.vibe`/`studio.json` 均 `realpath` 校验、拒绝逃逸 junction；1 文件 / 10 用例、全量 15 文件 / 99 用例、typecheck/build 通过。**T014 设置面板（基础）已完成**：`src/host/studio/settings.ts` 把 `StudioStore` 文档应用到与 health 共享的同一个 `VibeStudioConfig`，提供 `studio.settings.get/update`；`src/client/shell/settings/*` 新增第 5 个“设置”页签，字段级校验 + Host `issues` 提示 + 保存状态；全量 `pnpm test` 17 文件 / 114 用例、typecheck/build 通过；`vibe-dev` + headless Edge 两轮启动验证保存、health 同源、非法值提示、重启持久化（`--patch .tmp/t014-profile-patch.yml` 临时禁用 s1/s2 同路径路由），console 0，测试生成的 `.vibe/` 已清理。**T015 G1 Foundation 评审已通过（GO）**：在 `vibe-dev` 的 patch 层持久禁用 s1/s2（备份 `.tmp/logs/vibe-dev-cordis.patch.yml.bak-2026-10-27`），不带 `--patch` 启动即 health `plugin=dsh-vibecode-studio`、settings 方法 200；`pnpm typecheck/test/build/e2e` 全绿（114 用例 / 3 E2E）；Web 与隔离 Desktop 均为 5 页签 + 设置页可用，真实 `desktop` profile 哈希未变，console 无插件错误。**T016 Target 模型、配置与 adapter 注册表已完成**：`src/host/targets/{types,registry,validate}.ts` 定义 `TargetAdapter` 契约（start/stop 必选，navigate/screenshot 可选，capabilities 能力声明）、`ValidatedTargetConfig`（viewport 归一 1280×720@1）、严格配置校验（id/name/kind/url/command/cwd/port/viewport，未知键、非 http(s)、凭证 URL、相对 cwd、越界值均 `invalid_config` + `details.field`）与每 kind 一个 adapter 的注册表（未知 kind → `unsupported: unknown target adapter`，重复注册/缺 capability → `invalid_config`）；`apply()` 向 `vibeStudio` 服务槽提供空 `targets` registry，`assertCapability` 对未声明能力抛 `unsupported`；`tests/helpers/fake-adapter.ts` 改为实现真实契约。`pnpm exec vitest run tests/unit/targets` 3 文件 / 21 用例、全量 20 文件 / 135 用例、typecheck/build 通过（host 34.6 KiB / client 36.8 KiB）。**T017 Web target adapter 已完成**：`src/host/targets/web/launch.ts` 懒加载 `playwright-core`、只用本机 `channel: 'msedge'`，缺失 Edge → `target_unavailable`（消息不含本机路径）、其他启动失败 → `preview_failed`、导航超时/不可达/其他分别映射 `timeout`/`target_unavailable`/`preview_failed`；`adapter.ts` 实现 `TargetAdapter`（并发 start 合并、stop 幂等、失败可重试、navigate 更新 session url、viewport PNG 截图、默认仅 loopback、`allowNonLocal` 显式放开、能力仅开 screenshot），并在 `apply()` 注册。真实 Edge + 临时端口 Vite fixture 验证：800×600 PNG 解码校验白底/文字像素、query 导航生效、不可达端口稳定 `target_unavailable`、关闭后浏览器断开且 5 s 内无 `playwright_chromiumdev_profile` 的 msedge 进程、可再次启动为 `fixture-2`；聚焦 2 文件 / 13 用例、全量 22 文件 / 148 用例、typecheck/build（host 43.4 KiB / client 36.8 KiB，`playwright-core` 仍懒加载）、E2E 3/3。**T018 S8 进程生命周期 spike 已完成**：`spikes/s8/run.ts` 用真实 Vite + fixture 测量——启动 HTTP 就绪 9 次 393–469 ms（中位 417 ms，预算 10 s）；停止 `taskkill /T /F` 435–598 ms、3/3 无存活，直接 `kill()` 14–15 ms 且 0 存活（Node 24 job object 现象，不依赖）；`cmd.exe` 中转只杀 cmd 会留下 1 个 vite node 并继续占端口，按记录 PID + 命令行匹配可清零；端口冲突 exit 1、stderr `Error: Port <port> is already in use`；结束残留进程 0、监听端口 0，`overall: PASS`。结论见 `spikes/s8/REPORT.md`，原始数据 `.tmp/logs/s8-results.json`。**T019 Dev server 进程监督已完成**：`src/host/targets/process/{supervisor,logs}.ts` 实现可注入 supervisor（`shell:false` spawn、HTTP 就绪 10 s、端口冲突/超时/spawn 失败/abort 稳定映射、并发 start 合并、ready 幂等、失败可重试）、日志环形缓冲（500 条 / 64 KiB / 单行 2000 字符，去 ANSI，seq + `after`/`limit`）、Windows `taskkill /T /F` + 停止前记录后代并按 PID/命令行精确兜底 + survivors/端口释放校验；启动失败且子进程已自行退出时跳过端口检查，避免误报和 5 s 等待。聚焦 `tests/integration/supervisor` 2 文件 / 23 用例（全假进程）、全量 24 文件 / 171 用例、typecheck/build（host 67.4 KiB / client 36.8 KiB）通过；真实 Vite 手动 `pass: true`（启动 532 ms、重启 run=2/新 PID/清日志、停止 `survivors:[]`/端口释放/无残留 node.exe、端口冲突 ~1.6 s `preview_failed`/`port_in_use`）。**T020 Screencast + 帧路由 + canvas 已完成**：host 最新帧缓冲（seq 单调）、screencast 及时 ack + 4 MiB/SOI 校验 + 30 fps deadline 限速、multipart `/api/vibe/stream` 与 `/api/vibe/frame?wait=1&after=<seq>` 双路由（200/204/400/503）；client stream 为主、pull 2 s 退避 + 5 s 探测恢复、seq 去重，canvas `createImageBitmap` 单绘制循环 + `bitmap.close()`。聚焦 4 文件 / 28 用例、全量 28 文件 / 199 用例、typecheck/build（host 88.2 / client 58.1 KiB）通过。手动 Web（`.tmp/logs/t020-web.json`，`ok:true`）：断流→轮询 25.3 fps/1280×720/12 色，恢复→流式 25.3 fps；25 s 浸泡 host RSS 最后 5 s +24 KB、浏览器堆 +190 KB；Edge 全退、真实 profile 未改。隔离 Desktop（`.tmp/logs/t020-desktop.json`，`ok:true`）：流式 25.7 fps、1060 帧、13 色、渲染器堆 +49 KB、RSS 无增长；Edge 全退、profile 未改。手测修复 detached `window.fetch` 在 Chromium 的 `Illegal invocation`。**T021 输入转发已完成**：contracts 新增 `PreviewInputEvent` 严格校验，host `preview/input.ts` 按实时 viewport 映射比例坐标、维护按钮集合与 modifiers、串行派发 CDP `Input.*`、停止级联 detach，路由复用 unary `preview.input`，Web adapter 开 `input` 能力；client `InputLayer` 透明覆盖层 + 单飞行/合并 move 转发，IME 组合期忽略，Canvas ready 时挂载。聚焦 3 文件 / 23 用例、全量 31 文件 / 222 用例、typecheck/build（host 99.1 / client 66.0 KiB）通过；手动 Host/Web/隔离 Desktop 均 `ok:true`，端到端最大 39.3 ms（Web）/ 14.3 ms（Desktop）/ 26.3 ms（Host 直连），焦点、输入、点击、滚动均达目标，目标 Edge 全退、真实 profile 未改。限制：Desktop 自动化 25 ms/字符键入只到首字符，150 ms/字符正常，留 T022 真 IME 复核。**T022 中文输入已完成**：contracts 新增 `{kind:'text',text}` 严格校验（≤1024 码点、拒绝孤立代理），host 优先 `Input.insertText` 并在被拒时按码点回退（≤256），client 用可聚焦隐藏 textarea 只提交 `compositionend` 最终文本、点击定位并聚焦、`Ctrl/Cmd+V` 走 paste 回退、失败显示 `role=status` 限制提示，失活时清理组合态。聚焦 4 文件 / 39 用例、全量 32 文件 / 238 用例、typecheck/build（host 100.5 / client 72.2 KiB）通过；手动 Host/Web/隔离 Desktop 均 `ok:true`，Web/Desktop 目标收到 `你好，世界` 且无中间态请求，强制 500 后提示出现、解除后恢复，粘贴整段送达，端到端最大 15.7 ms（Web）/ 59.6 ms（Desktop），目标 Edge 全退且真实 profile 未改。限制：CDP 模拟 IME 不能替代 Microsoft Pinyin 系统级手测。**T023 Console 采集与抽屉已完成**：独立 CDP 会话采集 console/exception、500 条 / 64 KiB ring buffer、`seq` 跨清空单调、`redactUrl` 与 UTF-8 截断；抽屉增量轮询、过滤、清空与错误提示；22 个聚焦用例、260 个全量用例、typecheck/build 通过，真实 Edge 手测 510 条后恰 500 条、清空后 seq 不变且新事件续号，`ok:true`。**T024 Network 采集与抽屉已完成**：`preview.network.list`/`clear`/`body` 一元方法、独立 CDP 会话采集请求/响应、4xx/5xx 标记、header/URL 先脱敏、300 条 / 256 KiB ring buffer 与 revision 游标（pending 行更新后重发）、body 按需读取并截断至 64 KiB；抽屉 500 ms 增量轮询、按 id 原位更新、Failed 过滤、展开懒加载 body、清空同步 Host；采集失败只降级能力、不阻断预览。27 个聚焦用例、287 个全量用例、typecheck/build 通过；未做真实 Edge 手测。**T025 预览工具栏与生命周期已完成**：contracts 新增 navigate/reload/viewport/targets 四个一元方法与 `kind` 快照，host 会话服务迁到 `session.ts`（1 s 健康检查置 `failed`、只提示不自动重连、重启先释放旧句柄、reload 回退 navigate、viewport 保留 DPR），Web adapter 增加 reload/setViewport/isAlive；client 新增 `Toolbar`（目标/URL/刷新/视口/外部打开仅 loopback/崩溃提示 + Restart/Stop）与 `lifecycle`（内部 tab 切换不 stop，shell 卸载才 stop），Canvas 1 s 状态轮询 + 500 ms 帧统计。14 个聚焦用例、301 个全量用例、typecheck/build 通过；Host 真 Edge 与隔离 Desktop 均 `ok:true`：崩溃 101 ms 检出且不自动重启、重启成功、Desktop 内部切 tab 会话保留、停止后 4471/3820 ms 内进程全退且无孤儿、真实 desktop profile 哈希未变；T023/T024 抽屉已在真实载体确认有数据。M1 完成，M2 的 T016–T026 已完成，G2 评审通过（GO）；下一项 T027 拾取 overlay 与选择器。

---

## 2. 参考资料（按需读取，不要通读）

新会话只读本文件 + `tasks/todo.md` 的当前任务段；下面文档仅在任务引用或验收需要时按 section 查。SPEC/plan 已批准，不重复评审。

1. [docs/SPEC-vibecoding-studio.md](../docs/SPEC-vibecoding-studio.md) — 需求、可行性、MVP 切分、安全边界。
2. [docs/CAPABILITY-MAP.md](../docs/CAPABILITY-MAP.md) — 8 个模块、依赖方向、构建顺序。
3. [tasks/plan.md](./plan.md) — D1–D12 技术决策、M0–M6、G0–G6、S1–S8。
4. [tasks/todo.md](./todo.md) — 61 个可执行任务、验收、验证命令、文件。
5. [docs/DEVLOG.md](../docs/DEVLOG.md) — 开发进度、踩坑、决策变化与恢复检查清单。
6. [docs/dsh-plugin-ecosystem-analysis.md](../docs/dsh-plugin-ecosystem-analysis.md) — DSH 插件生态与扩展点依据（需要时查，不必通读）。

---

## 3. 当前 Gate 状态

| 阶段 | 产物 | 状态 |
|---|---|---|
| Phase 0 能力地图 | `docs/CAPABILITY-MAP.md` | 已批准（2026-10-25） |
| Phase 1 SPEC | `docs/SPEC-vibecoding-studio.md` | 已批准（2026-10-25） |
| Phase 2 计划 | `tasks/plan.md` | 已批准（2026-10-25） |
| Phase 3 任务 | `tasks/todo.md` | 已批准（2026-10-25） |
| Phase 4 实现 | `spikes/s1/`–`spikes/s4/`、`spikes/s8/`、`spikes/G0.md`、`src/`、`scripts/`、`tests/`、`fixtures/`、`cordis.patch.yml` | M0/G0 已通过；M1 完成并通过 G1（T001–T015）；M2 完成并通过 G2（T016–T026）；下一项 U01（M2.5），之后 T027 |

任务清单已获批准，按 `tasks/todo.md` 顺序执行；如果发现计划假设不成立，先更新 `plan.md`/SPEC，再继续，不要静默改范围。

---

## 4. 下一步

1. 任务清单已于 2026-10-25 批准，不再重复评审。
2. T001–T015 已完成并记录验证结果；**T005 G0 与 T015 G1 均已通过（GO）**，T006 脚手架、T007 client loader、T008 host Config、T010 client shell 均已在 `vibe-dev` Web 验证，T009 contracts 由 34 个单测覆盖，T011 transport 由 26 个集成用例 + Web/隔离 Desktop 真实载体验证，T012 harness 由 89 个 Vitest 用例 + 3 个 Playwright E2E 覆盖，T013 store 由 10 个用例覆盖，T014 设置面板由 19 个聚焦用例 + 全量 114 用例覆盖并验证保存/同源/重启持久化，T015 完成干净 profile 安装与 Web/Desktop 双端复核。T016 完成 target 契约、配置校验与 adapter 注册表（21 个聚焦用例）。T017 完成 Web target adapter：Edge 启动/导航/截图/关闭 + 稳定错误映射 + loopback 限制，13 个聚焦用例（真实 Edge + fixture）。T018 完成 S8 进程生命周期 spike：启动 ~0.4 s、treekill 无孤儿、`shell:true` 孤儿风险已验证、端口冲突可读，报告 `spikes/s8/REPORT.md`。T019 完成 dev server supervisor：spawn/HTTP 就绪/日志 ring buffer/停止/tree kill/孤儿兜底与端口冲突映射；23 个聚焦用例（全假进程）、171 个全量用例、真实 Vite 手动 `pass: true`。T020 完成 screencast + 帧路由 + canvas：最新帧缓冲、30 fps deadline 限速、stream/pull 双路由、断流回退与恢复、canvas 合并绘制；28 个聚焦用例、199 个全量用例、Web/隔离 Desktop 手动均通过（Web 断流回退 25.3 fps，Desktop 流式 25.7 fps，内存无增长趋势）。T021 完成输入转发：契约严格校验 + host 比例坐标/CDP 串行派发/按钮与 modifiers + unary `preview.input` + client 透明覆盖层/单飞行合并；23 个聚焦用例、222 个全量用例、typecheck/build 通过；手动 Host/Web/隔离 Desktop 端到端最大 26.3/39.3/14.3 ms，焦点、点击、输入、滚动均达目标，Edge 全退且真实 profile 未改。T022 完成中文输入：`{kind:'text'}` 契约、`Input.insertText` + 逐字回退、隐藏 textarea 只提交组合最终文本、点击定位、粘贴回退与限制提示；39 个聚焦用例、238 个全量用例、typecheck/build 通过，Host/Web/隔离 Desktop 均 `ok:true`，提交 `你好，世界` 且无中间态请求，失败提示与恢复、粘贴均验证，端到端最大 15.7/59.6 ms（Web/Desktop），Edge 全退且真实 profile 未改。T023 完成 Console 采集与抽屉：`preview.console.list`/`clear` 一元方法、独立 CDP 会话采集 console/exception、500 条 / 64 KiB ring buffer、`seq` 跨清空单调、`redactUrl` 与 UTF-8 截断、抽屉增量轮询/过滤/清空；22 个聚焦用例、260 个全量用例、typecheck/build 通过，真实 Edge 手测 510 条后恰 500 条、clear 后 seq 不变且新事件续号，`ok:true`。T024 完成 Network 采集与抽屉：`preview.network.list`/`clear`/`body` 一元方法、独立 CDP 会话采集请求/响应、4xx/5xx 标记、header/URL 脱敏、300 条 / 256 KiB ring buffer、revision 游标让 pending 行原位更新、body 按需 64 KiB 截断；27 个聚焦用例、287 个全量用例、typecheck/build 通过；未做真实 Edge 手测。T025 完成预览工具栏与生命周期：contracts 新增 navigate/reload/viewport/targets 一元方法与 `kind` 快照；host 服务迁到 `session.ts`，1 s 健康检查发现断线即 `failed`（不自动重连），重启先释放旧句柄，reload 无实现时回退 navigate，viewport 复用配置校验并保留 DPR；Web adapter 增加 reload/setViewport/isAlive；client 新增 Toolbar、`local-url` loopback 校验与 `lifecycle`（内部 tab 切换不 stop，shell 卸载才 stop），Canvas 1 s 状态轮询 + 500 ms 帧统计，崩溃提示含 Restart/Stop；14 个聚焦用例、301 个全量用例、typecheck/build 通过，Host 真 Edge 与隔离 Desktop 手动矩阵均 `ok:true`（崩溃 101 ms 检出、停止后 4471/3820 ms 进程全退、无孤儿、真实 profile 未改），T023/T024 抽屉已在真实载体确认。T026 G2 Preview 评审 **通过（GO）**：基线 typecheck 0 error、301 用例、build host 140.5 / client 115.1 KiB；Host 真 Edge、Web（`vibe-dev` + headless Edge）与隔离 Desktop 三端均在 1280×800 实测 24.4–25.9 fps，点击/输入/滚动、Console/Network 抽屉、停止清理（1357/2940/4886 ms、无孤儿）全部通过，真实 desktop profile 哈希未变。**M1 完成；M2 完成并通过 G2，下一项 U01 预览界面精简（Layout v2），之后 T027 拾取 overlay 与选择器。**
3. 每个任务完成即勾选，并在任务下记录验证结果；G0/G1 已通过；后续门禁 G2–G6 通过后才进入下一阶段。
4. 代码与文档按任务分批提交；私有仓库公开前按 `docs/PUBLISHING.md` 清理机器路径与历史。
5. 分支基线：M1 已以 `--no-ff` 合并入 `main`（`d1f4053`）。M2 全部在 `task/m2-target-model`，已推送到 `92ecc32`；之后 `9c19501`/`b7cde55` 及本次方向文档提交在本地（推送曾因 GitHub 连接重置失败，需重试）。G2 已通过但**尚未合并 `main`，需用户批准**；合并建议 `--no-ff` 后在 `main` 上打 `M2` 记录。不要回到 `task/m1-foundation`。

### UI 方向已定稿（2026-10-28）

- 依据：用户《M1界面修改意见》+ 会话讨论，完整方向见 **`docs/2026-10-28-界面与项目方向.md`**（Layout v2、元素处置表、U01 验收、P1–P7 项目方向、防跑偏约束）。
- 结论：**先做 U01 预览界面精简**，再做 T027。原因：T027 拾取 overlay 依赖最终画布几何，先定布局可避免返工。
- UI 总原则：画布优先；参数进设置或“更多”；底部 tab + 覆盖式抽屉；空/失败态给初学者提示；不做 IDE 化。
- M3–M5 期间新增界面一律遵守该文档第 1 节六条原则；产品级方向（P2–P6）需先立项/出 SPEC，不夹带实现。

### U01 起步提示（下一会话）

- 任务段：`tasks/todo.md` 的 **U01 预览界面精简（Layout v2）**；方向与验收见 `docs/2026-10-28-界面与项目方向.md` 第 2 节。
- 做了什么：状态压成单行（`● 运行中 · 25 fps` + `⋯`）；视口宽高移入设置页“预览”分组；`在浏览器打开/停止/重启` 收进“更多”；Console/Network 改成底部常驻 tab + 覆盖式抽屉；补空状态/失败态提示。
- 验收：320/400/500px 宽无横向溢出、画布 ≥ 60% 高；常驻行 ≤ 3；抽屉开合画布尺寸不变；P1–P5/V/I/C/N/L/S 全回归；约 25 fps；console 0 error；typecheck/test/build 全绿。
- 文件：`src/client/preview/{Canvas,PreviewPage,Toolbar}.tsx`、`src/client/preview/*.css`、`src/client/shell/settings/*`、`src/client/locales/*.json`、tests。
- 约束：只改预览排版与文案，不新增功能；不改 host 契约；不自动发送/批准/提交；不改 `desktop`/`web` profile。

### T027 起步提示（U01 完成后）

- 任务段：`tasks/todo.md` 的 T027“拾取 overlay 与选择器”：注入脚本、Shadow DOM overlay、hover/click、`Esc`、`Alt+Click`、选择器生成。
- 验收：不触发页面原点击；选择器唯一或标注“非唯一”；10 个元素抽测通过；复用 S4 harness + integration。
- 文件：`src/host/inspect/{inject.ts,selector.ts}`、`src/client/inspect/Picker.tsx`、tests。
- 约束：不自动发送/批准/提交；不改 `desktop`/`web` profile；非本地目标先询问；测试不得依赖外网。

### T026 遗留

- G2 结论已写入 `tasks/todo.md` T026 段；手测脚本 `.tmp/t026-{host,web,desktop}.mjs` 与结果 `.tmp/logs/t026-*.json` 非产品代码。
- Desktop 预览 Edge 被遮挡时 Chromium 会节流 rAF/JS 计时器，桌面脚本测量前用 `SetForegroundWindow` 拉起预览窗口；这是测量环境限制，不是产品缺陷。
- 停止清理 Desktop 实测 4886 ms，接近 5 s 验收上限；若后续加重清理步骤，需重新测。
- FR-PRE-09（多目标切换、每目标独立会话）未验证：当前只注册 `web` 目标，留到多目标任务。
- FR-PRE-07 的截图仍未接入 artifact store/截图 UI（T017 遗留，后续任务处理）；“外部打开”只验证按钮可用，未点击（会离开应用）。

### T025 遗留

- 崩溃后不做自动重连，需用户点 Restart；如需自动恢复请在 SPEC 中先定义重试上限。
- 改 `deviceScaleFactor` 需重启会话；视图内只改宽高并保留 DPR。
- Desktop 的 `window.open` 会被拦截并交给系统浏览器，返回 null 属正常路径，不报错。
- “关闭整个 DSH 面板”触发的 stop 只有 lifecycle 单测覆盖，真实载体未做（脚本只能切内部 tab）。
- 手测脚本 `.tmp/t025-host.mjs`、`.tmp/t025-desktop.mjs` 非产品代码；结果 `.tmp/logs/t025-{host,desktop}.json`。

### T024 遗留

- T024 验证只要求 integration + component，未做真实 Edge 手测；T025 已在隔离 Desktop 确认 Network 抽屉有数据，滚动与 500 ms 轮询开销仍留 G2 观察。
- 未采集 POST body、WebSocket/SSE 消息体；`Network.getResponseBody` 在资源已释放或无 body 时返回 `not_found`，抽屉显示“没有响应体”。
- `limit` 按插入顺序保留最新行，revision 更新不会重排；client 以 `after` revision 游标为主，`limit` 仅作防御性上限。

### T023 遗留

- T023 验证只要求 integration + component，未做 Web/隔离 Desktop 载体手测；T025 已在隔离 Desktop 确认 Console 抽屉有数据，布局/滚动与轮询开销留 G2 观察。
- 页面 `console.clear()` 被忽略（按 type 过滤），清空以抽屉按钮为准；`exceptionThrown` 的 `description` 可能自带堆栈，已受单条文本上限约束。
- 手测脚本 `.tmp/t023-host.mjs` 非产品代码；真实 profile 哈希校验与 Edge 进程树清理沿用 T021/T022 方式。

### T022 遗留

- 自动化用 CDP `Input.imeSetComposition` + `Input.insertText` 模拟 IME，未替代 Microsoft Pinyin 系统级手测；仍建议在 `vibe-dev` Web 与隔离 Desktop 手测组合中途候选、上屏、emoji、超长输入与切换预览。
- Desktop 的失败注入通过渲染进程 fetch 包装完成（`dsh-app://` 不能被 Playwright route 拦截），仅存在于 `.tmp/t022-desktop.mjs`；产品代码未引入测试开关。
- T021 的“Desktop 合成键盘 25 ms/字符只到首字符”未在 T022 复测；真实键盘/IME 不受影响，后续若再遇合成输入丢字先用 150 ms/字符复核。

### T021 遗留

- 手测脚本 `.tmp/t021-{host,web,desktop}.mjs` 非产品代码，可作 T022 基线；真实 profile 哈希校验与 Edge 进程树清理已内置。
- Desktop 自动化按 25 ms/字符合成键入只收到首字符，150 ms/字符正常；T022 真 IME 手测复核，不要用快速自动化结果判定输入链路丢失。
- T021 已验证停止后输入 CDP 会话 detach、目标 Edge 全退；T022 新增 textarea 后需复核停止/切换预览时监听与组合态清理。

### T020 遗留

- Desktop 未单独模拟断流（回退由 Web 覆盖）；缩放/整页切换未覆盖。
- 手测脚本 `.tmp/t020-{web,desktop}.mjs` 非产品代码；Desktop 隔离 home 的 studio 依赖需在 `.tmp/desktop-home/profiles/desktop` 先 `pnpm install`（link 依赖）后再启动。

### T017 遗留

- `playwright-core` 目前是 devDependency，host 通过动态 import 使用；T056/T057 打包前需提升为运行时依赖并验证干净 profile 可解析。
- Web adapter 已由 T020 补 screencast/帧路由、T021 补 `input` 能力；截图尚未接入 artifact store/`screenshotEnabled` 与保留策略（留到截图 UI/artifact 任务）。
- T014 遗留：M1 项目根取 `process.cwd()`（`apply()` 阶段无工作目录），M2 解析预览工作区时再收紧；`.vibe/` 已加入 `.gitignore`。

---

## 5. 新会话启动语（可直接粘贴）

```
读 tasks/HANDOFF.md 的“一句话状态”“下一步”“环境与路径”和“不可违反的约束”，
任务清单已批准，T001–T026 已完成（G0/G1/G2 通过、M1 完成、M2 完成）；界面/产品方向已定稿于 docs/2026-10-28-界面与项目方向.md。
只读 tasks/todo.md 中 U01 一节，从 U01 预览界面精简（Layout v2）开始：画布优先、参数外移、底部 tab + 覆盖式抽屉、空/失败态引导；只改预览排版与文案，不新增功能、不改 host 契约。
完成后勾选并记录验证结果（typecheck/test/build + 320/400/500px 截图与回归），再进入 T027。
不要通读已批准的 SPEC/plan。
```

---

## 6. 环境与路径

- 项目：`<repo>`
- DSH 安装：`<DSH_ROOT>`
- DSH 数据：`<DSH_ROOT>\home`
- 开发 profile：`vibe-dev`（**不要直接改 desktop profile**）；patch 层已禁用 s1/s2 spike（避免抢 `/api/vibe/health`），改前备份 `.tmp/logs/vibe-dev-cordis.patch.yml.bak-2026-10-27`，删除两行 `disabled: true` 即恢复
- 隔离 Desktop 测试：`DSH_HOME=.tmp/desktop-home`（仅 studio，不含 spike），独立 `--user-data-dir`，CDP 9223；首次启动由 Electron 生成 base/web-app profile，随后在 `.tmp/desktop-home/profiles/desktop` 的 `package.json` 加 studio link + `pnpm install`（link 依赖，离线）再启动；真实 desktop profile 未改
- Node：`24.13.0`；pnpm：`11.21.0`；DSH CLI：`0.2.1-rc.2`；Desktop 应用：`0.2.1-rc.3`
- 会话用量：`pnpm usage:cc`（只读；`--all` 显示全部，`--json` 输出 JSON）
- 浏览器：本机 Edge；Playwright 用 `channel: 'msedge'`，不下载浏览器
- 测试 fixture：`fixtures/vite-basic`，`pnpm fixture:dev` → `127.0.0.1:4320`（strictPort）；E2E 产物写 `.tmp/playwright-results`
- 临时/缓存：非系统盘或项目目录，避免占用 C 盘

---

## 7. 不可违反的约束

- 只执行已批准任务；未批准的任务不写产品代码、不建 profile、不装依赖。
- 所有 host/client 通信走 `ctx.connection`，不裸用 `ctx.webServer`。
- 页面/接口内容按不可信数据处理；密钥只走 `ctx.credentials`，UI 只读 `describe`。
- 不自动发送标注、不自动批准、不自动提交、不把截图当唯一证据、不把截图放进工具结果。
- 预览默认 localhost；禁止 `file:`/`chrome:`/`devtools:`/云元数据/私网；非本地目标先询问。
- CDP 只连已启动/已批准端点，不暴露到网络；进程树必须清理。
- 高风险操作（删除/覆盖/批量修改/系统设置）先核对两遍，必要时先备份/询问。
- 遇到不熟悉的功能，先从 GitHub 检索维护活跃、许可证明确的同类项目，比较高星项目的设计、依赖与已知问题；借鉴经过验证的思路，不直接复制来源不明或不兼容的代码，落地前先对照本项目验证。

---

## 8. 已锁定的关键决策（详见 plan.md）

- 单 npm 包 + 多子路径；host TS→ESM；client 走 loader 包装。
- MVP 帧传输：**流式 multipart JPEG 为主**，拉取式 JPEG 作为断流/降级回退（S1 已验证两种 profile 均 30 fps）。
- 预览用 Playwright/CDP + Edge；拾取 overlay 注入；源码适配 React/Vue/Svelte。
- 标注文本优先 ≤ 4 KB；`vibe_observe` ≤ 8 KB；大内容用 artifact id。
- API 工作台 MVP：请求构建/响应查看/集合/环境/历史/cURL/OpenAPI 导入/抓包回放；断言为 P1。
- MVP 不做小程序/原生桌面/区域多选/直接截图附件；S2 未找到可依赖的公开附件 API，截图只走“复制 + 手动粘贴”。
- Agent 集成：4 个工具 + `/vibe` + bundled skill + 最小 preset + hooks。

---

## 9. 验证基线命令（实现开始后使用）

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
dsh --profile vibe-dev --dump-config
```

> T001 已运行 `pnpm typecheck`、`pnpm spike:s1` 与 `spikes/s1/soak.mjs`；T002 已运行 `pnpm typecheck`、`pnpm spike:s2:build` 并完成 Web/隔离 Desktop 手测；T003 已运行 `pnpm typecheck` 与 `pnpm spike:s3 --seconds 10`；T004 已运行 `pnpm typecheck` 与 `pnpm spike:s4`；T005 为人工评审，未重跑 spike；T006 已运行 `pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm build`；T007 已运行 `pnpm typecheck`、`pnpm test`（4/4）、`pnpm build:client`（`lib/client.js` 3.2 KiB），并在 `vibe-dev` Web 用手动/headless Edge 验证 hello tab、client.js 200、console 0；T008 已运行 `pnpm typecheck`、`pnpm test`（10/10）、`pnpm build`（`lib/index.js` 2.4 KiB）、`dsh --profile vibe-dev --dump-config`，并用 `.tmp/t008-valid.yml` / `.tmp/t008-invalid.yml` 做正/负配置启动验证（4317/4319，均已释放）；T009 已运行 `pnpm typecheck`、`pnpm exec vitest run tests/unit/contracts`（6 文件 / 34 用例）、全量 `pnpm test`（8 文件 / 44 用例）与 `pnpm build`；T010 已运行 `pnpm typecheck`、`pnpm exec vitest run tests/component/shell`（3 文件 / 13 用例）、全量 `pnpm test`（11 文件 / 57 用例）、`pnpm build`（client 12.0 KiB），并用 `.tmp/t010-verify.mjs` / `.tmp/t010-persist.mjs` 在 `vibe-dev` + headless Edge 验证 tab 打开、页签切换、全屏、收起/重开保留页签、console 0；T011 已运行 `pnpm typecheck`、`pnpm exec vitest run tests/integration/transport`（2 文件 / 26 用例）、全量 `pnpm test`（13 文件 / 83 用例）、`pnpm build`（host 11.8 KiB / client 12.0 KiB），并用 `.tmp/t011-auth.mjs`（raw HTTP 9/9：401/403/200/415）、`.tmp/t011-web.mjs`（headless Edge 页面内 client transport）与 `.tmp/t011-desktop.mjs`（隔离 Desktop `dsh-app://app`）验证；launch 时用 `--patch .tmp/t011-disable-spikes.yml` 临时禁用 s1/s2 同路径路由，未改 profile。T012 已运行 `pnpm typecheck`、全量 `pnpm test`（14 文件 / 89 用例）、`pnpm exec vitest run tests/component/shell`（3 文件 / 13 用例）、`pnpm test:e2e`（3/3，fixture 由 webServer 拉起）与 `pnpm build`（host 11.8 KiB / client 12.0 KiB）；fixture 结束无 LISTENING 残留。T013 已运行 `pnpm typecheck`、`pnpm exec vitest run tests/unit/studio-store`（1 文件 / 10 用例）、全量 `pnpm test`（15 文件 / 99 用例）与 `pnpm build`（host 11.8 KiB / client 12.0 KiB）；临时目录 `.tmp/studio-store-*` 检查无残留。`pnpm test:e2e` 现可用，依赖本机 Edge。T014 已运行 `pnpm typecheck`、聚焦 3 文件 / 19 用例、全量 `pnpm test`（17 文件 / 114 用例）与 `pnpm build`（host 25.8 KiB / client 36.8 KiB），并用 `.tmp/t014-verify.mjs` 在 `vibe-dev` + headless Edge（`--patch .tmp/t014-profile-patch.yml` 临时禁用 s1/s2 同路径路由）两轮启动验证保存、health 同源、非法值提示、重启持久化，console 0；测试生成的 `.vibe/` 已删除，仅 TIME_WAIT。T015 已运行 `pnpm typecheck`、`pnpm test`（17 文件 / 114 用例）、`pnpm build`（host 25.8 KiB / client 36.8 KiB）、`pnpm test:e2e`（3/3）；将 s1/s2 在 `vibe-dev` patch 层持久禁用后，不带 `--patch` 验证 health/`studio.ping`/`studio.settings.get` 均 200；`.tmp/t015-web.mjs`（4327，5 页签 + 设置页 + console 0）与 `.tmp/t015-desktop.mjs`（隔离 Desktop，CDP 9223，真实 desktop profile SHA-256 前后一致，报告写入 `.tmp/logs/t015-desktop.json`）均通过。T016 已运行 `pnpm exec vitest run tests/unit/targets`（3 文件 / 21 用例）、`pnpm typecheck`、全量 `pnpm test`（20 文件 / 135 用例）与 `pnpm build`（host 34.6 KiB / client 36.8 KiB）；未新增依赖，未生成 `.vibe`，未启动浏览器或 DSH。T017 已运行 `pnpm exec vitest run tests/integration/web-adapter`（2 文件 / 13 用例，真实 Edge + 临时端口 Vite fixture）、`pnpm typecheck`、全量 `pnpm test`（22 文件 / 148 用例）、`pnpm build`（host 43.4 KiB / client 36.8 KiB，`playwright-core` 保持动态 import）与 `pnpm test:e2e`（3/3）；验证截图 800×600 PNG 白底/文字像素、query 导航、不可达端口 `target_unavailable`、关闭后无 `playwright_chromiumdev_profile` 的 msedge 进程、可重启为 `fixture-2`；用真实 Playwright 缺可执行文件错误验证 Edge 缺失映射。未新增依赖。T018 已运行 `pnpm tsx spikes/s8/run.ts`（`overall: PASS`；启动 HTTP 中位 417 ms；treekill 3/3 无存活；`cmd.exe` 中转遗留 1 个 vite node 并占端口、按 PID 清理成功；端口冲突 exit 1 且 stderr 可读；结束残留进程 0、监听端口 0）与 `pnpm exec tsc --noEmit`（0 error）；原始数据 `.tmp/logs/s8-results.json`，报告 `spikes/s8/REPORT.md`；未新增依赖、未启动 DSH/浏览器。T019 已运行 `pnpm exec vitest run tests/integration/supervisor`（2 文件 / 23 用例，全部假进程）、全量 `pnpm exec vitest run`（24 文件 / 171 用例）、`pnpm typecheck`（0 error）、`pnpm build`（host 67.4 KiB / client 36.8 KiB），并用 `.tmp/t019-manual.ts` 对真实 Vite 8.3.5 + `fixtures/vite-basic` 验证：启动 ready 532 ms、日志含 `Local:`/`ready at`；重启 run=2/新 PID/旧日志已清；停止 `portReleased:true`、`survivors:[]`、端口关闭、无残留 node.exe；端口冲突 ~1.6 s 返回 `preview_failed`/`port_in_use`；结果 `.tmp/logs/t019-manual.json`，`pass: true`；未新增依赖、未启动 DSH/浏览器。T022 已运行 `pnpm exec vitest run tests/integration/input tests/component/preview`（4 文件 / 39 用例）、全量 `pnpm test`（32 文件 / 238 用例）、`pnpm typecheck`（0 error）、`pnpm build`（host 100.5 KiB / client 72.2 KiB）；手动 Host（`.tmp/t022-host.mjs`，真实 Edge + Vite fixture）、Web（`.tmp/t022-web.mjs`，DSH 4332 + 回环表单，CDP IME 模拟）与隔离 Desktop（`.tmp/t022-desktop.mjs`，CDP 9223）均 `ok:true`；报告 `.tmp/logs/t022-{host,web,desktop}.json`。结果：提交 `你好，世界` 且无中间态请求，强制 text 请求 500 后出现限制提示、解除后恢复，粘贴整段送达；网络延迟最大 8.6 ms（Host）/ 15.7 ms（Web）/ 59.6 ms（Desktop）；目标 Edge 全退、真实 `desktop` profile 未改、无意外 console error。未新增依赖；结束时 4326/4327/4332/9223 均无 LISTENING。T023 已运行 `pnpm exec vitest run tests/integration/console tests/component/preview/console-drawer.test.tsx`（3 文件 / 22 用例）、全量 `pnpm test`（35 文件 / 260 用例）、`pnpm typecheck`（0 error）、`pnpm build`（host 116.1 KiB / client 83.4 KiB）；手动 Host（`.tmp/t023-host.mjs`，真实 Edge + Vite fixture，`.tmp/logs/t023-host.json`，`ok:true`）验证 info/warn/error 与异步 throw、500 条上限（510 条输入后 `lastSeq=517`、`dropped=17`）、clear 后 seq 不变与续号；停止后目标 Edge 全退；未新增依赖、未启动 DSH/Desktop。

> 命令更正（2026-10-26）：`todo.md` 中 `pnpm test -- <path>` 的写法不会过滤，vitest 会把 `--` 后的路径当普通参数跑全量。需要只跑某个目录时用 `pnpm exec vitest run <path>`。

---

## 10. 本次退出状态（2026-10-28）

- 分支 `task/m2-target-model`：已推送到 `92ecc32`；`9c19501`、`b7cde55` 与本次方向文档提交在本地（GitHub 连接重置，推送失败待重试）。T016–T024 已提交（T023 `8c2a9bc` + 文档 `83edc9d`，T024 `5027a98`）；T025 已提交 `3b29b6f`；T026 G2 评审只改文档，无产品代码。
- **2026-10-28 界面方向定稿**：新增 `docs/2026-10-28-界面与项目方向.md`（Layout v2 + U01 验收 + P1–P7 项目方向 + 防跑偏约束）；`tasks/todo.md` 在 T027 前插入 **U01 预览界面精简**（总数 62），M3 依赖改为 G2 + U01。无产品代码变更，未跑测试（仅文档/任务清单）。
- **T026 G2 通过**：三端 1280×800 实测 Host 25.8–25.9 fps / Web 24.4 fps / 隔离 Desktop 25.0 fps；点击/键入/滚轮、Console/Network 抽屉、停止清理（1357/2940/4886 ms、无孤儿）均通过；真实 desktop profile 哈希未变。
- **T023 完成**：新增 `src/host/preview/console.ts`（独立 CDP 会话、`Runtime.enable` 前挂 `consoleAPICalled`/`exceptionThrown`、500 条 / 64 KiB ring buffer、单调 `seq`、脱敏/截断、`stop()` 清理）与 `src/client/preview/ConsoleDrawer.tsx`（增量轮询、去重、过滤、清空、错误提示）；contracts 新增 `preview.console.list`/`preview.console.clear`；Web adapter `console: true`；采集失败只降级能力、不阻断预览。聚焦 3 文件 / 22 用例、全量 35 文件 / 260 用例、typecheck 0 error、build host 116.1 KiB / client 83.4 KiB；真实 Edge 手测 `ok:true`（`.tmp/logs/t023-host.json`），停止后 Edge 全退。
- **T024 完成**：新增 `src/host/preview/network.ts`（独立 CDP 会话、`Network.enable` 前挂四类事件、300 条 / 256 KiB ring buffer、revision 游标、header/URL 脱敏、4xx/5xx 标记、body 按需 64 KiB 截断、`stop()` 清理）与 `src/client/preview/NetworkDrawer.tsx`（500 ms 增量轮询、按 id 原位更新、Failed 过滤、body 懒加载与缓存、清空、错误提示）；contracts 新增 `preview.network.list`/`clear`/`body`；Web adapter `network: true`；采集失败只降级能力、不阻断预览。聚焦 3 文件 / 27 用例、全量 38 文件 / 287 用例、typecheck 0 error、build host 134.2 KiB / client 102.1 KiB；未做真实 Edge 手测。
- **T025 完成**：contracts 新增 `preview.session.navigate`/`reload`/`viewport`/`preview.targets` 与 `kind` 快照；host 会话服务迁到 `src/host/preview/session.ts`（`checkHealth()` 由 snapshot/stream/start 触发，断线置 `failed` + `target_unavailable`，不自动重连；重启先 `release()`；reload 回退 navigate；viewport 保留 DPR）；Web adapter 增加 reload/setViewport/isAlive；client 新增 `Toolbar.tsx`、`local-url.ts`、`lifecycle.ts`，Canvas 1 s 状态轮询 + 500 ms 帧统计 + 崩溃提示/重启；Shell 卸载才 stop。聚焦 3 文件 / 14 用例、全量 41 文件 / 301 用例、typecheck 0 error、build host 140.5 KiB / client 115.1 KiB；Host 真 Edge `.tmp/logs/t025-host.json` 与隔离 Desktop `.tmp/logs/t025-desktop.json` 均 `ok:true`：崩溃 101 ms 检出且不自动重启、重启成功、Desktop 切 tab 会话保留、停止后 4471/3820 ms 内进程全退且无孤儿、真实 profile 哈希未变；T023/T024 抽屉在真实载体有数据。
- 环境沿用 M1 结论：`vibe-dev/cordis.patch.yml` 已持久禁用 `vibe-s1-spike`/`vibe-s2-spike`；真实 `desktop`/`web` profile 未改。M1 已合并入 `main`（`d1f4053`）。
- 下一会话直接粘贴第 5 节启动语；从 T027 拾取 overlay 与选择器开始（M3 开工），按 `tasks/todo.md` 的 T027 验收做注入脚本、Shadow DOM overlay、hover/click、Esc、Alt+Click 与选择器生成。
