# Vibe Studio 用户指南（T060）

> 版本：`dsh-vibecode-studio@0.1.0`（pre-alpha）· 更新：2026-10-31
> 适用：Windows 11 + Microsoft Edge + DeepSeek Harness `0.2.1-rc.2` 或更新版本。
> 安全边界与残余风险见 [SECURITY.md](./SECURITY.md)；打包与发布流程见 [RELEASE.md](./RELEASE.md)。
>
> 第一次使用建议先看 **[使用说明（图文）](./USAGE.zh-CN.md)**；本文是完整参考手册。

## 1. 安装

Vibe Studio 是一个 DSH 插件包，只应装进**开发 profile `vibe-dev`**。
不要安装到 `desktop` 或 `web` profile：它们是用户的日常环境，本包仍处于 pre-alpha。

### 1.1 用发布包（tarball）安装

```bash
pnpm install
pnpm build                      # 产出 lib/index.js、lib/agent.js、lib/client.js
npm pack                        # 产出 dsh-vibecode-studio-0.1.0.tgz
dsh plugin --profile vibe-dev add file:<绝对路径>/dsh-vibecode-studio-0.1.0.tgz
```

`dsh plugin` 会把参数转给 profile 目录里的 pnpm，并把包名同步进 profile 的 `dsh.profile.bundles`。

### 1.2 用源码链接安装（开发时）

```bash
pnpm install
pnpm build
dsh plugin --profile vibe-dev add link:<本仓库绝对路径>
```

`link:` 必须用**绝对路径**（pnpm 会相对 profile 目录解析）。每次 `pnpm build` 之后重启 DSH，
或让宿主热重载；不要在基准测试、浸泡测试或手测进行中重建。

### 1.3 启动与打开

```bash
dsh --profile vibe-dev --no-open --host 127.0.0.1 --port 4317
```

打开命令行打印的带 token 的 URL，在右栏点 **新标签页**，选择 **Vibe Studio**。

确认插件已进入组合配置（能看到 `vibe-studio` 与 `vibe-skill-bundled` 两行）：

```bash
dsh --profile vibe-dev --dump-config
```

### 1.4 卸载

```bash
dsh plugin --profile vibe-dev remove dsh-vibecode-studio
```

卸载后重启 DSH；`.vibe/` 下的标注、集合、历史与截图仍留在原目录，需要时手动删除。

## 2. 界面总览

Studio 打开后有五个页签：

| 页签 | 用途 |
|---|---|
| 预览 | 在侧栏内嵌预览本地 Web 应用，可点击、输入、滚动 |
| 检查 | 开启拾取后点选页面元素并写下修改意见 |
| 标注 | 批注队列与历史，审核后交接给对话 |
| API | 请求构建、响应查看、集合/历史/环境/OpenAPI/cURL/抓包回放 |
| 设置 | 允许的源、保留期、上下文预算、截图开关、日志级别、预览视口 |

预览页遵循“画布优先”：常驻只有状态行、地址行和底部页签，其余参数收进“更多”菜单或设置页。
底部有三个抽屉页签：**Console**、**Network**、**验证**；抽屉覆盖在画布上，开关不会重置预览。

## 3. 预览

- 地址栏输入 `http://127.0.0.1:<端口>`，回车即可启动目标。默认只允许 loopback；
  非本地地址需要显式加入允许的源并在提示时确认。
- “更多”菜单里有：在浏览器打开、刷新、重启、切换目标、适配面板。
- 画面以流式 JPEG 传输（默认约 30 fps），断流时自动回退到拉取式 JPEG 并在恢复后切回。
- 页面内可直接点击、键入、滚动；中文输入走隐藏 textarea + composition 事件。
- **Console** 抽屉增量展示页面 console 与异常（上限 500 条）；**Network** 抽屉展示请求/响应
  （上限 300 条，4xx/5xx 标记，响应体按需加载并截断）。两者都可一键清空。
- **验证** 抽屉一键跑四项只读检查（预览目标、页面、Console、网络），失败项可点击证据按钮
  跳到对应抽屉并高亮 2 秒（Console/Network 行本身只读，证据按钮在验证面板内）。
- 预览进程随 tab 关闭或停止而回收；崩溃会在 101 ms 左右检出，只提示不自动重连。

## 4. 检查（要素拾取）

1. 点“检查”页签里的拾取开关（或按工具栏的拾取按钮）。
2. 页面元素高亮后点击，弹出批注气泡；`Esc` 取消，`Alt+Click` 免模式拾取。
3. 气泡里会带出元素的选择器、role/可访问名称、可见性与源码位置（React/Vue/Svelte 开发态）。
   源码取不到时显示“无源码信息”，回退到选择器 + DOM 片段。
4. 输入修改意见，`Ctrl+Enter` 保存，`Esc` 取消。空意见不会保存。

## 5. 标注

- 保存后进入“标注”页签的队列；每条可编辑、取消、发送或移除，页签带数量徽标。
- 保存通知里可以直接“发送到对话”：把结构化文本插入当前会话的 composer 草稿。
- **不会自动发送、不会自动提交**：文本进入草稿后由你决定是否发送。
- 历史里的标注可搜索、重开入队、两步删除；所有落盘在 `.vibe/annotations/`，单文件、原子写入。

## 6. API 工作台

默认是**新手模式**：首屏只有“方法 + URL + 发送”一行和常驻响应区。切换到专业模式后
额外出现 cURL 与结果校验。模式选择会被记住。

- **发送**：支持 query 参数、标头、请求内容（JSON/文本/表单/multipart）、三种身份验证；
  可取消，超时与重定向按稳定错误码返回。
- **响应**：状态与耗时、大小、content-type、重定向/截断徽标；JSON 默认折叠树，
  HTML 进沙箱 iframe，图片白名单预览，二进制可下载；大响应按 64 KiB 分页。
