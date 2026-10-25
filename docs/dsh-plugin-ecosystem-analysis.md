# DeepSeek Harness 插件生态逆向分析

> 分析日期：2026-10-25  
> 目标机器：Windows 11；DSH CLI/Web `0.2.1-rc.2`；DSH Desktop（Electron，`app.asar` 182,434,783 字节）  
> 结论先行：DSH 是真正的 Cordis 组合式 Agent Harness。“一切皆插件”不是口号——Web UI、侧栏、设置、插件市场、Agent Preset 本身都是插件行。做 VibeCoding 插件，正确形态是 **bundle（宿主插件 + Agent Preset + Skills + 可选 Web 面板）**，而不是单个 tool。

---

## 0. 结论摘要

1. **插件的最小单位是 npm 包 + Cordis patch**。包通过 `dsh.bundle.patch` 声明自己的 YAML patch；DSH 按 profile 的 bundle 顺序叠加 patch，最后叠用户 patch，形成一棵 Cordis 插件树。
2. **可扩展面不止 tools**：tools、commands、skills、hooks、session projections、Agent presets、Web UI slots、设置页、主题、模型/搜索 provider 都是公开接缝。只做 tool 会错过 DSH 最有价值的部分。
3. **Agent 的工具集是 per-preset 组合的**，不是全局注册。`dsh-web-app` 把工具行禁用，交给 `standard` / `ptc` / `minimal` / `cordis` 四个内置 preset 各自声明。因此 Vibe 插件应提供自己的 preset，而不是把工具塞进全局。
4. **生态已经很大**：社区 catalog 收录 6,896 条，其中 3,540 条有 npm 索引；23 个分类。`dshmarket` 1.69.0 是事实上的市场 UI，`awesome-dsh-plugin` 是上架入口。
5. **编码类竞品已存在**：`dsh-super-code`（任务/团队/记忆）、`spec-wave`（spec 门禁）、superpowers 系（skills）等。空白不在“更会写代码的 agent”，而在 **可视化、可回滚、带预览的 Vibe 迭代闭环**。
6. **推荐路线**：先做 agent-only 的 Vibe preset（5 个工具 + 2 个 skills），验证后再加右侧栏 Studio 面板；复用官方 `workspace-changes`、`todo`、`present`、`jobs`，不要重造 diff/任务/终端/文件树。

---

## 1. 本机基线

### 1.1 安装与版本

| 项 | 值 |
|---|---|
| CLI/Web 安装目录 | `F:\Deepseek-Harness\DH` |
| `@deepseek-ai/dsh` | `0.2.1-rc.2` |
| Desktop | Electron 壳，`F:\Deepseek-Harness\DH\Desktop\resources\app.asar`，182,434,783 字节 |
| Node（全局） | `v24.13.0` |
| `DSH_HOME` | `F:\Deepseek-Harness\DH\home`（由 `bin\dsh.cmd` 设置） |
| 默认工作区 | `F:\Deepseek-Harness\Workspaces\default-workspace` |

`bin\dsh.cmd` 还把 `DSH_AGENTS_HOME`、npm cache、TEMP/TMP 都放在 F 盘，符合本机 `AGENTS.md` 的“避免 C 盘存储”约束。开发时应始终通过这个 `dsh.cmd` 启动，才能继承同一套 `DSH_HOME`。

### 1.2 两个 profile

DSH 的安装隔离单位是 profile：

```
F:\Deepseek-Harness\DH\home\profiles\
├─ desktop\   桌面端使用（由桌面 App 的插件管理器管理）
└─ web\       命令行 dsh web 使用
```

