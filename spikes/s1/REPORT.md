# S1 传输 spike 报告

> 日期：2026-10-25
> 任务：T001（S1 Host ↔ Client 帧传输）
> 结论：**通过**。Web 与 Desktop 的 pull / stream 均达到 30 fps；最终选择 **stream 为主、pull 为回退**。

## 1. 结论

- 两种 profile、两种模式在 1280×800 / JPEG q70 / 目标 30 fps 下都稳定达到 30 fps，远高于 10 fps 验收线。
- 30 s 验收中，四次运行均为 0 seq gap、0 错误、0 重连、0 绘制丢帧；浏览器后台切 tab 也没有造成缺口。
- 流式延迟明显更低：Web 1.0 ms vs pull 2.7 ms；Desktop 1.6 ms vs pull 3.1 ms（客户端侧 host 时间戳到接收的延迟）。
- 10 分钟 stream soak：Web 18,001 帧、Desktop 18,000 帧，均为 30 fps，0 gap / 错误 / 重连；内存净增长远低于 50 MB。见第 7 节。
- 选型：**stream（`multipart/x-mixed-replace`）作为默认通道，pull（最新帧 GET）保留为断流/降级后备**。两者的帧格式、seq、健康检查和指标路由共用；切换不改变上层接口。
- Plan D3 原定“MVP 基线用拉取式 JPEG，S1 证明流式稳定后再切流式”；S1 已在 Desktop 与 Web 证明流式稳定，因此按计划预留的路径切换为流式主通道，并更新 `tasks/plan.md`。

## 2. 环境与方法

| 项 | 值 |
|---|---|
| OS | Windows 11 Home China 10.0.26100 |
| Node / pnpm | 24.13.0 / 11.21.0 |
| DSH CLI | 0.2.1-rc.2 |
| Desktop | 0.2.1-rc.3（Electron 44.7.0） |
| Web profile | `vibe-dev`（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + spike） |
| Desktop profile | 临时 `DSH_HOME` 下隔离的 `desktop` profile；Electron userData 用 `--user-data-dir` 指向临时目录 |
| Browser | 本机 Microsoft Edge（Playwright `channel: 'msedge'`，headless） |
| Desktop 自动化 | Playwright `connectOverCDP`，仅连接 loopback `127.0.0.1:9223` |
| 源画面 | 6 张 1280×800 合成帧循环，JPEG q70，目标 30 fps |
| 平均帧大小 | 约 76.7 KB，约 2.2 MiB/s |
| 验收时长 | 两种模式各 30 s；stream 另做 10 min soak |

隔离核对：Desktop 进程树中的 `DSH_HOME` 与 Electron `--user-data-dir` 均指向临时目录；真实 `desktop` profile 没有加载本 spike。

**测量口径：**

- `fps` = 接收帧数 / 运行时长；`fpsBySecond` 按秒分桶。
- `latency` = 客户端收到帧的时间 − host 写入帧头的 `ts`；是 host→client 的单向端到端延迟，不含输入/渲染管线。
- `decode` = 客户端 `createImageBitmap(new Blob(...))` 的耗时；绘制在解码完成后。
- `seqGaps` / `duplicates` 依据 host 递增 `seq`；`errors` 包含 HTTP/流读取/解码失败。
- `hostRss` 来自 host 响应头或 `/api/vibe/health`；`client.heap` 来自 `performance.memory.usedJSHeapSize`。
- 内存的 MB 按 10^6 字节计（与 `process.memoryUsage()` 的字节值直接换算）。
- canvas 抽样：读取左上 128×128，统计 RGB 和 > 12 的像素；16384/16384 表示非黑画面。

## 3. 协议与实现

Host 插件只使用 `ctx.connection`（`inject = ['connection']`），注册四个精确 fetch 路由：

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/vibe/health` | GET | 帧源状态、host RSS、尺寸/质量、指标文件路径 |
| `/api/vibe/frame` | GET | pull：返回最新 JPEG，带 `x-vibe-seq`、`x-vibe-ts`、`x-vibe-host-rss` |
| `/api/vibe/stream` | GET | stream：`multipart/x-mixed-replace`，每帧带 seq/ts/host RSS/dropped |
| `/api/vibe/metrics` | POST | 客户端验收报告落盘到 `spikes/s1/metrics.jsonl`（仅 spike 使用） |

客户端：

- 用文档相对路径 `api/vibe/...`（`appRoute()` 去掉前导 `/`）。Desktop 的 `dsh-app://app/` 协议处理器会把非静态请求转发给 host；使用绝对 `/api/...` 会绕过该转发。
- 两条接收循环都只保留最新 2 帧的绘制队列，过期帧计入 `drawQueueDrops`，避免解码阻塞接收。
- pull 循环在非 2xx 时退避 250 ms、请求异常时退避 300 ms；stream 在结束/异常时 500 ms 后重连，重连次数计入 `reconnects`。
- 每个运行有 generation 令牌；停止/重启后旧循环的迟到回调不会污染新报告。
- 仅 spike 使用的调试钩子 `globalThis.__vibeS1` 暴露 `start/stop/report/waitForReport/openTab/closeActiveTab/health` 等；不进入产品包。

