# S4 — 拾取与源码定位 Spike 报告

- 任务：T004（S4 picking + source spike）
- 日期：2026-10-26
- 结论：**通过**，30/30 元素命中源码，且无点击泄漏、Esc 正常、无控制台/页面错误。

## 验收结果

| 框架 | 命中 | 源码来源 | 选择器唯一 | 点击泄漏 | Esc | console | pageerror |
| --- | --- | --- | --- | --- | --- | --- | --- |
| React 19 | 10/10 | `data-inspector`（Babel 构建期属性） | 10/10 | 0 | 通过 | 0 | 0 |
| Vue 3.5 | 10/10 | `__v_inspector`（vnode 隐藏 prop / store） | 10/10 | 0 | 通过 | 0 | 0 |
| Svelte 5 | 10/10 | `__svelte_meta`（运行时 dev 元数据） | 10/10 | 0 | 通过 | 0 | 0 |
| **合计** | **30/30（100%）** | — | 30/30 | **0** | 通过 | **0** | **0** |

判定条件：总命中率 ≥ 80%、点击泄漏 0、Esc 全部退出、console/pageerror 为 0、overlay 位于 Shadow DOM。行号判定为与期望行相差 ≤ 2；本次三框架全部 **行号精确相等（delta=0）**。

原始证据：`spikes/s4/results.json`（含每个元素的 selector、source、fileMatch、lineDelta、clicksLeaked）。

## 方法

- **Fixtures**：`spikes/s4/fixtures/{react,vue,svelte}`，均为 Vite 8 应用，每个页面 10 个带 `id` 的目标元素（标题、输入、单选、按钮、列表、页脚），每个元素绑定点击计数器 `window.__clicks`，用于检测拾取是否误触页面。
- **启动**：`run.ts` 用 Vite JS API `createServer()` 启动 fixture（`127.0.0.1` + 随机端口），Playwright-core 以 `channel: 'msedge'`、1280×800、`zh-CN` 打开页面。
- **注入**：`inject.ts` 经 esbuild 打成 IIFE，`page.addScriptTag` 注入；overlay 宿主 `position:fixed; inset:0; pointer-events:none; z-index:2147483647`，内部样式全部放在 **open Shadow DOM** 中，避免页面 CSS 干扰；`deepElementFromPoint` 支持穿过 open shadow root 取元素。
- **拾取流程**：捕获阶段监听 `pointerdown/pointerup/mousedown/mouseup/dblclick/auxclick/contextmenu/submit`，`preventDefault + stopImmediatePropagation` 拦截页面默认行为与处理器；`click` 由拾取器自己的捕获监听消费，不进入页面。每次拾取后派发 `vibe-pick` 事件，测试通过 `getLastPick()` 读取结构化结果。
- **选择器**：优先唯一 `#id`（`CSS.escape`），否则从元素向上拼 `tag:nth-of-type(n)` 路径，并用 `querySelectorAll(selector).length === 1` 校验唯一性。
- **源码提取顺序**：构建期属性 → React fiber → Vue vnode → Svelte meta；任一框架拿不到时返回 `null`，不猜测。

## 各框架实现与关键发现

### React 19（`data-inspector`）

- React 19 **移除了运行时 `_debugSource`**；Vite 8 的 Oxc 开发转换也不再输出 `__source`，因此 fiber 链上没有元素级源码。`_debugStack` 只指向组件渲染位置（实测 h1 报 `App.jsx:11`，与元素行 9 不符），不能作为元素级来源。
- 改为构建期注入：Vite `pre` 插件对 `.jsx/.tsx` 先跑 Babel，使用 `@react-dev-inspector/babel-plugin`（MIT，GitHub 1321 stars，维护活跃）给每个 JSX 元素加 `data-inspector-relative-path / -line / -column`，再由 `@vitejs/plugin-react` 的 Oxc 完成 JSX 转换。拾取时读最近的 `[data-inspector-relative-path]`。
- 仅 `apply: 'serve'`，不影响生产构建；Babel 重写只发生在开发服务器，成本可接受，正式实现可把它做成可选开发依赖。

### Vue 3.5（`__v_inspector`）