`desktop` 的 bundle 顺序：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dshmarket",
        "dsh-whale-widget",
        "@linxin666/dsh-web-all"
      ]
    }
  }
}
```

已装第三方包：`dshmarket@1.69.0`、`dsh-whale-widget@0.4.2`、`@linxin666/dsh-web-all@0.4.8`。

`desktop` 的用户 patch 只有几条 UI 配置和一个被禁用的宠物插件；`web` 更干净。**开发不要直接改 `desktop`**：桌面 App 运行时会管理这个 profile，命令行写入可能被覆盖。用新 profile（如 `vibe-dev`）或 `web` 做开发验证。

### 1.3 对开发的含义

- `dsh plugin --profile <name> ...` 会把参数透传给 profile 目录里的 pnpm；profile 首次使用会自动初始化。
- 本地开发推荐：

```sh
F:\Deepseek-Harness\DH\bin\dsh.cmd plugin --profile vibe-dev add link:F:\Project\DSH_vibecode_studio
F:\Deepseek-Harness\DH\bin\dsh.cmd --profile vibe-dev --dump-config
F:\Deepseek-Harness\DH\bin\dsh.cmd --profile vibe-dev web
```

- `--dump-config` 不启动宿主，只打印组合后的树，是最便宜的 patch 校验手段。
- 桌面端最终安装应走 App 的 **设置 → 插件**，不要在 App 运行时用 CLI 改 `desktop`。

---

## 2. 逆向方法与证据

| 方法 | 证据 |
|---|---|
| `rea analyze-javascript-application` 静态分析 `app.asar` | 已完成（exit 0，最终 JSON 约 511 MB）；中间日志与结果确认桌面端打包的是同一套 `dsh/node_modules/@deepseek-ai/*` 包。本报告结论已与本机可读包交叉验证，不依赖该 JSON 的逐条语义结果 |
| 本机包源码/文档 | `F:\Deepseek-Harness\DH\node_modules\@deepseek-ai\*`（100+ 包）与 profile `node_modules` |
| 官方仓库文档 | `docs/user/develop/basic/*`、`docs/cookbook/extension-cookbook.zh.md`、`.agents/notes/...` |
| 运行配置 | `dsh-web-app/cordis.patch.yml`、`presets/*.patch.yml`、`dsh-base/cordis.patch.yml` |
| 社区市场数据 | `dsh-plugin-catalog` 的 `index.json` / `plugins.json`、`dshmarket` README、npm 元数据 |

网络说明：`raw.githubusercontent.com` / `cdn.jsdelivr.net` 在本机被重置，但 npm registry 和 `gh api` 可用，因此没有使用梯子。后续开发所需依赖均可从 npm 正常获取。

---

## 3. 运行时架构：一切皆插件

### 3.1 组合链路

```
Electron Desktop / dsh CLI / dsh web
        │
        ▼
profile（$DSH_HOME/profiles/<name>）
  package.json  dsh.profile.bundles   ← 有序 bundle 列表
  cordis.patch.yml                    ← 用户 patch 层
        │
        ▼
bundle 层（npm 包，各自声明 dsh.bundle.patch）
        │  按 bundles 顺序叠加
        ▼
$DSH_HOME/cordis.patch.yml（全局用户 patch）
        │
        ▼
--patch 覆盖层（可重复）
        │
        ▼
Cordis Loader 组合出插件树
  ├─ host 插件（Node）
  ├─ client 插件（浏览器模块，dsh.client.platform = "web"）
  └─ Agent Preset 注册表
        └─ 每个 Session 的 Agent 组合
             └─ tools / commands / skills / hooks / projections
```

关键点：**profile 是安装与隔离单位，bundle 是分发单位，patch 是组合单位，Cordis 是运行时单位，Agent preset 是会话单位。** 五层不要混。

### 3.2 Profile / Bundle / Patch

一个 bundle 的最小声明：

```json
{
  "name": "dsh-vibecode-studio",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./agent": "./lib/agent.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "skills", "locales", "cordis.patch.yml", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["..."] }
  },
  "engines": { "dsh": ">=0.2.1-rc.2 <0.3.0" }
}
```

patch 文件是一个 YAML 数组，两种基本操作：

```yaml
# 1) 按 id 覆盖已有行（config 是整块替换，不是深合并）
- id: ui-chat
  config:
    transcriptView: standard
    performanceUsage: detailed

# 2) 插入新行
- insert:
    - id: vibe-studio
      name: dsh-vibecode-studio
      config:
        stateDir: ''
```

常见坑：

- **config 整块替换**：只想改一个字段也要把整块 config 重写，否则其余字段丢失。
- **行 id 是覆盖地址**：`- id: x` 必须与已有行 id 完全一致；`insert` 的新行自己取名。
- **顺序有意义**：bundle 按 `dsh.profile.bundles` 顺序叠加，越靠后越能覆盖前面的行。市场提供拖拽调序不是装饰。
- **`!!js` 在宿主求值**：官方 preset 用它做平台分支，例如 `disabled: !!js process.platform === 'win32'`。
- **`cordis:group`**：用 `group: true` + `isolate` 创建子组合，隔离 `planMode`、`compaction`、`delegation` 等服务作用域。Vibe preset 可借用这个机制，但 MVP 不必。
- **启动是全有全无**：一个插件加载失败，整个宿主退出。patch 越少越稳；可选依赖用 `disabled` 兜底。

### 3.3 启动、HMR、兼容性

- 宿主插件和 patch 改动通常约 1 秒内 HMR 重组合；客户端 bundle 改动一般刷新页面即可。
- 客户端 bundle 必须已构建出 `lib/client.js`；缺失会导致激活失败并给出构建提示。
- 兼容性：`engines.dsh` 是 SemVer 范围；未声明时回退到 `@deepseek-ai/dsh-*` peer 范围。profile 的 `compatibility.json` 可做精确版本豁免。pnpm 的构建脚本默认禁止执行，需要 `allowBuilds` 显式放行。
- **预发布版本的范围要实测**：SemVer 对 prerelease 的匹配规则容易踩坑（例如 `>=0.2.1-rc.2 <0.3.0` 对未来 `0.2.2-rc.1` 是否匹配，取决于解析器实现）。发布前用宿主的兼容性检查或 `dsh plugin add` 实测，不要只看理论范围。
- 发行时最好**预构建** `lib/` 与客户端 bundle，避免用户侧构建脚本审批。
- 市场会做 GitHub 连通性检查、npmmirror 回退、待重启提示；插件自身不应假设 GitHub 可达。

### 3.4 宿主插件与客户端插件

宿主插件（Node）：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'vibe-studio'
export const inject = ['tools', 'commands', 'sessionProjections']

export function apply(ctx: Context, config: Config) {
  // 注册 tools / commands / hooks / projections / HTTP routes
}
```

客户端插件（浏览器）：

```json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-locale"
      ]
    }
  }
}
```

构建产物是一个注册 factory 的脚本：

```js
window.__ModuleLoader__.load({
  id: 'dsh-vibecode-studio',
  factory: (require) => {
    // React 组件、slot 注册、locale 注册
    return { apply }
  }
})
```

客户端模块系统的共享模块表由外壳冻结（React、UI primitives 等）；`dsh.client.external` 只用于声明基座之外的精确请求。客户端插件不是普通 ESM 入口，**构建格式必须匹配 `window.__ModuleLoader__`**。

### 3.5 Agent preset 是第二层组合

`@deepseek-ai/dsh-agent-preset` 的 config：

```yaml
- id: preset-vibe
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: vibe
    name: Vibe Coding
    description: Fast spec → build → verify loop with checkpoints and preview.
    order: 10
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: |
            You are a vibe coding agent...
      - id: tool-fs
        name: '@deepseek-ai/dsh-tool-fs'
      - id: vibe-agent
        name: dsh-vibecode-studio/agent
```

要点：

- **preset 行本身是普通插件行**，子插件也是普通行；`cordis:group` 可用。
- 内置 preset 是 `standard`（默认）、`ptc`、`minimal`、`cordis`。`standard` 的工具行在 `dsh-web-app` 里被禁用，由 preset 重新声明。
- 不要覆盖 `preset-standard` 的 config：patch 是整块替换，会复制整份标准 preset 并随宿主升级漂移。**新建 preset**。
- 不要改 `agent-preset-registry.default`，让用户在会话里选择 Vibe。
- preset 适合放：persona、官方工具子集、我们的 agent 插件、bundled skills provider、compaction。
- 工具 schema 会增加 prompt token；MVP 控制在 5 个左右。

---

## 4. 插件扩展面全景

| 需求 | 接缝 | 关键点 |
|---|---|---|
| 模型可调用的动作 | `ctx.tools.register(defineTool(...))` | JSON Schema 参数/输出；`execute(args, exec)`；`render`；`presentCall/presentResult`；`timeoutMs` |
| 用户斜杠命令 | `ctx.commands.register(...)` | agent 作用域；`definitionId`；handler |
| 方法论/可复用指令 | `SKILL.md` + `ctx.skills.register` / filesystem provider | frontmatter 必须有 `name`、`description`；渐进披露；`bundledSkillDir` |
| 流程门禁/观测 | hooks：`tools/pre-execute`、`tools/post-execute`、`agent/pre-step`、`agent/turn-stopping`、`agent/created` | allow/deny/ask；不决策必须 `next()`；`ctx.tools.guard` 是单调硬拒 |
| 持久 UI 状态 | `ctx.sessionProjections.register(...)` | 按 Session 持久；`stateSchema`/`init`/`apply`/`wire` |
| Web 面板 | client slots / sidebarRightTabs | 右侧栏 tab 是最适合 Studio 的落点 |
| Agent 组合 | `@deepseek-ai/dsh-agent-preset` | 新建 preset，不要改标准 preset |
| 设置页 | `ctx.configForms` / `settings.section` | 宿主配置 schema 自动渲染 |
| 长任务/后台进程 | 官方 `tool-jobs`、`tool-bash`、`tool-pwsh`、terminal | 优先复用 |
| 交付文件 | 官方 `present` 工具 | 文件卡片、源文件打开 |
| 每轮改动文件/diff | 官方 `@deepseek-ai/dsh-workspace-changes` | `summary(sessionId, seq)` / `diff(...)`，不要重造 |
| 主题 | `ctx.theme` / client theme | 用 `--dsw-*` token |

### 4.1 Tools

官方最小例子：

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'vibe_checkpoint',
  description: 'Create a restore point for the current workspace before risky changes.',
  parameters: {
    label: { type: 'string', required: true, description: 'Short label for the checkpoint' },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        files: { type: 'number' },
      },
      required: ['id', 'files'],
    },
    render: (_args, value) => [{ type: 'text', text: `Checkpoint ${value.id} (${value.files} files)` }],
  },
  async execute(args, exec) {
    const cwd = await ctx.workingDirectory.ensure(exec.agent!, exec.signal)
    return createCheckpoint(cwd, args.label)
  },
}))
```

工具执行流水线：

```
tools/pre-execute (allow/deny/ask)
  → ctx.tools.guard() 单调守卫
  → tools/execute (超时/重试包装)
  → tools/post-execute (检查/替换/附加 context)
  → finalizeContent
  → tools/result (只观测)
```

设计建议：

- 工具结果只放**模型需要的最小摘要**；检查点列表、完整 verify 日志、diff 放 projection / HTTP 状态里供 UI 读取，避免每轮灌 token。
- `exec.agent` 能拿到 Session；用 `ctx.workingDirectory.ensure(exec.agent, exec.signal)` 解析项目 cwd，不要用宿主进程的 `process.cwd()`。
- 大输出用 `output.schema` + `render` 截断；完整内容落盘。
- 破坏性工具（restore）要求显式 `confirm`，并在工具描述里写清楚。

### 4.2 Commands

```ts
ctx.commands.register({
  definitionId: CommandDefinitionId('dsh-vibecode-studio'),
  name: 'vibe',
  description: 'Show the Vibe loop status and next step',
  handler: async (invocation) => {
    const input = invocation.rawInput.trim()
    // invocation.agent / invocation.signal 也可用
    return { /* CommandResult */ }
  },
})
```

命令是用户主动触发的；工具是模型触发的。同一动作（如 checkpoint）应共用 service，命令和工具只做薄封装。

### 4.3 Skills

`SKILL.md`：

```md
---
name: vibe-spec
description: Turn a fuzzy coding request into a short spec with acceptance criteria before editing code.
whenToUse: The user asks for a non-trivial feature or change and no spec exists yet.
---

