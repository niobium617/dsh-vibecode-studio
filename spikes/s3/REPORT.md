# S3 screencast + 输入 + 中文 spike 报告

> 日期：2026-10-26（数据取自同日运行；2026-10-25 与 2026-10-26 的三次运行结果一致）
> 任务：T003（S3 Playwright + Edge screencast / 输入 / 中文）
> 结论：**通过**。headless 98.7 fps、headful 98.3 fps（unique fps 同值）；输入最大 26.8 / 25.2 ms；中文三条路径均正确；焦点、Tab、Esc 正常。

## 1. 结论

- 两种模式都远超 10 fps 验收线：headless 988 帧 / 98.7 fps，headful 983 帧 / 98.3 fps；unique 帧数与总帧数相同，说明没有重复帧虚增。
- 首帧 24 / 18 ms；帧捕获到接收延迟 avg/p95 为 7.4/12.9 ms 与 5.4/8.1 ms；JPEG 帧完整，接收错误 0。
- 输入全部可用，最大延迟 26.8 / 25.2 ms，低于 200 ms 验收线约一个数量级：点击 4.1/1.1 ms、滚轮 26.8/25.2 ms、ASCII 键盘 4.6/1.7 ms、`insertText` 6.2/1.7 ms、逐字中文 1.9/1.6 ms、IME 提交 2.1/1.5 ms（dispatch ms，headless/headful）。
- 中文三条路径都正确写入：`Keyboard.insertText('你好，世界')`、逐字 `Keyboard.type('中文')`、CDP `Input.imeSetComposition` + `Input.insertText` 模拟 IME（`你好`）。IME 路径触发 5 个 `composition*` 事件、6 个 `isComposing` 事件，`compositionend` 存在。
- 焦点正确：点击 `#text` 后 `activeElement=text`；Tab 后为 `ime`；Escape 的 keydown 正常送达；无 console/page error。
- **对实现的影响**：D4（输入走精确 fetch 一元请求）成立；T020 需要做帧节奏控制（见 §3.3）；T022 仍需在真实 DSH 载体里用系统中文输入法手测（见 §7）。

## 2. 环境与方法

| 项 | 值 |
|---|---|
| OS | Windows 11 Home China 10.0.26100 |
| Node / pnpm | 24.13.0 / 11.21.0 |
| 浏览器 | 本机 Microsoft Edge 156.0.4314.42（Playwright `channel: 'msedge'`，不下载浏览器） |
| 驱动 | `playwright-core` + CDP `Page.startScreencast` / `Input.*` |
| 视口 / 质量 | 1280×800，JPEG q70，`deviceScaleFactor: 1`，`locale: 'zh-CN'` |
| 页面 | `fixture.html`，loopback HTTP（`127.0.0.1:0` 随机端口），持续动画 + 表单 |
| 时长 | 两种模式各 10 s screencast + 输入套件 |
| 运行命令 | `pnpm spike:s3 --seconds 10`；`pnpm typecheck` 通过 |

**测量口径：**

- `fps` = 接收帧数 / 实际运行时长；`uniqueFps` 用帧内容 SHA-1 去重后计算；`fpsBySecond` 按秒分桶。
- `firstFrameMs` = `startScreencast` 到首帧到达；`captureLatency` = 接收时刻 − 帧的 CDP `timestamp`，同一进程内单向延迟。
- `dispatchMs` = 页面事件时间戳（`performance.timeOrigin + performance.now()`）− 输入派发开始；`paintMs` = 事件后首个 `requestAnimationFrame` 时间戳 − 派发开始。两者都不含测试脚本在事件后的 `waitForTimeout` 与快照读取。
- `bytesPerFrame` = 平均 JPEG 字节数；`jpegValid` 检查 SOI/EOI 标记。
- `errors` 统计 onFrame 抛错；`consoleErrors` 收集 console error 与 pageerror。
- 焦点检查：点击 `#text` → 读 `activeElement`；按 Tab → 再读；Escape 后从事件日志确认 keydown。

