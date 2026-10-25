# S2 composer handoff spike 报告

> 日期：2026-10-25
> 任务：T002（S2 右栏 → composer 交接）
> 结论：**通过（文本 + 剪贴板回退）**。文本与剪贴板路径在 Web 和 Desktop 均可用；截图直接附件只验证到非公开的 `createDrafts`，不作为 MVP 依赖。

## 1. 结论

- 从右栏 tab 通过公开的 `conversation.input.left` 槽位拿到当前会话的 `inputActions`，`setDraft` 与 `captureInsertion` + `insertText` 在 Web 和 Desktop 均成功。
- 所有已执行的文本写入均返回成功；用户键盘编辑可以继续修改同一草稿，未出现覆盖或串会话。
- 写入后等待 2 秒，`phase` 仍为 `plain`，草稿内容完整；spike 代码不调用 `submit()`，也不调用 `ctx.conversation.send()`，未观察到自动提交。
- 文本和 PNG 截图都能复制到系统剪贴板：Web 通过浏览器权限授权，Desktop 在 `dsh-app://` 不透明 origin 下无法通过 CDP 授权，但 Electron 剪贴板仍可用。
- 截图直接加入 composer 在 spike 中可用：`ctx.conversation.createDrafts()` + `inputActions.addAttachments()` 在两种载体都成功，附件 id 进入输入状态。但 `createDrafts` **不在已安装版本的公开 `IConversation` 接口**中，因此 D6 保持“MVP 只用剪贴板回退”，不把产品依赖放在这个实现细节上。
- Web 跨会话测试中，草稿文本在 A/B/C 会话之间隔离且返回后保留；**附件 id 在切走再切回后丢失**。这是即使未来 `createDrafts` 公开也必须补测/修复的行为。
- Desktop 隔离 profile 只有一个未命名空白会话，点击“新建会话”复用了同一 `sessionId`，因此 Desktop 的跨会话重挂载没有单独测到；Web 已覆盖该路径。
- 未 import 私有 conversation store；未自动发送；无 console error。

## 2. 环境与方法

| 项 | 值 |
|---|---|
| OS | Windows 11 Home China 10.0.26100 |
| Node / pnpm | 24.13.0 / 11.21.0 |
| DSH CLI | 0.2.1-rc.2 |
| Desktop | 0.2.1-rc.3（Electron 44.7.0） |
| Web profile | `vibe-dev`（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + S2 spike） |
| Desktop profile | 临时 `DSH_HOME` 下隔离的 `desktop` profile；Electron userData 用 `--user-data-dir` 指向临时目录 |
| Browser | 本机 Microsoft Edge（Playwright `channel: 'msedge'`，headless） |
| Desktop 自动化 | Playwright `connectOverCDP`，只连接 loopback `127.0.0.1:9223` |
| 测试文本 | 111 字符的合成标注；包含 route、selector 和中文修改意见；带 `[vibe-s2]` 标记 |
| 测试截图 | 320×200 合成 canvas PNG；不是真实预览截图 |
| 验收等待 | 写入后 2 s，检查 `phase` 与草稿 |

**方法：** Web 用 headless Edge 新建 context，并通过 `grantPermissions` 授予 clipboard 读写；Desktop 连接已启动的隔离 Electron。两种载体都只通过 `globalThis.__vibeS2`（spike-only 调试面）调用产品候选函数，并读取 `__vibeS2.status()` 的 bridge 快照。没有把截图作为工具结果或唯一证据；验收数据写入本机 `.tmp/`（gitignored）。

隔离核对：Desktop 进程使用临时 `DSH_HOME` 和临时 Electron userData；真实 `desktop` profile 没有加载 S2 spike。自动化结束后只关闭 CDP 连接，不关闭用户窗口；最终由进程清理步骤结束隔离实例。

## 3. 可用 API 路径

### 3.1 右栏 tab

沿用 S1 的 sidebar-right 注册方式：

```ts
ctx.sidebarRightTabs.register({
  id: 'dsh-vibe-s2-spike',
  kind: 'vibe-studio-s2',
  title: () => 'Vibe Studio S2',
  keepMounted: true,
})
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: 'dsh-vibe-s2-spike',
}, () => panel))
```