# Vibe Spec

1. Restate the intent in one paragraph.
2. List 2–5 acceptance criteria that can be checked.
3. Ask only user-owned questions; inspect the repo for discoverable facts.
4. Write the spec with the `vibe_spec` tool.
```

文件系统 provider 的扫描根（按优先级）包括项目 `.dsh/skills`、`.agents/skills`、自定义目录、`$DSH_HOME/skills`、`$DSH_AGENTS_HOME/skills`，以及 `bundledSkillDir`（rank 600）。插件自带 skills 的推荐写法：

```yaml
- id: skill-vibe-bundled
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    providerName: vibe-bundled
    includeDefaultRoots: false
    watch: false
    bundledSkillDir: !!js >-
      (() => {
        const require = process.getBuiltinModule('node:module').createRequire(new URL('package.json', baseUrl))
        return require('node:path').join(require('node:path').dirname(require.resolve('dsh-vibecode-studio/package.json')), 'skills')
      })()
```

这段 `createRequire` 解析是为了兼容 profile 的 hoisted / 嵌套安装布局；`dsh-super-code` 也用了同样的做法。

### 4.4 Hooks 与 guards

```ts
ctx.on('tools/pre-execute', async (exec, next) => {
  const decision = await gate(exec)
  return decision ?? next()
})
```

决策可以是：

- `{ kind: 'allow' }` / `next()`
- `{ kind: 'deny', reason }`
- `{ kind: 'ask', reason }`

经验：

- **硬策略**用 `ctx.tools.guard()`（同步、单调，后续监听器不能翻案）。
- **需要问用户**用 `tools/pre-execute` 返回 `ask`。
- **只观测**用 `tools/result`；不要用 `tools/post-execute` 做纯观测。
- **收尾/证据**用 `agent/turn-stopping`；不要无条件阻止停止。
- 隐藏某个 agent 的工具用 `ctx.tools.restrict()`，不要靠 prompt 约束。

### 4.5 Session projections

`dsh-tool-todo` 是最干净的范例：注册 `todos` projection，`apply` 处理 `todo/write` 与 `turn/start`，`wire` 暴露给客户端。我们的 Studio 可以注册 `vibe` projection：

```ts
ctx.sessionProjections.register({
  key: 'vibeStudio',
  stateSchema,          // stage, spec summary, last run, checkpoint ids
  init: () => initialState,
  apply: (state, event) => { /* 根据 vibe/* 事件更新 */ },
  wire: { viewSchema, /* ... */ },
})
```

不要往里塞大块 diff 或日志；存 id + 摘要，详情走宿主 HTTP 路由。

### 4.6 Web UI slots

关键发现：**右侧栏是最适合 Studio 的扩展点**，不是自己造全屏 overlay。

- `@deepseek-ai/dsh-client-ui-sidebar-right` 提供每 Session 一个停靠面、两种形态（`push` / `fullscreen`）、展开按钮、布局持久化。
- 扩展分两步：
  1. `ctx.sidebarRightTabs.register({ id, kind, title, guide, keepMounted })`
  2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, Body)`