- `vite-plugin-vue-inspector`（MIT，809 stars）在编译期写入 `data-v-inspector="file:line:col"`，但运行时 `moveInspectorDataToHiddenProps` 会**删除 DOM 属性**，把值转存到 vnode props 的不可枚举 `__v_inspector`，并登记到全局 `__vue_inspector_store__.vnodeToPos`。
- 因此 `el.closest('[data-v-inspector]')` 在运行时必然为空。正确路径是读 `el.__vnode.props.__v_inspector` 或 `store.vnodeToPos.get(props)`，再沿 vnode `parent` 链向上找。源码路径为项目相对路径。

### Svelte 5（`__svelte_meta`）

- Svelte 5 dev 运行时通过 `assign_location` 在元素上设置 `element.__svelte_meta = { parent, loc: { file, line, column } }`；从元素向父级遍历即可拿到最近源码位置，无需额外插件。
- 仅 dev 模式存在；生产构建不提供，需在产品中明确降级。

## 局限与未覆盖

- 三个 fixture 都是**开发模式**；生产构建没有源码元数据（符合预期：拾取是开发工具）。
- React 路径依赖 Babel 预转换，会增加 dev server 首次编译耗时；大型项目需评估是否按需启用/缓存。
- `@react-dev-inspector/babel-plugin` 也会给组件 JSX（如 `<App />`）加 `data-inspector-*`；若组件把未知 props 展开到 DOM，开发态 DOM 会多出这些属性。正式实现可限制为 intrinsic 元素，或接受该 dev-only 副作用。
- React 的 `pre` 插件目前只处理 `.js/.jsx`，未覆盖 `.tsx` 的 fixture（实现上把正则扩为 `\.[jt]sx?` 即可，但需补测 TS 语法）。
- 选择器仅在 10 元素/页的简单 DOM 上验证；复杂列表、重复组件、CSS-in-JS 的稳定性未测。`nth-of-type` 路径在兄弟节点动态插入时可能失效，正式实现需在拾取时实时校验并在失败时退回多候选。
- 未覆盖 iframe、closed shadow root 内部元素、跨组件库（如组件库包裹的 DOM 归属）、拖拽/触摸屏拾取。
- 行号容差为 ±2，但本次实际全部精确；不能据此假设所有构建工具链都精确（压缩/插件改写源码位置时可能漂移）。

## 对 G0 的建议

1. **按框架做源码适配器**，统一输出 `{framework, via, file, line, column}`；能力检测顺序：构建期属性 → 框架运行时 → 无源码降级。
2. **React 不依赖 fiber**：React 18 可保留 `_debugSource` 作为兜底，React 19+ 以构建期属性为主；G0 应把“是否注入构建期源码插件”作为项目显式选项，默认开发模式开启。
3. **Vue 直接对接 `vite-plugin-vue-inspector` 的运行时数据**（store/vnode），不要依赖 DOM 属性。
4. **Svelte 直接读 `__svelte_meta`**，并检测缺失时提示“源码信息不可用”。
5. overlay 用 **open Shadow DOM**（便于测试与调试），宿主 `pointer-events:none`；拾取期间捕获阶段拦截交互，但 `click` 单独由拾取器处理，避免拦截后自己的监听也收不到。
6. 下一步（T005 G0）可把本 spike 的三个适配器抽成正式模块，先接 `ctx.connection` 的页面会话，再补 TSX、iframe、重复组件选择器策略。

## 复现

```bash
pnpm install
pnpm typecheck
pnpm spike:s4
```

- 期望输出：三个框架各 `10/10 hits`，末行 `TOTAL 30/30 (100.0%) ... PASS`，并生成 `spikes/s4/results.json`。
- 依赖（均为项目内 devDependencies）：`vite`、`@vitejs/plugin-react`、`@vitejs/plugin-vue`、`@sveltejs/vite-plugin-svelte`、`vite-plugin-vue-inspector`、`@react-dev-inspector/babel-plugin`（MIT）、`@babel/core`、`esbuild`、`playwright-core`。
- 浏览器：本机 Edge（`msedge` channel）；仅访问 `127.0.0.1` 本地 fixture。

## 证据文件

- `spikes/s4/inject.ts`：overlay、拦截、选择器、三框架源码提取。
- `spikes/s4/run.ts`：fixture 启动、浏览器驱动、命中判定、结果落盘。
- `spikes/s4/fixtures/{react,vue,svelte}/`：三个 Vite fixture 与逐元素期望行号。
- `spikes/s4/results.json`：本次运行的逐元素明细。