`ctx.sidebarRight.openTab('vibe-studio-s2')` 可以打开 tab；测试中通过 debug hook 调用，未走 guide/命令路径。

### 3.2 从会话 composer 取得公开动作

关键点：`conversation.input.left` 是 **session-scoped list slot**，注册时必须提供 `id`、`order` 和 scoped `inject`；只传 `key` 会让插件 boot 失败（`1 entry did not activate`）。第一个可工作的形状：

```ts
ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
  name: 'conversation.input.left',
  id: 'dsh-vibe-s2-spike',
  order: 20,
  inject: (sessionId: string) => ({ sessionId }),
}, ComposerBridgeSlot))
```

`ComposerBridgeSlot` 不渲染 UI，只用公开的 slot props：

- `sessionId`：当前会话标识。
- `inputActions`：当前会话的公开输入动作（`setDraft`、`captureInsertion`、`insertText`、`addAttachments`、`removeAttachment`）。
- `useInput(selector)`：订阅输入状态；`phase`、`draft`、`attachmentIds` 用于调试和 UI。

因为它位于会话 slot 树内、Studio tab 在会话 slot 树外，spike 用一个模块级 `ComposerBridge` 保存 `inputActions` 与 `sessionId`，通过 `useSyncExternalStore` 给右栏面板订阅。这个 bridge 不 import conversation store，也不读写私有状态。

### 3.3 文本写入

```ts
const span = inputActions.captureInsertion()
inputActions.insertText(text, span)
```

- `setDraft(text)`：整段替换，适合把结构化标注放入输入框。
- `captureInsertion()` + `insertText(text, span)`：在当前光标处插入，适合追加或分段写入。
- 两者都是普通输入动作，不会触发提交；`phase` 保持 `plain`，用户仍可编辑。
- 不使用 `ctx.conversation.send()`；spike 不调用 `submit()`。

## 4. Web 验收

会话 A 是本次核心验收会话；C 是已有命名会话，B 是新建会话。以下是实际结果：

| 检查 | 结果 |
|---|---|
| `setDraft` | 成功，写入 111 字符；输入状态 `draft` 与发送内容一致 |
| 用户键盘编辑 | 焦点进入 composer，在末尾输入 ` user-edit`；bridge 看到追加后的文本 |
| `insertText` | 成功；在光标位置插入 19 字符，span 为 121–121，`draftRev` 11 |
| 等待 2 s | `phase` 仍为 `plain`，草稿完整；没有自动提交 |
| `copyText` | 成功，剪贴板读到 111 字符（Windows 将换行规范化为 CRLF） |
| `copyScreenshot` | 成功，剪贴板 MIME 类型为 `image/png`，约 5.8 KB |
| `attachScreenshot` | 返回 `supported: true`、`accepted: true`；1 个附件 id 进入 `attachmentIds` |
| 会话 C → B → C | C 的文本草稿保留；B 只见自己的草稿；A/B/C 文本不串 |
| C 的附件 id | 切到 B 再回 C 后 `attachmentIds` 为空；文本仍在 |
| console error | 0 条（未捕获的 pageerror 也为 0） |

**文本路径结论：** 验收中每次 `setDraft` / `insertText` 都成功；没有失败重试。Web 的跨会话文本隔离通过。

**附件的跨会话问题：** 在 C 中 `addAttachments` 返回接受，但切走再切回后，输入状态只剩文本草稿，附件 id 列表为空。可能是草稿附件 rail 的会话持久化策略，而不是 `addAttachments` 本身失败；S2 不把它当作已通过的能力。

## 5. Desktop 验收

Desktop 与 Web 使用同一份 client bundle；区别是 `dsh-app://app/` 载体、Electron 剪贴板和隔离 profile。