- `guide` 入口会让用户在右侧栏引导页看到 “Vibe Studio” 卡片，解决发现性问题。
- `keepMounted: true` 让 Studio 在切 tab / 切 Session / 收起时保留状态。
- 通过 `ctx.sidebarRight.openTab(kind)` 打开；用户也可以用通用 tab 控件。
- 设置页用 `settings.section` / `settings.plugins.tab`；会话标题角可用 `conversation.session.header.corner` 放一个 Studio 按钮（可选）。

组件层复用 `@deepseek-ai/dsh-client-ui-primitives`（Button、Tooltip、图标）与 `--dsw-*` 主题变量，避免视觉脱节。

### 4.7 Agent presets

见 3.5。补充：preset 的 `plugins` 里可以放 `cordis:group`，例如把 compaction 隔离：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
```

### 4.8 其他可复用能力

- `@deepseek-ai/dsh-workspace-changes`：每轮 git 工作树快照 + 文件工具整文件捕获，`workspace/changes` 事件，`ctx.workspaceChanges.summary/diff`。Web 已有“改动文件卡片”。
- `@deepseek-ai/dsh-tool-present`：声明交付文件，Web 渲染文件卡片。
- `@deepseek-ai/dsh-tool-jobs`：后台任务管理，已有 UI。
- `@deepseek-ai/dsh-tool-todo`：任务清单 projection，Studio 面板可直接读。
- `@deepseek-ai/dsh-plan-mode`：探索/计划模式，可作为可选预设行；与轻量 Vibe 流程可能冲突，MVP 先不加。
- `@deepseek-ai/dsh-tool-subagent`：并行探索/实现；Vibe preset 可选加入。
- `@deepseek-ai/dsh-tool-web`：查文档；注意公开抓取默认不逐次审批，需要门禁就自己加策略。

---

## 5. 生态地图与分发

### 5.1 规模

社区 `dsh-plugin-catalog`（截至 2026-10-25 抓取）：

| 指标 | 数值 |
|---|---|
| `index.json`（npm 可索引） | 3,540 条 |
| `plugins.json`（全量） | 6,896 条 |
| 分类数 | 23 |

分类分布（前 12）：

| 分类 | 数量 | 分类 | 数量 |
|---|---:|---|---:|
| ui | 652 | tools | 482 |
| session | 253 | dev | 232 |
| workflow | 212 | model | 205 |
| usage | 175 | memory | 152 |
| theme | 126 | notify | 125 |
| remote | 122 | skill | 109 |

`dshmarket` README 宣称 4,200+ 插件，是它自己展示的 curated 集合；与 catalog 的全量/可安装统计口径不同，不必强行对齐。

### 5.2 分发渠道

| 渠道 | 作用 |
|---|---|
| npm + `dsh plugin --profile <p> add <pkg>` | 最直接的安装方式；bundle 包声明 `dsh.bundle.patch` |
| `dshmarket`（1.69.0） | 宿主内市场；发现/安装/更新/分组/主题/备份；数据来自 `awesome-dsh-plugin` |
| `awesome-dsh-plugin.com` | 精选列表 + 站点；上架 PR 入口 |
| `dsh-plugin-catalog`（npm） | format 1 索引；可加到 Discover → Index sources |
| 官方 `@deepseek-ai/dsh-plugin-market` | 读取用户配置的索引，暴露 `plugin_market` 工具；默认没有官方索引 |
| `@deepseek-ai/dsh-plugin-manager` | Web 插件页、`plugin_manager` 工具（Creator mode）、构建审批、HMR、版本豁免 |

### 5.3 Market index format 1

根对象：

```json
{
  "format": 1,
  "title": "My Index",
  "description": "...",
  "metadata": {
    "categories": [],
    "labels": [],
    "sortKeys": []
  },
  "plugins": []
}
```

插件条目关键字段：

- `name`
- 本地化 `title` / `description`
- `icon`、`author`、`homepage`、`repository`
- `metadata.category` / `labels` / `keywords` / `sortKeys`
- `dist-tags`
- `versions[]`：`version`、`publishTimestamp`、`source`（`npm` 或 `git`）、`engines.dsh`

安装 spec：`<name>@<version>` 或 `git+<url>.git#<commit>&path:/<path>`。

索引源有 15 秒超时；中国大陆网络下 GitHub Pages 可能超时，`dshmarket` 会优先从 npm 读取同一份目录。

### 5.4 发布清单

1. npm 包名、版本、`engines.dsh`、`dsh.bundle.patch`、`dsh.client`。
2. 预构建 `lib/`、客户端 bundle、skills、locales；`files` 白名单。
3. README（中英）、截图、安装命令、兼容范围、安全说明。
4. 在干净 profile 里 `dsh plugin add` + `--dump-config` + 启动验证。
5. 提交 `awesome-dsh-plugin` PR；市场通常一天内收录。
6. 可选：发布自己的 format 1 索引，供 Discover 添加。

### 5.5 安全与兼容