## 4. 本地 loopback 基准（10 s）

`pnpm spike:s1`，host 与 client 在同一 Node 进程内通过 loopback HTTP 通信；不代表浏览器/Electron 路径。

| 模式 | 帧数 | fps | 首帧 | 延迟 avg/p95/max | 码率 | seq gap | 错误 | RSS 变化 |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| pull | 301 | 30.0 | 26 ms | 1.7 / 3 / 40 ms | 2250 KiB/s | 0 | 0 | 197.0 → 218.7 MB |
| stream | 300 | 29.9 | 8 ms | 1.6 / 4 / 18 ms | 2242 KiB/s | 0 | 0 | 218.7 → 221.0 MB |

结论：两者在无浏览器中间层时都无压力；差异主要出现在真实 Web/Electron 路径。pull 是首个运行，RSS +21.7 MB 含 V8 预热/JIT 开销；stream 紧接着运行，RSS +2.3 MB，不能把单轮差值直接当作泄漏速率。

## 5. Web 验收（`vibe-dev`，30 s）

| 模式 | 帧数 | fps | 首帧 | 延迟 avg/p95/max | 解码 avg/max | gap | 错误/重连/丢帧 | Host RSS 前→后 | Client heap 前→后 |
|---|---:|---:|---:|---|---:|---:|---|---:|---:|
| pull | 901 | 30.0 | 4 ms | 2.7 / 5 / 31 ms | 6.5 / 58.2 ms | 0 | 0 / 0 / 0 | 224.6 → 243.4 MB | 39.4 → 43.1 MB |
| stream | 901 | 30.0 | 8 ms | 1.0 / 2 / 19 ms | 4.8 / 13.9 ms | 0 | 0 / 0 / 0 | 243.5 → 231.7 MB | 43.5 → 44.4 MB |

恢复测试：

- **pull**：在 10 s 时打开另一个浏览器 tab 并切到前台 5 s，再切回。结果：`seqGaps = 0`，`errors = 0`、`reconnects = 0`，canvas 恢复为 16384/16384 非黑。
- **stream**：在 8 s 时关闭 spike 的 sidebar tab，2 s 后重新打开。关闭期间 canvas 不存在；重开后 canvas 恢复且流未中断（0 gap、0 重连）。
- 两次均成功 POST 指标（`saved: true`），console error 为空。
- 说明：spike 的 `Runner` 在 `apply()` 中创建并设置 `keepMounted: true`，关闭右栏 tab 只卸载 canvas，不会断流。因此这两项验证的是**切 tab / canvas 恢复**，不是网络断开后的重连；真实断线与 pull 回退由 T020 产品实现验证。

## 6. Desktop 验收（隔离 profile，30 s）

| 模式 | 帧数 | fps | 首帧 | 延迟 avg/p95/max | 解码 avg/max | gap | 错误/重连/丢帧 | Host RSS 前→后 | Client heap 前→后 |
|---|---:|---:|---:|---|---:|---:|---|---:|---:|
| pull | 900 | 30.0 | 32 ms | 3.1 / 4 / 38 ms | 3.6 / 7.8 ms | 0 | 0 / 0 / 0 | 231.9 → 242.8 MB | 39.9 → 40.5 MB |
| stream | 900 | 30.0 | 5 ms | 1.6 / 2 / 27 ms | 3.6 / 10.6 ms | 0 | 0 / 0 / 0 | 242.8 → 229.0 MB | 40.7 → 45.0 MB |

恢复测试：

- **pull**：10 s 时关闭 spike sidebar tab，5 s 后重开；canvas 在关闭期间不存在，重开后恢复；0 gap、0 错误、0 重连、0 绘制丢帧。
- **stream**：8 s 时关闭 tab，2 s 后重开；流持续，canvas 恢复；0 gap、0 错误、0 重连。
- 两次指标均成功 POST；console error 为空。
- 与 Web 相同，关闭 tab 不会断开 `Runner`；这是切 tab 恢复测试，不是网络断线测试。