| 检查 | 结果 |
|---|---|
| S2 tab | 已加载；打开后页面可见 `Vibe Studio S2 · composer handoff`，右栏可切换 S1/S2 |
| bridge | `attached: true`，绑定到当前 Desktop 会话 |
| `setDraft` | 成功，写入 111 字符 |
| 用户键盘编辑 | 成功，末尾追加 ` desktop-edit`；composer 中可见完整草稿 |
| `insertText` | 成功；插入 27 字符，span 为 124–124，`draftRev` 14 |
| 等待 2 s | `phase` 仍为 `plain`，草稿完整；没有自动提交 |
| `copyText` | 成功，剪贴板读到 111 字符 |
| `copyScreenshot` | 成功，剪贴板 MIME 类型为 `image/png`，约 8.0 KB |
| `attachScreenshot` | 返回 `supported: true`、`accepted: true`；1 个附件 id 进入 `attachmentIds` |
| console error | 0 条 |
| 跨会话 | **未测到**：隔离 profile 只有一个空白会话；点击“新建会话”仍返回同一 `sessionId` |

`context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'dsh-app://app' })` 报 `Permission can't be granted to opaque origins`；这不影响 Electron 中的剪贴板读写。Web 的权限授权正常。

**Desktop 结论：** 文本 handoff、用户编辑、无自动提交、文本/PNG 剪贴板在 Desktop 都通过。跨会话隔离以 Web 结果为准，Desktop 没有可用的第二个稳定会话，不能声称已验证。

## 6. 截图附件与剪贴板回退

### 6.1 实验路径

`attachScreenshot` 的 feature detection：

```ts
const conversation = ctx.get('conversation')
if (typeof conversation?.createDrafts !== 'function') {
  return { ok: false, supported: false, reason: 'createDrafts is not exposed' }
}
const drafts = conversation.createDrafts(sessionId, [file], true)
const accepted = inputActions.addAttachments(drafts.map(draft => String(draft.id)))
```

结果：Web 和 Desktop 都接受，说明右栏 tab 在运行时可以触达该方法。但公开契约不包含它：

- `IConversation` 的公开面只有 `input`、`blocks`、`send`、`updateQueue`、`cancel` 和 `loadOlder`。
- `createDrafts` 是 `ConversationService` 的实现方法，内部由 composer 的拖放路径调用；其签名、生命周期和上传行为没有作为第三方插件契约公开。
- 附件 id 是 `DraftAttachmentId` 品牌类型；`addAttachments` 的公开类型要求这种 id，但第三方没有公开方式创建它。
- spike 未验证上传完成、失败重试、`releaseDraftAttachments` 清理或发送时的序列化；这些都属于“不能依赖”的范围。

因此 D6 的决策不变：**MVP 不启用直接截图附件，只提供复制截图 + 用户手动粘贴**。如果未来 DSH 公开附件创建/释放 API，再按公开契约重新评估，并复测切会话保留。

### 6.2 回退路径

| 路径 | Web | Desktop |
|---|---|---|
| 复制文本 | 通过；`navigator.clipboard.writeText` | 通过 |
| 复制 PNG | 通过；`ClipboardItem({ 'image/png': file })` | 通过 |
| 读取验证 | `image/png` | `image/png` |
| 用户操作 | 点击“Copy screenshot”后手动粘贴 | 同左 |

回退路径不自动发送、不把截图放进工具结果，也不依赖未公开的 conversation 方法。用户是否可以粘贴图片取决于目标模型路由；如果不支持，标注文本本身就是自包含的，流程不被阻塞。

## 7. GitHub 参考对比

检索日期：2026-10-25。只参考公开契约和高星项目的设计，不复制代码。