- 构建脚本默认禁止；预构建可避免用户审批。
- 市场只接受精选列表来源；收录≠背书。
- 不要把 API key 写进插件配置/日志；verify 输出要脱敏。
- 不要假设 `DSH_HOME` 在某个固定盘符；运行时读环境变量。
- Windows 上同时提供 bash/pwsh 分支，patch 里用 `!!js process.platform` 选择。
- 客户端 API 在 rc 版本间可能变化；锁定 peer 范围，并在 CLI 与 Desktop 两端各测一次。

---

## 6. 竞品与空白

### 6.1 相关插件

| 插件 | 定位 | 可借鉴/需避让 |
|---|---|---|
| `dsh-super-code@0.3.7` | 任务导向编码、专家团队、持久任务记忆、目录/声明式 preset、评测 | 最接近的竞品；`preset + host + bundled skill` 的打包方式值得借鉴；不要再造任务/团队层 |
| `spec-wave@3.5.0` | Spec 驱动、P0 门禁（exit 2）、审计轨迹、多宿主 CLI | 证明“纪律”有需求；但 CLI 重、UI 弱；Vibe 应更轻、更可视化 |
| superpowers 系（`dsh-plugin-superpowers` 等） | Skills 库 | 方法论可以复用/兼容，不必重写 |
| `@banana-peeljj12/dsh-trellis` | 任务树/规格 | 参考任务组织，不重复 |
| `dsh-command-code-review` / `@michengai/dsh-code-review` / `dsh-review-checkout` / `dsh-git-review` | 代码审查 | 可集成到 Vibe 的 verify/review 阶段 |
| `dsh-undo-plugin` / `dsh-file-history` | 撤销/文件历史 | 与 checkpoint 有重叠；差异化在“项目级、UI 驱动、恢复前自动快照” |
| `dsh-project-memory` / `dsh-ledger-memory` | 项目记忆 | 可与 spec/决策记录互补 |
| `dsh-ide-workbench` / `dsh-vscode-mode` | IDE 风格工作台 | 说明 UI 需求存在；Vibe 不做编辑器，做迭代驾驶舱 |
| `dsh-cc-ecosystem` | 加载 Claude Code 的 skills/commands/rules/permissions/subagents/hooks/plugins | 兼容层思路；Vibe skills 可保持可移植 |
| `dshmarket` | 市场 UI | 右侧栏/tab/设置页的实战范例 |
| `dsh-whale-widget` | 客户端挂件 | 说明第三方客户端插件可行；但它偏 DOM 注入，Studio 应走标准 slot |

### 6.2 空白

- **可视化 Vibe 循环**：大多数插件是宿主侧能力或单点工具；缺少“Spec → Build → Verify → 预览 → 回滚”的一屏驾驶舱。
- **快速回滚 + 预览**：`workspace-changes` 有 diff，但不是持久检查点；undo 类插件偏文件级，不是项目级时间线。
- **轻量纪律**：spec-wave 很重；Vibe 用户想要“先跑起来，再逐步加验收”，不是每步都过门禁。
- **整合而非替代**：把官方 todo/workspace-changes/present/jobs 和社区的 review/git 插件串起来，比再造一套更有价值。

定位建议：**“VibeCoding Studio = 可视化迭代驾驶舱”**，而不是“另一个更会写代码的 agent”。前者补空白，后者正面撞 super-code。

---

## 7. VibeCoding Studio 方案

### 7.1 产品定位

一句话：**让用户在 DSH 里用自然语言快速做出可运行的东西，并且随时能看见状态、预览结果、回滚到上一个好版本。**

三个支柱：

1. **轻量 Spec**：不写长 PRD，只写目标 + 验收标准；可跳过，但建议写。
2. **安全迭代**：自动/手动检查点；恢复前自动再快照；危险命令门禁。
3. **可见反馈**：右侧栏 Studio 面板展示阶段、任务、改动、检查点、验证结果、预览链接。

### 7.2 三种产品形态

| 形态 | 内容 | 成本 | 风险 | 建议 |
|---|---|---|---|---|
| A. Agent-only | Vibe preset + tools + skills | 低 | 差异化弱，撞 super-code | 作为第一阶段 |
| B. Full Studio | A + 右侧栏面板 + 预览 | 中 | 客户端构建/兼容性 | **推荐，分阶段做** |
| C. Integration layer | 串联 super-code/spec-wave/review/git 插件 | 中 | 依赖第三方 API | 可作为后续 |

推荐 **B，按 A 的路径交付**：先证明工具/流程有价值，再加 UI；UI 只读状态先上线，再加动作。

### 7.3 推荐架构

```
dsh-vibecode-studio（npm bundle）
├─ package.json
│   ├─ dsh.bundle.patch → cordis.patch.yml
│   └─ dsh.client → ./client
├─ cordis.patch.yml
│   ├─ insert: vibe-studio（宿主：HTTP 路由、service、projection）
│   └─ insert: preset-vibe（Agent preset：工具子集 + vibe-agent + bundled skills）
├─ lib/
│   ├─ index.js       宿主插件
│   ├─ agent.js       agent 作用域插件（tools/commands/hooks）
│   ├─ client.js      浏览器 bundle
│   ├─ store.js       状态/检查点/运行记录
│   ├─ checkpoint.js  快照/恢复
│   ├─ verify.js      命令检测/执行/脱敏
│   └─ preview.js     预览进程管理（Phase 2）
├─ skills/
│   ├─ vibe-spec/SKILL.md
│   └─ vibe-verify/SKILL.md
├─ locales/
│   ├─ zh.json
│   └─ en.json
└─ README.md / README.zh.md
```

职责边界：

- **宿主插件**：HTTP 路由、session projection、配置、清理；不注册全局工具。
- **agent 插件**：只在 Vibe preset 内注册 `vibe_*` 工具、命令、hooks；工具通过共享 service 调宿主能力。
- **client 插件**：右侧栏 tab，读状态、触发动作；不做业务逻辑。
- **skills**：方法论，不放确定性逻辑；确定性逻辑放 tools。

### 7.4 Vibe 工作流