## 7. 10 分钟 stream soak

> 本节覆盖 `plan.md` 的“内存增长 < 50 MB/10 min”标准；在 30 s 验收之后补测。

**方法：** Web 与 Desktop 各运行一次 600 s 的 stream，目标 30 fps；运行期间不重建或重新链接 spike 包，避免 DSH 热重载中断测量。驱动脚本在启动前后记录 `spikes/s1/package/lib/{client,index}.js` 的 mtime，若发生变化则标记本次 soak 无效。每约 60 s 通过 `/api/vibe/health` 采样 host RSS / heap，并从 `performance.memory.usedJSHeapSize` 采样 client heap；结束后用 `__vibeS1.stop()` 显式停止并等待指标 POST 落盘。

**通过标准：** 时长 ≥ 590 s；总帧率 ≥ 10 fps（目标 30）；0 断流重连；client heap、host heapUsed、host RSS 的 10 min 净增长均 < 50 MB。RSS 是进程级指标，Electron/DSH 共享进程的 GC 噪声较大，因此同时看净增长、首尾 3 分钟中位数和线性斜率，不只取单个采样点。

**结果：通过。** 两次运行均 `packageChanged: false`，时长 ≥ 590 s，每 600 个秒桶都有 29–31 帧（0 个零帧秒），断流/错误/重连/绘制丢帧均为 0。

| 环境 | 时长 | 帧数 | fps | 首帧 | 延迟 avg/p95/max | 解码 avg/max | gap / 错误 / 重连 / 丢帧 | 指标 POST |
|---|---:|---:|---:|---:|---|---|---|---|
| Web | 600.0 s | 18,001 | 30.0（每秒 29–31） | 5 ms | 1.1 / 2 / 27 ms | 5.3 / 47.8 ms | 0 / 0 / 0 / 0 | saved，2,771 B |
| Desktop | 600.0 s | 18,000 | 30.0（每秒 29–31） | 6 ms | 1.9 / 3 / 68 ms | 6.2 / 36.8 ms | 0 / 0 / 0 / 0 | saved，2,765 B |

内存（12 个采样点，约每 60 s 一次）：

| 环境 | Client heap 采样前→后 | Client heap 净增 / 斜率 | 首尾 3 分钟中位数 | Host heapUsed 前→后 | Host RSS 前→后（最大上升） |
|---|---|---:|---|---:|---:|
| Web | 39.7 → 40.1 MB | +0.36 MB / −0.53 MB/min | 46.8 → 39.9 MB | 162.4 → 163.6 MB（+1.2 MB） | 235.3 → 228.9 MB（+0.04 MB） |
| Desktop | 45.9 → 46.2 MB | +0.34 MB / −0.04 MB/min | 45.9 → 46.0 MB | 58.9 → 60.3 MB（+1.4 MB） | 229.0 → 184.4 MB（+0 MB） |

- Web 的 client heap 在 1–2 分钟有一次约 9.6 MB 的采样峰值，之后回落；10 分钟净增 0.36 MB，斜率为负。
- Desktop 的 `report.client.heapAfter` 为 50.4 MB，是 stop 后立即读取、GC 尚未运行的值；下一次采样即回到 46.2 MB。按采样序列，10 分钟净增 0.34 MB，斜率接近 0。
- 两个 host 的 RSS 都没有向上漂移（Desktop 反而下降 44.6 MB，属于进程级回收/噪声）；host heapUsed 分别 +1.2 MB 与 +1.4 MB，远低于 50 MB。
- 指标文件已由 host 落盘（`saved: true`），说明 soak 结束时 metrics POST 仍可用。
- **异常记录：** Desktop soak 的页面 console 记录了 2 条 `net::ERR_FAILED` 资源加载失败；日志没有 URL，无法归属到具体请求。传输计数器仍为 0 错误/0 重连，health 与 metrics 均正常；30 s Desktop 验收时 console error 为空。该项不影响本节的时长/帧率/内存判定，但说明 Desktop 载体自身可能产生无关的资源失败。

## 8. 假设修正与已知限制

