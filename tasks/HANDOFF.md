# VibeCoding Studio — 会话交接

> 更新时间：2026-10-26
> 用途：清理/切换对话后，新会话从这里恢复，不依赖旧聊天记录。
> 当前阶段：**Phase 4 实现（M0/G0 已通过，M1 进行中）**；T001–T010 已完成，下一项 T011 Connection 传输骨架。

---

## 1. 一句话状态

DSH 的 VibeCoding Studio 插件已完成需求/可行性 SPEC、能力地图、实现计划，任务清单已批准。**T001 S1 传输 spike 已通过**：Web 与 Desktop 的 pull/stream 均达到 30 fps，10 min stream soak 无断流，选定 stream 为主、pull 为回退。证据见 `spikes/s1/REPORT.md`。**T002 S2 composer handoff spike 已通过**：右栏通过 `conversation.input.left` 的公开 `inputActions` 写入文本，不自动提交；文本/PNG 剪贴板在 Web/Desktop 可用；`createDrafts` 非公开且附件跨会话丢失，MVP 只做剪贴板回退。证据见 `spikes/s2/REPORT.md`。**T003 S3 screencast + 输入 + 中文 spike 已通过**：headless 98.7 fps / headful 98.3 fps（unique 同值），输入最大 26.8/25.2 ms，中文 `insertText`/逐字 `type`/模拟 IME 均正确，焦点/Tab/Esc 正常。限制：真实系统 IME 待 T022 手测；screencast 需在 T020 限速。证据见 `spikes/s3/REPORT.md`。**T004 S4 拾取 + 源码 spike 已通过**：React/Vue/Svelte 各 10/10，合计 30/30（100%），行号精确、选择器唯一 30/30、点击泄漏 0、Esc 正常、0 console/pageerror；React 19 已无 `_debugSource`，改用构建期 `data-inspector-*`；Vue 读 vnode `__v_inspector`；Svelte 读 `__svelte_meta`。证据见 `spikes/s4/REPORT.md`。**T005 G0 评审已通过（GO）**：stream 为主、pull 为回退；中文走隐藏 textarea + `insertText`，T022 系统 IME 手测失败时回退逐字/粘贴；截图只走复制 PNG 手动粘贴；源码按三框架适配、未命中降级选择器/DOM。无阻塞，证据见 `spikes/G0.md`。**T006 包脚手架已完成**：根包改为 `dsh-vibecode-studio@0.1.0`，`pnpm install/typecheck/test/build` 全绿，host 产出 ESM `lib/index.js`。**T007 client loader 已完成**：`lib/client.js` 为 `__ModuleLoader__` 包装，link 进 `vibe-dev` 后右栏菜单出现 Vibe Studio，hello 面板渲染、React 计数 0→1、client.js 200、console 0、无 loader 报错（Web）；Vitest smoke 4/4。**T008 host Config 已完成**：`Config`（5 项）+ `resolveConfig()` 语义校验，`apply()` 通过 `ctx.provide('vibeStudio', { config })` 注册服务；`--dump-config` 含 `vibe-studio`/包名，非法 `logLevel` 启动报 `ValidationError` 且插件不激活，默认配置 20 s 启动无 warning/error；`pnpm typecheck` 0 error、Vitest 10/10、`pnpm build` 通过；`profiles/vibe-dev/README.md` 记录安装/配置/负例/移除。**T009 Contracts v1 已完成**：`src/contracts/*` 提供 target/session、annotation、element/source、console/network、artifact、品牌 ID、稳定错误码；4 KB 注解/8 KB observe 预算与 UTF-8 安全截断、header/URL/JSON 脱敏、`<untrusted-page-content>` 包裹（先转义再截断）；contracts 单测 6 文件 / 34 用例、全量 8 文件 / 44 用例、typecheck/build 通过，无第三方运行时依赖。**T010 client shell 已完成**：`src/client/shell/*` 提供标题、预览/检查/标注/API 四个内部页签、空/错/加载状态与错误边界，模块级 store 保证收起或重开 tab 后仍停在原页签；`src/client/locales/{en,zh-CN}.json` + `i18n.ts` 骨架（en→key 回退、`{name}` 插值、`zh*`→zh-CN）；headless Edge 实测 guide 开 tab、全屏进出、收起/展开、关闭重开均保留“标注”，client.js 200、console 0；`pnpm exec vitest run tests/component/shell` 3 文件 / 13 用例，全量 11 文件 / 57 用例，typecheck/build 通过（client 12.0 KiB）。下一步 T011 connection 传输骨架。

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
| Phase 4 实现 | `spikes/s1/`–`spikes/s4/`、`spikes/G0.md`、`src/`、`scripts/`、`tests/`、`cordis.patch.yml` | M0/G0 已通过；M1 进行中（T001–T010 完成；下一项 T011） |