```
idle
  │ 用户描述需求
  ▼
spec ── vibe_spec（目标 + 验收标准）
  │
  ▼
build ── agent 编辑；fs 写/改后标记 dirty
  │       vibe_checkpoint（手动/风险前自动）
  ▼
verify ── vibe_verify（检测/运行检查命令）
  │  fail → 回到 build，显示失败摘要
  │  pass
  ▼
done ── 用户接受；present 交付文件；可选 commit
```

规则：

- 阶段是**建议**，不是硬锁；用户可以让 agent 直接改。
- `vibe_verify` 失败后，面板把状态标红，但不阻止继续编辑。
- `vibe_restore` 后自动回到 `build`，并把上次 verify 标记为过期。
- 不做“必须通过 verify 才能停”的强制门禁；用徽标和提示驱动。

### 7.5 工具 / 命令 / 技能清单

MVP 工具（5 个，控制 token）：

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `vibe_status` | 返回阶段、spec 摘要、检查点数、上次验证、是否 dirty | 无 |
| `vibe_spec` | 写入/更新目标与验收标准 | `title`, `goals[]`, `nonGoals[]`, `acceptance[]`, `constraints[]` |
| `vibe_checkpoint` | 创建项目级检查点 | `label` |
| `vibe_restore` | 恢复到检查点 | `id`, `confirm` |
| `vibe_verify` | 运行验证命令并记录结果 | `commands?`, `timeoutMs?` |

Phase 2 工具：

- `vibe_preview`：`start|stop|status`，返回 URL/端口。
- `vibe_review`：基于 spec 审查 diff，输出风险清单。
- `vibe_export`：导出 spec/检查点摘要。

命令：

- `/vibe`：显示状态和下一步（不替代工具）。
- `/vibe-checkpoint [label]`
- `/vibe-restore <id>`
- `/vibe-verify`

Skills：

- `vibe-spec`：把模糊需求收敛成 2–5 条可验收标准；只问用户该决定的事。
- `vibe-verify`：验证前先找项目已有的检查命令；用证据说话；失败要复现和定位。
- 可选 `vibe-review`：按 spec 自审 diff，优先找行为回归/遗漏。

Preset 组成（示意，按实际版本锁定）：

```yaml
- insert:
    - id: preset-vibe
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: vibe
        name: Vibe Coding
        description: Fast spec → build → verify loop with checkpoints and a studio panel.
        order: 10
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |
                You are a vibe coding agent. Move fast, keep changes small, and verify with evidence.
                Use vibe_spec before non-trivial work, vibe_checkpoint before risky changes, and vibe_verify before claiming success.
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
          - id: tool-web
            name: '@deepseek-ai/dsh-tool-web'
          - id: tool-todo
            name: '@deepseek-ai/dsh-tool-todo'
            config:
              allowParallelInProgress: true
          - id: tool-present
            name: '@deepseek-ai/dsh-tool-present'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
          - id: skill-vibe-bundled
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              providerName: vibe-bundled
              includeDefaultRoots: false
              watch: false
              bundledSkillDir: !!js >-
                (() => {
                  const require = process.getBuiltinModule('node:module').createRequire(new URL('package.json', baseUrl))
                  return require('node:path').join(require('node:path').dirname(require.resolve('dsh-vibecode-studio/package.json')), 'skills')
                })()
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: vibe-agent
            name: dsh-vibecode-studio/agent
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
```

### 7.6 Studio 面板

落点：右侧栏 tab，而不是自定义全屏 overlay。

注册：

```ts
export function apply(ctx: Context) {
  ctx.sidebarRightTabs.register({
    id: 'dsh-vibecode-studio',
    kind: 'vibe-studio',
    title: () => 'Vibe Studio',
    guide: [{ id: 'vibe-studio', title: 'Vibe Studio', description: 'Spec, checkpoints, verify, preview.' }],
    keepMounted: true,
  })
  ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: 'dsh-vibecode-studio' },
    StudioPanel,
  )
}
```

面板分块：

1. **阶段条**：Spec → Build → Verify → Done；显示 dirty/verify 过期徽标。
2. **目标与验收**：spec 摘要 + 验收清单；点击可展开详情。
3. **任务**：读官方 `todos` projection；不另建任务系统。
4. **改动**：读 `workspaceChanges.summary`；文件数、+/-；点击打开现有 diff 视图。
5. **检查点**：时间线；Restore 按钮（二次确认）；显示文件数/时间。
6. **验证**：上次命令、耗时、状态、输出尾部；“Run verify” 按钮。
7. **预览**（Phase 2）：URL、启动/停止、在新标签打开；iframe 需先验证 CSP。
8. **空状态**：一句话引导 + 示例 prompt。

交互：

- 只读优先：先上状态展示，再加动作按钮。
- 所有动作走宿主 HTTP 路由；按钮 disable 状态由 projection 驱动。
- 错误显示在面板内，不弹全局 alert。
- 中英双语，跟随 DSH locale。

### 7.7 数据与检查点

推荐存储：

```
$DSH_HOME/vibe-studio/
└─ projects/<projectHash>/
   ├─ state.json          # 当前 spec/stage/lastRun/checkpoint 索引
   ├─ objects/<sha256>    # 内容寻址文件块（检查点去重）
   ├─ checkpoints/<id>.json
   └─ runs/<id>.json
```

可选：在项目内写 `.vibe/spec.md` 作为人类可读的 spec（用户可提交/审查），但**不要把大块快照放进项目**，避免污染仓库和自捕获。

检查点策略对比：

| 方案 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| A. Git 原生（临时 index + `commit-tree` + `refs/vibe/...`） | 去重、快、可审查 | 删除/恢复复杂；LFS/submodule/filter 边界多 | 熟悉 git 后再做 |
| B. 内容寻址文件快照 | 跨平台、无 git 也能用、恢复语义可控 | 大仓库占空间/时间；需处理符号链接/权限 | **MVP 推荐** |
| C. 混合 | `workspace-changes` 负责 diff，B 负责恢复 | 两套路径要一致 | **推荐** |

恢复语义（B）：

