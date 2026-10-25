# VibeCoding Studio — 会话交接

> 更新时间：2026-10-25
> 用途：清理/切换对话后，新会话从这里恢复，不依赖旧聊天记录。
> 当前阶段：**Phase 4 实现（Tasks gate 已通过）**；T001 S1 传输 spike 已完成，下一项 T002；尚未写产品代码。

---

## 1. 一句话状态

DSH 的 VibeCoding Studio 插件已完成需求/可行性 SPEC、能力地图、实现计划，任务清单已批准。**T001 S1 传输 spike 已通过**：Web 与 Desktop 的 pull/stream 均达到 30 fps，10 min stream soak 无断流，选定 stream 为主、pull 为回退。证据见 `spikes/s1/REPORT.md`；下一步从 `T002 S2 composer handoff spike` 继续。

---

## 2. 必读文件（按顺序）

1. [docs/SPEC-vibecoding-studio.md](../docs/SPEC-vibecoding-studio.md) — 需求、可行性、MVP 切分、安全边界。
2. [docs/CAPABILITY-MAP.md](../docs/CAPABILITY-MAP.md) — 8 个模块、依赖方向、构建顺序。
3. [tasks/plan.md](./plan.md) — D1–D12 技术决策、M0–M6、G0–G6、S1–S8。
4. [tasks/todo.md](./todo.md) — 61 个可执行任务、验收、验证命令、文件。
5. [docs/dsh-plugin-ecosystem-analysis.md](../docs/dsh-plugin-ecosystem-analysis.md) — DSH 插件生态与扩展点依据（需要时查，不必通读）。

---

## 3. 当前 Gate 状态

| 阶段 | 产物 | 状态 |
|---|---|---|
| Phase 0 能力地图 | `docs/CAPABILITY-MAP.md` | 已批准（2026-10-25） |
| Phase 1 SPEC | `docs/SPEC-vibecoding-studio.md` | 已批准（2026-10-25） |
| Phase 2 计划 | `tasks/plan.md` | 已批准（2026-10-25） |
| Phase 3 任务 | `tasks/todo.md` | 已批准（2026-10-25） |
| Phase 4 实现 | `spikes/s1/`、`packages/`（后续） | 进行中（T001 完成；下一项 T002） |

任务清单已获批准，按 `tasks/todo.md` 顺序执行；如果发现计划假设不成立，先更新 `plan.md`/SPEC，再继续，不要静默改范围。

---

## 4. 下一步

1. 任务清单已于 2026-10-25 批准，不再重复评审。
2. T001 已完成并记录验证结果；新会话从 **T002 S2 composer handoff spike** 开始。
3. 每个任务完成即勾选，并在任务下记录验证结果；G0–G6 门禁通过后才进入下一阶段。
4. 代码与文档按任务分批提交；私有仓库公开前按 `docs/PUBLISHING.md` 清理机器路径与历史。

---

## 5. 新会话启动语（可直接粘贴）

```
读 tasks/HANDOFF.md，
任务清单已批准，T001 已完成；从 T002 S2 composer handoff spike 开始。
按 tasks/todo.md 顺序执行，每个任务完成后勾选并记录验证结果。
```

---

## 6. 环境与路径

- 项目：`<repo>`
- DSH 安装：`<DSH_ROOT>`
- DSH 数据：`<DSH_ROOT>\home`
- 开发 profile：`vibe-dev`（**不要直接改 desktop profile**）
- Node：`24.13.0`；pnpm：`11.21.0`；DSH：`0.2.1-rc.2`
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
- MVP 不做小程序/原生桌面/区域多选/截图附件（除非 S2 通过）。
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

> T001 已运行 `pnpm typecheck`、`pnpm spike:s1` 与 `spikes/s1/soak.mjs`；`pnpm test` / `pnpm build` / `pnpm test:e2e` 等产品脚手架命令在 T004 之后逐步可用。