隔离与安全：只访问 loopback fixture；Playwright 启动的 Edge 在本脚本结束时关闭；未使用真实 DSH `desktop`/`web` profile；未截图作为唯一证据。

## 3. Screencast

### 3.1 汇总

| mode | frames | fps | unique fps | first frame | KB/frame | capture avg/p95/max (ms) | JPEG | errors | pass |
|---|---:|---:|---:|---:|---:|---|---|---|---|
| headless | 988 | 98.7 | 98.7 | 24 ms | 20.2 | 7.4 / 12.9 / 27.0 | 完整 | 0 | PASS |
| headful | 983 | 98.3 | 98.3 | 18 ms | 20.1 | 5.4 / 8.1 / 13.4 | 完整 | 0 | PASS |

### 3.2 稳定性

| second | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| headless | 97 | 99 | 99 | 99 | 99 | 99 | 97 | 100 | 99 | 99 |
| headful | 98 | 99 | 98 | 97 | 99 | 99 | 99 | 95 | 100 | 98 |

每秒波动在 95–100 之间，没有掉到 0 的秒。输出里偶发第 11 个桶（1 帧）是运行时长略超 10 s 的边界产物，`fps` 按实际时长计算，不影响结论。

### 3.3 解释与实现影响

- **这是上限而非常态**：fixture 有持续动画，CDP screencast 只在画面变化时发帧；98–99 fps 表示 Playwright 驱动的 Edge 在本地能交付的最大速率（headless 不做 vsync 节流），不是显示器帧率。静态页面帧数会显著更低。
- **带宽**：约 20.2 KB/帧 × 98.7 fps ≈ **2.0 MB/s**，与 S1 的 30 fps × 76.7 KB ≈ 2.2 MiB/s 同量级。loopback 可承受，但产品不应无节制转发。
- **T020 加节奏控制**：用 `Page.startScreencast` 的 `everyNthFrame` 或 host 侧按目标 30 fps 限量；默认 30 fps 时约 0.6 MB/s。S1 已证明 30 fps 足够，S3 说明上限有余量。
- 首帧 18–24 ms，满足“打开即可见”的体感要求；T020/T025 的加载态仍需覆盖慢启动。

## 4. 输入延迟

| action | headless dispatch/paint (ms) | headful dispatch/paint (ms) | 结果 |
|---|---|---|---|
| click（`#hit`） | 4.1 / 8.4 | 1.1 / 0.6 | `status=clicked` |
| wheel 900 px | 26.8 / 25.2 | 25.2 / 24.2 | `scrollY=900` |
| ASCII 键盘 `abc` | 4.6 / 7.6 | 1.7 / 6.0 | `value=abc` |
| `Input.insertText` 中文 | 6.2 / 1.9 | 1.7 / 0.9 | `你好，世界` |
| 逐字 `type` 中文 | 1.9 / 3.2 | 1.6 / 4.5 | `中文` |
| IME 提交 | 2.1 / 6.0 | 1.5 / 6.9 | `你好` |

- 最大 26.8 / 25.2 ms 来自滚轮，主要是平滑滚动与渲染；点击/键盘/文本在 1–9 ms。
- 这是 **CDP 派发 → 页面事件/绘制** 的延迟，不含 DSH client 点击 → host HTTP → CDP 的路径。按当前余量，T021 的端到端 < 200 ms 有充足预算，但集成测试必须实测端到端，不能复用本表。
- 焦点：点击 `#text` 后 `active=text`，Tab 后 `active=ime`，Escape keydown 正常送达；没有焦点错乱或卡死。

## 5. 中文输入

