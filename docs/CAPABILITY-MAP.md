# Capability Map: VibeCoding Studio

> 状态：**已批准（2026-10-25）**
> 来源：[SPEC-vibecoding-studio.md](./SPEC-vibecoding-studio.md) 第 4 节
> 用途：模块边界、依赖方向、构建顺序的稳定索引。下游计划、任务与模块 spec 都按这里的 module id 选择工作。
> 变更规则：module id 一经批准不再重命名；新增/合并/拆分模块必须先改本文件并重新评审。

---

## 1. 模块表

| Module id | 职责 | 依赖 | 阶段 | 公开边界 | 对应需求 |
|---|---|---|---|---|---|
| `studio-contracts` | 跨模块类型、ID、错误码、能力声明、标注 schema、事件 | 无 | A | 纯类型与纯函数，无运行时服务 | FR-AGENT-02/09/10、FR-SEC-05 |
| `studio-shell` | 右栏 tab、内部页签、目标切换、设置、状态、持久化、i18n、快捷键 | contracts | A | 客户端组合根；不实现预览/API 细节 | FR-SHELL-01..07 |
| `target-adapters` | 目标配置、发现、进程/端口生命周期、adapter 注册表 | contracts | A（Web/API） | `TargetAdapter` / `TargetSession` | FR-PRE-02/03、FR-TARGET-01..09 |
| `preview` | 实时画面、输入转发、截图、控制台、网络、导航、视口 | contracts, target-adapters | A（Web） | `PreviewSession` 服务 | FR-PRE-01..10 |
| `visual-inspect` | 拾取 overlay、选择器、DOM/组件/源码、区域/多选、标注模型 | contracts, preview | A（元素）/B（区域） | `InspectService` + `Annotation` | FR-PICK-01..10 |
| `api-workbench` | HTTP 客户端、集合、环境、密钥、历史、OpenAPI/cURL、断言 | contracts | A（基础）/B（断言） | `ApiService` | FR-API-01..12、FR-JOINT-03/04 |
| `verify-loop` | 检查项、结果、截图对比、改动关联 | contracts, preview, visual-inspect, api-workbench | A（基础）/B（增强） | `VerifyService` | FR-VERIFY-01..07 |
| `agent-integration` | 工具、命令、preset、skill、hooks、composer handoff、上下文预算 | contracts, preview, visual-inspect, api-workbench, verify-loop | A（工具/handoff）/B（增强） | 面向模型的工具与命令 | FR-AGENT-01..10 |

> 说明：`studio-shell` 是客户端组合根，会 import 各模块的公开面板组件；各模块不反向 import shell。运行时服务通过 `ctx` 访问，构建期依赖以 contracts 为准。

---

## 2. 依赖方向

```
                    ┌──────────────────┐
                    │ studio-contracts │
                    └────────┬─────────┘
        ┌────────────────────┼─────────────────────┐
        ▼                    ▼                     ▼
  studio-shell        target-adapters        api-workbench
                             │                     │
                             ▼                     │
                         preview                   │
                             │                     │
                             ▼                     │
                     visual-inspect                │
                             │                     │
                             └──────────┬──────────┘
                                        ▼
                                   verify-loop
                                        │
                                        ▼
                                agent-integration
```

规则：

- 箭头只指向下方；禁止反向 import。
- `preview` 不依赖 UI，也不依赖具体 adapter；只消费 `TargetSession` 能力。
- `visual-inspect` 不直接操作 Playwright；通过 `preview` 的公开能力工作。
- `api-workbench` 不依赖 `preview`；抓包回放通过 contracts 中的事件/ID 协作。
- `agent-integration` 只依赖各模块的公开服务接口，不 import 内部实现。
- `verify-loop` 不反向依赖 `agent-integration`；`vibe_verify` 工具在 `agent-integration` 里薄封装 `VerifyService`。
- 出现双向依赖时：合并模块，或把共享契约下沉到 `studio-contracts`；不允许“先互相 import 再说”。

---

## 3. 构建顺序

1. `studio-contracts`
2. `studio-shell` 骨架
3. `target-adapters` + `api-workbench`（可并行）
4. `preview`（Web）
5. `visual-inspect`
6. `verify-loop`
7. `agent-integration`
8. 端到端联调、加固、发布

> `api-workbench` 与 `preview` 无强依赖，可并行；`agent-integration` 最后接入，避免为工具 schema 反复改核心。

---

## 4. 打包与部署边界

首版：**一个 npm 包，多个子路径入口**。

```
dsh-vibecode-studio            → host 核心（studio/targets/agent）
dsh-vibecode-studio/preview    → host 预览插件（可独立禁用）
dsh-vibecode-studio/api        → host API 插件（可独立禁用）
dsh-vibecode-studio/client     → client bundle
dsh-vibecode-studio/preset     → agent preset
skills/…                       → bundled skills
```

- 单包降低安装、升级、兼容性检查成本。
- 预览/API 作为独立 Cordis 行按需启用。
- 内部按 `src/{contracts,host,client,shared}` 隔离；拆分多包时 contracts 已就位。

---

## 5. 明确不属于模块的东西

以下放在 `shared/`、`tests/` 或构建脚本里，不单独占 module id：

- UI 基础组件/样式 tokens（优先复用 DSH 视觉语言，不新造设计系统）。
- 测试 fixture 应用、假 adapter、E2E harness。
- 构建脚本、打包配置、发布脚本。
- 文档与示例。

---

## 6. 批准记录

- 2026-10-25：用户回复“批准”，接受 8 个模块、依赖方向、构建顺序与 MVP 切分。
- 后续变更：在本文件追加变更记录，并同步更新 SPEC 第 4 节。