1. 恢复前**自动创建 safety checkpoint**。
2. 读目标 manifest，计算当前 manifest。
3. 写回目标中的文件；删除“当前有、目标没有”且位于捕获范围内的文件。
4. 保护 `.git`、`.vibe`、`node_modules`、构建产物目录；绝不删除工作区外路径。
5. 记录 restore run；把 stage 置回 `build`，verify 标记过期。
6. 需要显式确认（工具参数 + UI 二次确认）。

默认排除：`.git`、`node_modules`、`.next`、`dist`、`build`、`out`、`target`、`coverage`、`.venv`、`__pycache__`、`.DS_Store`、`Thumbs.db`、`.vibe-studio`。大小/数量上限可配置；超限时提示用户缩小范围。

### 7.8 验证与预览

验证命令来源：

- 插件配置 `verify.commands`（用户显式指定，优先级最高）。
- 自动检测（只做保守推断）：
  - `package.json` scripts：`typecheck` → `lint` → `test` → `build`（按存在性选择；可配置跑全部）。
  - `pyproject.toml` / `pytest.ini` → `pytest -q`。
  - `Cargo.toml` → `cargo test`。
  - `go.mod` → `go test ./...`。
- 不确定时不要猜；让 agent 先读项目再配置。

执行：

- `spawn` + 超时 + 输出上限；默认继承环境但脱敏常见 token/密钥。
- 逐条记录 exit code、耗时、stdout/stderr 尾部。
- 默认 `stopOnFailure: true`；可配置跑全部。
- 结果写入 `runs/<id>.json`；模型只拿到摘要 + 尾部。
- 不把完整日志塞进 tool result，避免 token 爆炸。

预览（Phase 2）：

- 配置 `preview.command`、`preview.url`（可选）、`preview.readyPattern`、`preview.timeoutMs`。
- `spawn` 启动，解析 stdout 里的 `http://localhost:<port>`；用 fetch 探活。
- 只允许 loopback URL；面板提供“打开”链接；iframe 需验证 DSH Web 的 CSP 和 dev server 的 `X-Frame-Options`。
- 停止时杀进程树（Windows `taskkill /T /F`；POSIX 进程组）。
- 插件 dispose / session 结束时清理，避免孤儿进程。

### 7.9 安全门

分级：

| 级别 | 行为 |
|---|---|
| `off` | 不拦截 |
| `balanced`（默认） | 危险 git/fs 命令 ask；灾难性命令 deny |
| `strict` | 所有写工作区外、git push、修改型 shell 都 ask |

`balanced` 的建议规则：

- `git push --force` / `git push -f` / `git reset --hard` / `git clean -fd` / `git checkout -- .` → `ask`
- `rm -rf /`、`rm -rf ~`、`rm -rf .`、`rd /s /q`、`del /f /s /q`、`format`、`diskpart`、`reg delete`、`shutdown` → `deny`
- 写工作区外的 `fs` 路径 → `ask`
- `npm publish` / `git push`（非 force）→ `ask`

注意：这是**护栏**，不是沙箱。模型可以混淆命令；真正的隔离应依赖 DSH 的 sandbox/permission preset。门禁只处理明显高风险操作，并保持可配置。

### 7.10 MVP 范围与非目标

MVP（v0.1）：

- Vibe preset（官方工具子集 + vibe-agent + bundled skills）。
- 5 个工具：status/spec/checkpoint/restore/verify。
- 2 个 skills：vibe-spec、vibe-verify。
- 右侧栏 Studio 面板：阶段、验收、任务、检查点、验证结果；Restore/Verify 动作。
- 本地文件检查点（内容寻址）；恢复前 safety checkpoint。
- 基础门禁（balanced）。
- 中英 i18n；README；`vibe-dev` 验证。

非目标：

- 不做代码编辑器、文件树、终端、Git 客户端（复用 DSH）。
- 不做模型/Provider（复用 DSH LLM）。
- 不做多 Agent 编排（用 subagent 工具）。
- 不做云同步/团队协作。
- 不做嵌入式浏览器（先外链；iframe 验证后再加）。
- 不接管标准 preset，不改用户默认。

### 7.11 目录结构

```
DSH_vibecode_studio/
├─ package.json
├─ tsconfig.json
├─ cordis.patch.yml
├─ src/
│  ├─ index.ts          # host plugin
│  ├─ agent.ts          # tools/commands/hooks
│  ├─ client/
│  │  ├─ index.tsx      # client bundle entry
│  │  └─ StudioPanel.tsx
│  ├─ core/
│  │  ├─ state.ts
│  │  ├─ checkpoint.ts
│  │  ├─ verify.ts
│  │  ├─ preview.ts
│  │  └─ paths.ts
│  └─ shared/
│     └─ types.ts
├─ skills/
│  ├─ vibe-spec/SKILL.md
│  └─ vibe-verify/SKILL.md
├─ locales/{zh,en}.json
├─ scripts/build-client.mjs
├─ docs/
│  └─ dsh-plugin-ecosystem-analysis.md
├─ README.md
├─ README.zh.md
└─ LICENSE
```

### 7.12 开发与验证

```sh
# 1) 安装依赖（项目自身）
pnpm install
pnpm build

# 2) 建开发 profile 并链接本地包
F:\Deepseek-Harness\DH\bin\dsh.cmd plugin --profile vibe-dev add link:F:\Project\DSH_vibecode_studio

# 3) 只校验组合，不启动
F:\Deepseek-Harness\DH\bin\dsh.cmd --profile vibe-dev --dump-config

# 4) 启动 Web
F:\Deepseek-Harness\DH\bin\dsh.cmd --profile vibe-dev web
```

验证清单：

- `--dump-config` 能看到 `vibe-studio` 与 `preset-vibe` 两行，且 `preset-vibe.config.plugins` 完整。
- 新建会话时能选到 “Vibe Coding” preset。
- 右侧栏引导页出现 “Vibe Studio”。
- `vibe_spec` 写入后刷新页面，面板状态仍在（projection）。
- 改动文件后 `workspaceChanges` 卡片正常；面板摘要一致。
- `vibe_checkpoint` → 改文件 → `vibe_restore` → 文件恢复；恢复前自动 safety checkpoint。
- `vibe_verify` 失败/成功都能在面板看到；日志已脱敏。
- Windows 上 bash/pwsh 行只启用一个。
- 桌面端通过 App 插件管理器安装后再测一遍。

