# S2 composer handoff spike — 复现与手测

> 任务：T002
> 适用版本：DSH `0.2.1-rc.2` / Desktop `0.2.1-rc.3`（Electron 44.7.0）
> 只在一次性开发 profile / 隔离 Desktop profile 中运行；**不要安装到真实的 `desktop` 或 `web` profile**。

## 1. 构建

```bash
pnpm install
pnpm typecheck
pnpm spike:s2:build
```

构建产物：

- `spikes/s2/package/lib/index.js` — no-op host。
- `spikes/s2/package/lib/client.js` — loader 包装后的 client。
- `spikes/s2/.build/client.cjs` — 中间产物。

`lib/` 和 `.build/` 都已 gitignore；链接前必须构建，否则 DSH 会链接到没有入口的包。构建会触发 DSH 热重载，测量/手测期间不要重建包。

## 2. Web 手测

先确认 `vibe-dev` 是临时开发 profile。链接时必须用**绝对路径**；`link:spikes/s2/package` 会相对 profile 目录解析，生成错误的依赖。

```bash
dsh plugin --profile vibe-dev add link:<repo>/spikes/s2/package
dsh --profile vibe-dev --no-open --host 127.0.0.1 --port 4317
```

打开 DSH 输出的带 token URL。确认右栏出现 **Vibe Studio S2**，打开它。

在 DevTools Console 中执行以下步骤（`__vibeS2` 是 spike-only 调试面）：

```js
__vibeS2.status()                 // bridge.attached 应为 true，phase 应为 plain
__vibeS2.openTab()                // 打开右栏 S2 tab
__vibeS2.setDraft(__vibeS2.note)  // 文本预填；note 是字符串属性，不是函数
__vibeS2.status()                 // bridge.draft 应与 note 一致
__vibeS2.insertText('\n[vibe-s2] manual append')  // 在当前光标处插入
__vibeS2.copyText(__vibeS2.note)  // 文本剪贴板
await __vibeS2.copyScreenshot()   // PNG 剪贴板
await __vibeS2.attachScreenshot() // 实验路径；不要把它当产品依赖
```

手动检查：

1. 点击 composer，在末尾输入一些文字；`__vibeS2.status().bridge.draft` 应包含这些字符。
2. 等待 2 秒以上；`phase` 仍为 `plain`，草稿没有被清空，也没有出现自动发送。
3. 粘贴到外部编辑器，确认文本；粘贴到支持图片的编辑器，确认 PNG。
4. 会话隔离：在一个已有命名会话 C 中写入草稿，新建会话 B 写入另一段文本，再回到 C。确认 C 的文本仍在且 B 的文本不会出现。S2 观察到附件 id 在切走再切回后丢失；文本不受影响。
5. `__vibeS2.clearDraft()` 可清空草稿。不要调用 `submit()` 或 `ctx.conversation.send()`。

## 3. Desktop 手测（隔离 profile）

Desktop 的 `desktop` profile 由 Electron 管理，CLI 会拒绝 `dsh plugin --profile desktop ...`。只在隔离的 `DSH_HOME` 中测试：

1. 准备一个一次性 `DSH_HOME`，其中包含 `profiles/desktop`。不要复制真实 Desktop profile 的登录态/凭据；需要时使用独立的测试 profile。
2. 在该 profile 的 `package.json` 中加入依赖：

   ```json
   "dsh-vibe-s2-spike": "link:<repo>/spikes/s2/package"
   ```

   并确保 bundle 列表包含 `dsh-vibe-s2-spike`。依赖目录应是指向 `spikes/s2/package` 的 junction/symlink；不要复制生成物。
3. 用独立 Electron userData 启动（示例，路径均为占位）：

   ```bash
   DSH_HOME=<isolated-home> \
   DSH_AGENTS_HOME=<isolated-agents> \
   LOCALAPPDATA=<isolated-localappdata> \
   <DSH_ROOT>/Desktop/DeepSeek\ Harness.exe \
     --user-data-dir=<isolated-userdata> \
     --remote-debugging-port=9223
   ```

   `--remote-debugging-port` 只绑定 loopback；不要暴露到网络。
4. 打开唯一的测试会话，在 S2 tab 中重复第 2 节的文本、等待、剪贴板检查。Desktop 的 `dsh-app://` 是不透明 origin，CDP 不能授予 clipboard 权限，但 Electron 剪贴板仍应可用。
5. Desktop 的“新建会话”在只有一个空白会话时会复用同一个 `sessionId`，所以跨会话重挂载不易在这里复现；以 Web 结果为准，不要把它标成 Desktop 已通过。

真实 `desktop` profile 不得修改；若需要验证真实载体，应由用户在自己的 Desktop 中手动完成。

## 4. 通过标准

- 文本：`setDraft`、用户键盘编辑、`insertText` 都成功；草稿内容与预期一致。
- 不自动提交：至少等待 2 秒后 `phase === 'plain'`，草稿完整。
- 剪贴板：文本与 PNG 都能写入并读出；如果目标平台不允许读取，至少确认写入成功且用户可粘贴。
- 会话隔离：Web 的 C/B 文本不串；附件跨会话丢失需记录，不视为通过。
- 安全：不 import 私有 conversation store；不调用 `submit` / `send`；不把截图放进工具结果或自动发消息。
- 截图附件：只有公开 API 才能作为产品路径；`createDrafts` 的实验成功只记录在报告中，不作为 MVP 验收。

## 5. 清理

```bash
dsh plugin --profile vibe-dev remove dsh-vibe-s2-spike
```

- 停止 Web/Desktop 测试进程，确认端口 `4317` 和 loopback CDP `9223` 已释放，进程树没有残留。
- 删除隔离 `DSH_HOME`、临时 userData、`.tmp` 验收 JSON；不要删除真实 profile。
- 不提交 `spikes/s2/package/lib/`、`.build/`、`.tmp/` 或任何本机验收数据。