- **更多配置**：URL 参数、标头、请求内容、身份验证。
- **更多工具**：收藏（集合）、历史、环境（`{{var}}` 与密钥引用）、OpenAPI 导入、cURL 导入/导出。
- **抓包回放**：在 Network 抽屉里把一条请求转成草稿；非幂等方法先确认，**从不自动发送**。
- **结果校验（专业模式）**：状态码、响应头、JSONPath 子集、耗时四类断言；任一行不合法会阻止发送。

安全要点：密钥只存在 `ctx.credentials`，面板只读 `describe()`；导出、历史与模型上下文中
的 URL/header/body 都经过脱敏；默认拒绝云元数据与链路本地地址。

## 7. 与 Agent 协作

安装后，会话的模式菜单里会出现 **Vibe Studio** preset。该 preset 只添加本插件的四个工具，
standard 会话看不到它们：

| 工具 | 作用 |
|---|---|
| `vibe_status` | 预览/标注/缓冲区的宿主计数与下一步建议；带 `?token=` 的 URL 先脱敏 |
| `vibe_observe` | 页面 DOM/Console/Network 摘要（≤ 8 KB，不可信包裹） |
| `vibe_annotation_get` | 按 id 读取一条标注（评论在包裹外，页面派生数据在包裹内） |
| `vibe_preview` | reload / navigate / screenshot / start / stop；越权动作直接拒绝 |

- 斜杠命令 **`/vibe`**：一行状态 + 一条下一步建议，只读、无副作用。
- 内置技能 **`vibecoding-studio`**：意图路由与省上下文规则，细节在 `references/`。
- `vibe_preview start/stop` 会先请求审批；非 loopback、跨源或关闭截图后的 screenshot
  在审批之前就被拒绝（`permission_denied`）。
- 预览运行期间 agent 改动了文件，状态行会出现“文件已改动”徽标，提示刷新后再验证。

## 8. 配置

配置由 loader 应用到 `vibeStudio` 服务；设置页写入 `.vibe/studio.json`，Host 读取同一份文档。

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `logLevel` | `debug`/`info`/`warn`/`error` | `info` | 宿主日志级别 |
| `allowedOrigins` | string[] | `http://localhost`、`http://127.0.0.1` | 预览可用的源 |
| `retentionDays` | 1–365 | `7` | 截图、抓包与日志的保留天数 |
| `contextBudgetBytes` | 1024–65536 | `8192` | 交给模型的页面上下文上限 |
| `screenshotEnabled` | boolean | `true` | 是否允许截图进入 artifact store |

在 **profile 自己的** `cordis.patch.yml`（`$DSH_HOME/profiles/vibe-dev/cordis.patch.yml`，
不是仓库里那份）覆盖：

```yaml
- id: vibe-studio
  config:
    logLevel: debug
    allowedOrigins:
      - http://localhost:5173
```

类型/枚举错误会让插件不激活并打印可读的 `ValidationError`；未知键与非法源在 `resolveConfig()`
阶段失败。`--dump-config` 只打印组合树、不校验配置，验证请用一次启动或单测。

## 9. 已知限制

- **只支持开发 profile `vibe-dev` 作为安装目标**；`desktop`/`web` 不允许直接修改（Desktop 仅在 `.tmp/` 隔离 home 的 profile 副本上做过冒烟验证）。
- 预览目标是单个会话；窗口缩放、切后台、多标签与系统级输入法仍需人工确认。
- 截图只能“复制 PNG + 手动粘贴”，不会作为附件自动发送给模型。
- multipart 受一元通道 64 KiB 上限约束，实际单文件约 48 KiB；响应体默认截断到 4 MiB。
- OpenAPI 远程 `$ref` 默认全部拒绝，loopback 需显式许可；不跟随 302。
- 断言只支持 JSONPath 子集（`$`、`.key`、`['k']`、`[n]`），比较为文本比较；
  断言不落盘；Cookie jar 按 D8 延后（FR-API-11）。
- 抓包采集器在首次导航之后启动，首屏请求不入缓冲（T024 遗留）。
- 安全残余风险：截图过期无自动清理（F5）、不解析 DNS 因而 rebinding 可绕（F7）、
  loopback 判定在三处重复（F8）。详见 [SECURITY.md](./SECURITY.md) §5。
- 验证面板只覆盖目标/页面/Console/网络四项，不替代 Playwright 等测试工具。

## 10. 故障排查

| 现象 | 处理 |
|---|---|
| 右栏菜单没有 Vibe Studio | `dsh --profile vibe-dev --dump-config` 确认 `vibe-studio` 行存在；确认装的是 `vibe-dev` profile；重启 DSH |
| 插件启动告警 `ValidationError` | 配置不合法：按提示修正 `logLevel`/`allowedOrigins` 等字段，或用 `--patch` 临时排除 |
| 预览报 `target_unavailable` | 本机没有 Edge（`channel: 'msedge'`），或目标端口未监听 |
| 预览报 `port_in_use` | 目标端口被占用；换端口或先停掉占用的进程 |
| 页面空白、帧率低 | 打开“更多 → 在浏览器打开”对照；确认目标在 loopback、未开代理；Console 抽屉看是否有脚本错误 |
| `playwright-core is not installed` | 包安装不完整（运行时依赖缺失）；重新 `dsh plugin --profile vibe-dev add file:<tgz>` |
| 401/403 与 transport 错误 | DSH 默认只允许带 token 的文档相对请求与同源；不要用外部工具直连宿主端口 |
| 发送后 composer 没有文本 | 当前会话没有 composer（如全屏预览）；文本已回退到剪贴板，手动粘贴即可 |