### 7.13 发布

- npm 包名：`dsh-vibecode-studio`（当前 npm 未占用；建议同时检查 scope 可用性）。
- 版本：`0.1.0`；`engines.dsh` 覆盖 `0.2.1-rc.2` 与桌面端同代版本。
- `files`：预构建 `lib/`、`skills/`、`locales/`、`cordis.patch.yml`、README、LICENSE。
- 不依赖构建脚本，避免 `allowBuilds` 摩擦。
- 提交 `awesome-dsh-plugin` PR；市场自动收录。
- 可选：发布 format 1 索引；写清数据与安全说明（无遥测、状态本地、预览仅 loopback）。

---

## 8. 风险与待定决策

### 8.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 客户端 API 在 rc 间变化 | 面板编译/运行失败 | 锁定 peer；CLI + Desktop 双测；先做只读面板 |
| 桌面 profile 被 App 管理 | CLI 安装不生效 | 开发用 `vibe-dev`；发布用 App 插件页 |
| 启动全有全无 | 一个坏行拖垮宿主 | patch 最小化；`--dump-config`；可选行 `disabled` |
| 客户端 bundle 格式错误 | 激活失败、面板不出现 | 先做最小 “Hello” 面板验证构建链 |
| 恢复误删文件 | 用户数据损失 | 恢复前快照；保护路径；二次确认；默认只恢复捕获范围 |
| 大仓库快照慢/占空间 | 体验差 | 排除目录；大小/数量上限；增量内容寻址 |
| Windows 进程树/路径 | 预览杀不干净、路径异常 | `taskkill /T /F`；原生分隔符；测试 PowerShell |
| 与 super-code/spec-wave 冲突 | preset/工具重复 | 工具 `vibe_*` 命名；不注册全局 hook；文档说明共存 |
| 宿主路由安全 | 本地接口被滥用 | 同源检查 + loopback 限制；变更操作二次确认 |
| 验证日志泄密 | token 进日志 | 脱敏；只存尾部；用户可关闭持久化 |

### 8.2 待定决策（附推荐）

1. **产品形态**：A agent-only / B full studio / C integration。推荐 **B，按 A 分阶段**。
2. **工作流强度**：轻量 Vibe（spec 可选）/ 严格 spec-first。推荐 **轻量默认，门禁可配**。
3. **MVP 三件套**：面板 / 检查点 / 验证 / 预览 / review。推荐 **面板 + 检查点 + 验证**；预览 Phase 2。
4. **检查点实现**：文件快照 / git 原生 / 混合。推荐 **文件快照 MVP，后续评估 git 原生**。
5. **状态位置**：`$DSH_HOME` / 项目内 `.vibe`。推荐 **快照放 `$DSH_HOME`，spec 可选写项目 `.vibe/spec.md`**。
6. **名称**：`dsh-vibecode-studio`（npm 可用）/ 带 scope。推荐 **`dsh-vibecode-studio`**，插件 id `vibecode-studio`，preset id `vibe`。

---

## 9. 附录：关键路径与命令

### 9.1 本机路径

| 用途 | 路径 |
|---|---|
| CLI 安装 | `F:\Deepseek-Harness\DH` |
| DSH_HOME | `F:\Deepseek-Harness\DH\home` |
| desktop profile | `F:\Deepseek-Harness\DH\home\profiles\desktop` |
| web profile | `F:\Deepseek-Harness\DH\home\profiles\web` |
| 官方 base patch | `...\node_modules\@deepseek-ai\dsh-base\cordis.patch.yml` |
| 官方 web patch | `...\node_modules\@deepseek-ai\dsh-web-app\cordis.patch.yml` |
| 官方 presets | `...\dsh-web-app\presets\{standard,ptc,minimal,cordis}.patch.yml` |
| workspace-changes | `...\@deepseek-ai\dsh-workspace-changes\README.zh.md` |
| right sidebar | `...\@deepseek-ai\dsh-client-ui-sidebar-right\README.zh.md` |
| agent preset | `...\@deepseek-ai\dsh-agent-preset\README.zh.md` |
| client modules | `...\@deepseek-ai\dsh-client-modules\README.zh.md` |
| tools | `...\@deepseek-ai\dsh-tools\README.zh.md` |
| webserver | `...\@deepseek-ai\dsh-host-webserver\README.zh.md` |

### 9.2 命令

```sh
# 版本与帮助
F:\Deepseek-Harness\DH\bin\dsh.cmd --version
F:\Deepseek-Harness\DH\bin\dsh.cmd --help
F:\Deepseek-Harness\DH\bin\dsh.cmd plugin --help

# 组合校验
F:\Deepseek-Harness\DH\bin\dsh.cmd --profile desktop --dump-config
F:\Deepseek-Harness\DH\bin\dsh.cmd --profile vibe-dev --dump-config

# 本地安装/卸载
F:\Deepseek-Harness\DH\bin\dsh.cmd plugin --profile vibe-dev add link:F:\Project\DSH_vibecode_studio
F:\Deepseek-Harness\DH\bin\dsh.cmd plugin --profile vibe-dev remove dsh-vibecode-studio

# 启动
F:\Deepseek-Harness\DH\bin\dsh.cmd --profile vibe-dev web
```

### 9.3 参考代码片段（官方）

最小插件：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'
export function apply(ctx: Context) {
  console.log('[hello-plugin] plugin loaded!')
}
```

权限门禁：

```ts
export const name = 'permission-gate'
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) return { kind: 'deny', reason: 'Denied by policy.' }
    return next()
  })
}
```

---

## 10. 一句话总结

**DSH 的插件生态已经足够成熟，缺的不是“再一个编码 agent”，而是把 spec、检查点、验证、预览和回滚做成一个可视化、低摩擦的 Vibe 迭代驾驶舱。** 用官方的组合机制做 bundle，用右侧栏做面板，用 `workspace-changes` 做 diff，用文件快照做恢复，用 preset 做隔离——这是风险最低、差异化最清楚的路线。