| 路径 | 结果 | 产品用途 |
|---|---|---|
| `Keyboard.insertText`（预组合文本） | `你好，世界` 正确，dispatch 6.2/1.7 ms | Studio 侧组合完成后提交的主路径（T022） |
| 逐字 `Keyboard.type` | `中文` 正确，1.9/1.6 ms | 无 IME 时的回退/粘贴替代 |
| CDP `Input.imeSetComposition` + `Input.insertText` | `你好` 正确；`compositionstart/update/end` 共 5 个事件，6 个 `isComposing` | 验证页面侧组合事件链；host 不需要自己实现组合 |

**产品映射：** 客户端隐藏 textarea 承接真实系统 IME → `compositionend` 时把提交文本发给 host → host 用 `Input.insertText` 写入 preview。S3 证明了 host 侧提交和页面侧事件链都可用。

**回退：** 若真实 DSH 载体里的 IME 不工作，回退为逐字发送按键或“粘贴文本”方式；UI 明示“中文输入受限，可用外部浏览器打开”。按 §7，回退尚未触发。

## 6. 与计划假设的对照

| 假设 | 结果 |
|---|---|
| S3 通过标准：≥10 fps、输入 <200 ms、中文正确、焦点/Esc/Tab 正常 | 全部满足 |
| D4 输入走一元 fetch，不逐帧往返 | 单次派发 1–27 ms，成立；建议 T020 帧与输入通道分开 |
| T020 直接转发 screencast 帧 | 需要限速；否则 2 MB/s 持续带宽 |
| T022 隐藏 textarea + composition → `insertText` | host 侧路径已验证；真实 IME 待手测 |
| Playwright headless 渲染异常需回退 headful | 未出现；两种模式均正常 |

## 7. 限制与风险

1. **真实 OS IME 未在 DSH 载体中测试**：spike 用 CDP 直接模拟组合，未经过 DSH client 的隐藏 textarea 和 Electron/WebView2 输入栈。T022 必须用 Microsoft Pinyin 在 Web 与 Desktop 各手测一次“你好，世界”，失败即启用 §5 回退。
2. **headful 是 Playwright 启动的 Edge，不是 DSH Desktop 的 Electron**；host 侧 CDP 面相同，但客户端输入栈不同。不能把 headful 结果当成 Desktop IME 证据。
3. **延迟是 loopback 本机**：跨进程/HTTP 排队、DSH 渲染负载未计入；余量充足但不能外推。
4. **fps 依赖内容**：静态页面发帧更少；`fpsBySecond` 的边界桶仅为分桶产物。
5. **未联合测量“输入 → 新 screencast 帧到达”**：输入延迟在页面内测，帧延迟单独测。T021/T020 集成测试应补端到端测量。
6. **无 soak/内存结论**：S3 只跑 10 s；长时间稳定性由 S1（10 min stream soak）与 T058 覆盖。

## 8. 对 G0 的建议

- **输入**：go。点击/滚轮/键盘走 CDP `Input.*`，中文提交走 `Input.insertText`。
- **中文**：go with manual verification。架构采用客户端组合 + host `insertText`；T022 手测系统 IME，保留逐字/粘贴回退。
- **帧**：go。T020 用 stream 为主（S1）、加 30 fps 节奏控制（S3 §3.3），pull 回退不变。
- **headless**：可作为 CI/自动化默认；headful 用于手测对照。

## 9. 复现

```bash
pnpm typecheck
pnpm spike:s3 --seconds 10
# 单模式：
pnpm spike:s3 --seconds 30 --mode headless
```

输出写入 `spikes/s3/results.json`；脚本在任一验收项失败时以非零码退出。

## 10. 证据

- 驱动与 fixture：[`run.ts`](./run.ts)、[`fixture.html`](./fixture.html)。
- 原始结果：[`results.json`](./results.json)（`generatedAt: 2026-10-26T04:37:24.630Z`，`pass: true`）。
- 相关：S1 帧传输 [`../s1/REPORT.md`](../s1/REPORT.md)；S2 handoff [`../s2/REPORT.md`](../s2/REPORT.md)。