任务清单已获批准，按 `tasks/todo.md` 顺序执行；如果发现计划假设不成立，先更新 `plan.md`/SPEC，再继续，不要静默改范围。

---

## 4. 下一步

1. 任务清单已于 2026-10-25 批准，不再重复评审。
2. T001–T010 已完成并记录验证结果；**T005 G0 评审已通过（GO）**，T006 脚手架、T007 client loader、T008 host Config、T010 client shell 均已在 `vibe-dev` Web 验证，T009 contracts 由 34 个单测覆盖。新会话从 **T011 Connection 传输骨架** 开始。
3. 每个任务完成即勾选，并在任务下记录验证结果；G0 已通过，进入 M1；后续门禁 G1–G6 通过后才进入下一阶段。
4. 代码与文档按任务分批提交；私有仓库公开前按 `docs/PUBLISHING.md` 清理机器路径与历史。

---

## 5. 新会话启动语（可直接粘贴）

```
读 tasks/HANDOFF.md 的“一句话状态”“下一步”“环境与路径”和“不可违反的约束”，
任务清单已批准，T001–T010 已完成（G0 通过、host/client 均可在 DSH 加载、Config 可校验、contracts v1 已单测、client shell/右栏 tab 已验证）；只读 tasks/todo.md 中 T011 一节，从 T011 Connection 传输骨架开始。
按 tasks/todo.md 顺序执行，每个任务完成后勾选并记录验证结果；不要通读已批准的 SPEC/plan。
```

---

## 6. 环境与路径

- 项目：`<repo>`
- DSH 安装：`<DSH_ROOT>`
- DSH 数据：`<DSH_ROOT>\home`
- 开发 profile：`vibe-dev`（**不要直接改 desktop profile**）
- Node：`24.13.0`；pnpm：`11.21.0`；DSH：`0.2.1-rc.2`
- 会话用量：`pnpm usage:cc`（只读；`--all` 显示全部，`--json` 输出 JSON）
- 浏览器：本机 Edge；Playwright 用 `channel: 'msedge'`，不下载浏览器
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

> T001 已运行 `pnpm typecheck`、`pnpm spike:s1` 与 `spikes/s1/soak.mjs`；T002 已运行 `pnpm typecheck`、`pnpm spike:s2:build` 并完成 Web/隔离 Desktop 手测；T003 已运行 `pnpm typecheck` 与 `pnpm spike:s3 --seconds 10`；T004 已运行 `pnpm typecheck` 与 `pnpm spike:s4`；T005 为人工评审，未重跑 spike；T006 已运行 `pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm build`；T007 已运行 `pnpm typecheck`、`pnpm test`（4/4）、`pnpm build:client`（`lib/client.js` 3.2 KiB），并在 `vibe-dev` Web 用手动/headless Edge 验证 hello tab、client.js 200、console 0；T008 已运行 `pnpm typecheck`、`pnpm test`（10/10）、`pnpm build`（`lib/index.js` 2.4 KiB）、`dsh --profile vibe-dev --dump-config`，并用 `.tmp/t008-valid.yml` / `.tmp/t008-invalid.yml` 做正/负配置启动验证（4317/4319，均已释放）；T009 已运行 `pnpm typecheck`、`pnpm exec vitest run tests/unit/contracts`（6 文件 / 34 用例）、全量 `pnpm test`（8 文件 / 44 用例）与 `pnpm build`；T010 已运行 `pnpm typecheck`、`pnpm exec vitest run tests/component/shell`（3 文件 / 13 用例）、全量 `pnpm test`（11 文件 / 57 用例）、`pnpm build`（client 12.0 KiB），并用 `.tmp/t010-verify.mjs` / `.tmp/t010-persist.mjs` 在 `vibe-dev` + headless Edge 验证 tab 打开、页签切换、全屏、收起/重开保留页签、console 0。`pnpm test:e2e` 在 T012 后可用。

> 命令更正（2026-10-26）：`todo.md` 中 `pnpm test -- <path>` 的写法不会过滤，vitest 会把 `--` 后的路径当普通参数跑全量。需要只跑某个目录时用 `pnpm exec vitest run <path>`。