1. **自定义 RPC channel 不可用**：`ctx.connection.rpc.handle` 在本版本会因 connection 服务自身的 fiber 缺少 `webServer` inject 而抛 `cannot get property "webServer" without inject`。内置插件使用精确 fetch 路由或 `rpc.intercept('/api')`；第三方插件应使用精确 `/api/...` fetch 路由。`ctx.webServer` 不作为通信通道。
2. **客户端路径必须是文档相对路径**：`/api/...` 在 Web 可用，但 Desktop 的 `dsh-app://app/` 需要 `api/...` 才能被协议处理器转发到 host。
3. **`engines.dsh` 必须放在包根**：DSH app-boot 读取顶层 `engines.dsh`；放在其他字段下不会生效。
4. **Windows 定时器粒度约 15.6 ms**：30 fps 需要 deadline scheduler，不能依赖裸 `setInterval(33)` 的精度。
5. **UI snapshot 不能消费帧时间样本**：`liveFps` 只读扫描 `frameTimes`；最终 `fpsBySecond` 使用独立的 `secondCounts`，不再受 UI 读取或 5000 帧环形窗口影响。
6. **Electron userData 不受 `%APPDATA%` 环境变量控制**：Windows 使用已知文件夹；隔离 Desktop 验证必须用 `--user-data-dir`，仅设置 `DSH_HOME` 只能隔离 profile，不能隔离 Electron 缓存/单实例锁。
7. **Electron 不支持 `Browser.getWindowForTarget`**：无法用 CDP 最小化窗口；切 tab 恢复用 sidebar tab 关闭/重开来验证。
8. **合成帧不是真实 screencast**：本 spike 只验证传输层；真实页面、动态内容、网络与输入延迟由 S3 验证。
9. **30 s 数据不足以单独证明无泄漏**：用 10 min stream soak 补测；pull 只做了 30 s 与本地 10 s。
10. **只测 loopback 单机**：没有代理、TLS、慢网络、休眠/唤醒等场景。
11. **切 tab 不等于断线恢复**：spike 的 `Runner` 由 `apply()` 持有且 tab 为 `keepMounted`，关闭 tab 只移除 canvas；真实 host 重启/网络断开后的重连与 pull 回退没有在 S1 中模拟，留给 T020。
12. **指标窗口**：`fpsBySecond` 使用独立计数，不受 UI 的 5000 帧环形窗口影响；latency/decode 各保留最近 40,000 个样本，覆盖 10 min × 30 fps（约 18,000 帧），更长的运行仍是滑动窗口。
13. **pull 回退的 seq 重置未覆盖**：host 插件重载会把 seq 重置为 1，而客户端 pull 的 `after` 高水位不会自动回退；S1 未模拟 host 重启。T020 在连续收到 200 但 seq 不前进时需要重新同步或切回 stream。
14. **metrics 路径标签只对 link 安装准确**：health/保存响应返回仓库相对标签，实际 `appendFile` 目标由模块位置决定；S1 固定使用 link 安装，复制安装的产品包需要改为配置或 artifact 路径。
15. **快速重启的指标竞态**：stop 后立即 start 新 run 时，旧 run 的 metrics POST 结果可能不写回旧 report；验收不依赖这个竞态。

## 9. 复现

```bash
pnpm install
pnpm typecheck
pnpm spike:s1
pnpm spike:s1:build

# Web：开发 profile（不要改 desktop profile）
dsh plugin --profile vibe-dev add link:spikes/s1/package
dsh --profile vibe-dev --no-open --host 127.0.0.1 --port 4317

# Desktop：隔离 DSH_HOME + 隔离 Electron userData
#   DSH_HOME 指向包含 profiles/desktop 的临时目录
#   --user-data-dir 指向临时 Electron 目录
#   --remote-debugging-port 仅绑定 loopback，验收后清理进程树
```

10 min soak 可用仓库内的驱动脚本复现（原始 JSON 建议写到 gitignored 的 `.tmp/`）：

```bash
node spikes/s1/soak.mjs web "<带 token 的 Web URL>" stream 600 .tmp/soak-web.json
node spikes/s1/soak.mjs desktop - stream 600 .tmp/soak-desktop.json
```

Desktop 模式只连接已启动的 loopback CDP `127.0.0.1:9223`；Web 模式用本机 Edge headless。脚本在启动前后比较 `spikes/s1/package/lib` 的 mtime，若包在运行中被重建则标记 `packageChanged: true`，该次 soak 不应作为验收证据。原始数据只在本地 `.tmp/`（gitignored）；报告中的数值来自 `spikes/s1/bench.json`、`spikes/s1/metrics.jsonl` 与本机验收输出。

## 10. 结论与后续

- T001 通过：两种 profile 均 ≥ 10 fps、30 s 不断流、切 tab 可恢复；10 min stream soak 无断流且内存稳定，报告给出选型。
- 后续 S2/S3/S4 分别验证 composer handoff、真实 screencast/输入/中文、拾取/源码。
- 产品实现阶段使用 stream 为主通道；保留 pull 路由作为断流、代理或兼容性回退。