| 项目 | 许可证 / 活跃度 | 与本 spike 相关的做法 | 本项目的取舍 |
|---|---|---|---|
| [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) | MIT；260,918 stars；当日有更新 | 公开 slot 契约；`conversation.input.left` 是 session-scoped list slot；`InputActions` 提供 `setDraft` / `captureInsertion` / `insertText` / `addAttachments`；`IConversation` 不包含 `createDrafts` | 只使用公开 slot props 和 input actions；`createDrafts` 仅做 spike 实验 |
| [`dsh-tauri/deepseek-harness-desktop`](https://github.com/dsh-tauri/deepseek-harness-desktop) | MIT；3,269 stars；当日有更新 | `packages/dsh-tauri-pet/src/client/register/prefill.ts` + `components/prefill.tsx` 用 `conversation.input.left` 和 scoped `sessionId` 注入，`inputActions.setDraft` 预填草稿 | 借鉴“slot + scoped inject + setDraft”的经过验证形状；不引入其 Tauri store 依赖；用独立 bridge 让同一个包同时服务 Web/Desktop |
| 本 spike | 仅实验代码 | 文本 + 可选附件 + 剪贴板回退 | 不复制社区实现；不 import 私有 store；不调用 `submit` / `send` |

对比结论：官方契约足以完成文本 handoff；社区项目证明了右栏/会话外组件通过 slot 注入触达 composer 的模式。截图附件没有公开路径，和 SPEC 预设的“剪贴板回退”一致。

## 8. 假设修正与已知限制

1. **slot 注册形状**：`conversation.input.left` 需要 `name` + `id` + scoped `inject: (sessionId) => ({ sessionId })`；只传 `key` 或把 `conversation` 放在插件根注入会导致 boot 激活失败。已按此修正。
2. **`createDrafts` 不是公开 API**：它存在于 rc.2/rc.3 的实现类中，但不在 `IConversation`；spike 的“附件 accepted”不能升级为产品能力。D6 已明确为剪贴板回退。
3. **附件不跨会话保留**：Web 中 C 会话的附件 id 在切走再切回后丢失，文本保留。即使未来公开附件 API，也必须先解决/验证这一点。
4. **Desktop 跨会话未覆盖**：隔离 profile 只有空白会话，点击“新建会话”复用同一 id；Desktop 的 slot detach/attach 生命周期没有独立证据。Web 已验证文本隔离。
5. **不透明 origin 的剪贴板权限**：CDP 无法给 `dsh-app://` 授 clipboard 权限；实际 Electron 剪贴板仍工作。Web 自动化需要显式 `grantPermissions`，真实用户点击按钮时通常由用户手势满足权限条件。
6. **未验证上传/发送**：spike 只检查 `addAttachments` 的返回值与输入状态；没有发送消息，没有验证 host 侧上传完成、失败提示、附件序列化或清理。
7. **合成截图**：320×200 canvas 不是真实预览裁剪；真实截图的尺寸、DPI、文件大小和剪贴板行为留给后续预览任务。
8. **文本规模有限**：只测了 111 字符；没有测 4 KB 上限、超长文本、多行引用 chip 或粘贴富文本。
9. **无输入法验证**：`insertText` 是普通文本插入；中文输入法组合、候选框和逐字输入留给 S3。
10. **spike-only 调试面**：`globalThis.__vibeS2` 暴露了写入/复制函数和测试用 `.note`，**不能进入产品包**。
11. **版本敏感**：slot props、`InputActions` 和 sidebars 的注册形状在 rc.2/rc.3 验证；升级 DSH 后要重跑本报告 §3–§5。
12. **会话 id 与附件 id 是运行态数据**：本报告不记录具体 id，验收 JSON 留在本机 `.tmp/`，不进入仓库。

## 9. 复现

完整构建、安装和手测步骤见 [`run.md`](./run.md)。摘要：

```bash
pnpm install
pnpm typecheck
pnpm spike:s2:build

# Web：只对开发 profile 链接；路径必须是绝对路径
dsh plugin --profile vibe-dev add link:<repo>/spikes/s2/package
dsh --profile vibe-dev --no-open --host 127.0.0.1 --port 4317

# Desktop：隔离 DSH_HOME + 独立 Electron userData，只在隔离 profile 中链接
# 不要把 S2 安装到真实 desktop/web profile
```

打开页面后，在 DevTools 中执行 `__vibeS2.openTab()`，再调用 `setDraft` / `insertText` / `copyText` / `copyScreenshot`；所有动作都在当前会话，且不会自动发送。详细检查表见 `run.md`。

## 10. 结论与后续

- T002 通过：文本 100% 成功、无自动提交、剪贴板文本/PNG 回退可用、未 import 私有 store。
- 截图直接附件暂不产品化：`createDrafts` 是内部实现，不满足“公开 API”门槛；D6/SPEC 已记录，MVP 只做复制截图手动粘贴。
- 跨会话文本隔离在 Web 通过；附件跨会话丢失是明确的后续风险。
- 下一项按 `tasks/todo.md` 执行 **T003 S3 screencast + 输入 + 中文 spike**。
