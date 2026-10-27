# S8 进程生命周期 spike — 报告

- 日期：2026-10-27
- 任务：T018（M2）
- 运行命令：`pnpm tsx spikes/s8/run.ts`
- 脚本：`spikes/s8/run.ts`；原始数据：`.tmp/logs/s8-results.json`（gitignore）
- 结论：**通过**。启动、停止、孤儿清理、端口冲突均达到验收标准，可以据此实现 T019 supervisor。

## 1. 环境与测量方法

| 项 | 值 |
|---|---|
| OS | Windows 11（10.0.26100），x64 |
| Node | v24.13.0 |
| Vite | 8.3.5（`node_modules/vite/bin/vite.js`） |
| fixture | `fixtures/vite-basic`（React 19 + Vite 8） |
| 端口 | 每次用 `node:net` 监听 `127.0.0.1:0` 取空闲端口，随进程结束释放；全部带 `--strictPort` |
| 进程读取 | PowerShell 5.1 `Get-CimInstance Win32_Process` 读取 `ProcessId/ParentProcessId/Name/CommandLine`，按 PID 父子链判断后代；按命令行（`vite.js`/`fixtures/vite-basic`/`S8_VITE_BIN`）二次确认后才强杀，避免 PID 复用误杀 |
| 就绪判定 | TCP connect 成功 + `GET /` 返回 200；Vite `ready/Local:` 日志只作参考，不作门槛 |

所有场景串行执行，每个场景结束都检查端口与进程；脚本 `finally` 兜底清理所有记录过的 PID（同样先校验命令行）。

## 2. 启动耗时

3 次全新 spawn（冷启，不预热 Vite）：

| 运行 | 端口 | spawn→TCP | spawn→HTTP 200 | spawn→ready 日志 |
|---|---|---|---|---|
| 1 | 51202 | 387 ms | 405 ms | 362 ms |
| 2 | 51225 | 380 ms | 398 ms | 365 ms |
| 3 | 51242 | 410 ms | 430 ms | 380 ms |

- 同环境另两轮（共 9 次 spawn）：HTTP 就绪 393–469 ms，中位数 **417 ms**，最大 469 ms。
- 验收线 10 s，余量约 20 倍。ready 日志通常比 HTTP 早 20–45 ms，不能替代真实探测。

**结论**：按 HTTP 200 判就绪，10 s 超时足够；可直接用 spawn 时间戳计时。

## 3. 停止与进程树

### 3.1 直接 spawn（`shell:false`）+ `child.kill()`

| 指标 | 值 |
|---|---|
| 进程退出 | 14–15 ms |
| 端口释放 | 14–15 ms |
| 已记录后代 | 0 |
| 存活后代 | 0 |

原因：Node 24 在 Windows 上把非 detached 子进程放进 job object（`IsProcessInJob` 实测为 **true**），父进程被终止时 job 关闭，子进程随之清理。Vite 8 本场景没有独立 esbuild 子进程。

**这是当前 Node 版本的实现细节，不能当契约依赖**；T019 仍应按“显式杀树 + 验证”实现。

### 3.2 `taskkill /PID <pid> /T /F`

3 次启动场景均在停止阶段执行，结果稳定：

| 运行 | 退出 | 端口释放 | 存活后代 |
|---|---|---|---|
| 1 | 515 ms | 515 ms | 0 |
| 2 | 517 ms | 517 ms | 0 |
| 3 | 435 ms | 436 ms | 0 |

另两轮 509–598 ms。treekill 比直接 kill 慢约 0.4–0.6 s（taskkill 进程本身启动 + 系统调用），仍在可接受范围。

### 3.3 `shell: true`（cmd.exe 中转）的孤儿风险

场景：`node(脚本) → cmd.exe → node(vite)`，就绪后只杀 cmd.exe（不带 `/T`）。

| 指标 | 值 |
|---|---|
| 记录的 vite 后代 | 1（`node.exe`） |
| 杀 cmd 后存活 | **1** |
| 孤儿仍占用端口 | **是** |
| 按记录 PID 直接强杀后 | 全部退出、端口释放 |

原因：cmd.exe 不是 Node 父进程，不会创建 job object；vite 的父链仍指向已死的 cmd，只能按已记录的 PID 清理。**这就是 supervisor 必须记录 PID、并在停止后校验的原因**。若必须用 shell 启动，`/T` 是必需的，不能只杀 shell。

### 3.4 清理校验

脚本结束时：残留 vite 进程 **0**，仍监听端口 **0**。所有场景结束后未发现 `playwright`、Edge 或测试 fixture 相关残留（本 spike 不启动浏览器）。

## 4. 端口冲突

占用端口后以 `--strictPort` 启动 Vite：

| 指标 | 值 |
|---|---|
| 退出码 | 1 |
| 退出耗时 | 366–484 ms |
| stderr 首条可读信息 | `Error: Port <port> is already in use` |

Vite 在启动早期即失败，输出包含端口号与 `already in use`，可直接透传给 UI（再补一句“换端口或先停止占用进程”）。注意：先探测空闲端口再启动仍有竞态，**端口冲突以真实启动结果为准**（`EADDRINUSE`/strictPort 退出）。

## 5. 对 T019（Dev server supervisor）的结论

1. **启动**：用 `spawn(process.execPath, [viteBin, ...])`，`shell:false`，`stdio: ['ignore','pipe','pipe']`，`windowsHide:true`；不要经 cmd.exe。记录根 PID、启动时间、命令。
2. **就绪**：轮询 `http://127.0.0.1:<port>/` 直到 200，间隔 50–100 ms，总超时 10 s；日志只用于展示。
3. **端口**：启动前用 `listen(0)` 取空闲端口；启动失败优先识别 strictPort/`EADDRINUSE`，映射成可读错误（含端口），不要静默换端口（与 fixture `strictPort` 一致）。
4. **停止**：Windows 上执行 `taskkill /PID <rootPid> /T /F`，随后等待进程退出、端口关闭（各 5 s 上限）；同时对照停止前记录的后代 PID 列表，确认全部消失。仅用 `child.kill()` 在 Node 24 下“碰巧”干净，不作为实现依据。
5. **兜底**：停止前记录后代 PID；超时或父进程已死时按“PID + 命令行匹配”逐个强杀（本 spike 3.3 已验证），防止 PID 复用误杀。
6. **日志**：ring buffer 保留 stdout/stderr，启动失败时把首条错误行（如端口冲突）作为错误消息来源。
7. **验收对照**：启动 < 10 s（实测 ~0.4 s）、停止无孤儿（treekill 3/3）、端口冲突可读（实测 `Error: Port … is already in use`）。

## 6. 限制与后续

- 只在当前机器、Windows 11 + Node 24.13 + Vite 8.3.5 测量；Node job object 行为随版本可能变化，已按“不依赖”处理。
- 未覆盖：Vite 进程自行崩溃/非零退出、端口占用后释放再启动、长时运行内存、pnpm/npm 作为启动器（会多一层 node 进程；T019 单测用假进程覆盖）。
- 未测 `taskkill` 的退出码分布（本机均为成功）；T019 应处理“进程已不存在”视为成功。
- 本 spike 不写产品代码，supervisor 实现见 T019：`src/host/targets/process/{supervisor,logs}.ts`。
