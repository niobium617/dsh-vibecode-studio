# 安全模型与审计（T059）

> 日期：2026-10-31 · 分支：`task/m6-verify-hardening`
> 结论：SPEC §3 FR-SEC-01..09 的 MUST 项全部有实现与回归测试；审计发现的 F1–F4、F6 已修复并加回归；F5（SHOULD，截图保留期无清理）、F7（DNS 解析后 link-local / rebinding）、F8（loopback 判定重复）作为已知残余风险记录在 §5。

## 1. 安全边界

Studio 同时处理三类不可信数据：目标页面（DOM/console/network）、外部 API 响应（含 OpenAPI 文档）、模型输出（工具参数）。边界规则：

- 页面与接口内容一律当数据，不当指令；交给模型前包进 `<untrusted-page-content>`。
- 密钥只存在 `ctx.credentials`；面板与工具只读 `describe()`（是否配置、来源、可写性），不回传值。
- 出站请求默认仅 loopback；元数据/链路本地地址永不访问。
- CDP 只连自己启动或用户已批准的端点，不监听对外地址。
- 不自动发送标注、不自动批准、不自动提交（SPEC §9）。

## 2. FR-SEC 对照

| ID | 需求 | 实现位置 | 回归证据 |
|---|---|---|---|
| FR-SEC-01 | 默认只允许 localhost HTTP(S) | `src/host/preview/url.ts` `isLoopbackHost`；`src/host/agent/tools/preview.ts` `requireLoopback` / `requireAllowedOrigin`（`preview.ts:118`、`preview.ts:127`）；非本机需 `allowNonLocal` 确认 | `tests/security/origin-policy.test.ts` |
| FR-SEC-02 | 拒绝 `file:`/`chrome:`/`devtools:`/云元数据 | `parseHttpUrl` 只接受 http(s) 且禁止 URL 内凭据（`preview.ts:99`）；`isBlockedHost`（`src/host/api/request.ts:124`）覆盖元数据、link-local、100.100.100.200；`assertRemoteAllowed` 复用同一判定（`src/host/api/openapi/resolver.ts:122`） | `tests/security/ssrf.test.ts`、`tests/security/origin-policy.test.ts` |
| FR-SEC-03 | 密钥存 `ctx.credentials`，集合只存引用 | `src/host/api/secrets.ts`；`describe()` 只返回 `{configured, writable, source?}`；无 provider 时 `available=false` 且写入 `permission_denied` | `tests/security/redaction.test.ts`（credential seam） |
| FR-SEC-04 | Header/query/body 脱敏 | `src/contracts/redact.ts`（header、query、fragment、嵌套 JSON、`{{placeholder}}` 保留）；`src/host/api/result-redaction.ts` 清 URL/跳转/header；`history.json` 写入前脱敏 | `tests/security/redaction.test.ts` |
| FR-SEC-05 | 页面文本/接口响应按不可信内容包裹 | `src/contracts/untrusted.ts` `wrapUntrustedPageContent`（转义 `<`）；标注注释在包裹外；`collectDomOutline` 跳过 hidden/aria-hidden/script | `tests/security/untrusted-boundary.test.ts` + `fixtures/security-injection/` |
| FR-SEC-06 | CDP 只连自己启动或批准的端点 | `src/host/targets/web/adapter.ts` 唯一 `newCDPSession`（自己的 page）；无 `connectOverCDP` / `remote-debugging` / `0.0.0.0` | `tests/security/exposure.test.ts` 静态扫描 |
| FR-SEC-07 | 进程树清理，异常退出不留孤儿 | `src/host/targets/process/supervisor.ts`（`taskkill /T /F`、记录子进程 PID 兜底、等待端口释放、`survivors` 报告） | `tests/security/cleanup.test.ts`（真实 Windows 进程，含孙进程） |
| FR-SEC-08 | 截图/抓包保留期与一键清理（SHOULD） | 截图写入 `expiresAt`（`src/host/artifacts/store.ts:237`）；API 历史有 `clear()`（`history-store.ts:175`）与 `API_HISTORY_CLEAR_METHOD`；**过期未自动删除、截图无一键清理** | 见 §5 残余风险 F5 |
| FR-SEC-09 | 默认无遥测 | 无上报客户端；静态扫描禁止 `sendBeacon`/`new WebSocket`/`console.log` | `tests/security/exposure.test.ts` |

## 3. 关键实现说明

### 3.1 SSRF 与 host 规范化

- `isBlockedHost` 先把 host 规范化再判定：WHATWG `URL` 会把十进制/十六进制/八进制 IPv4 归一（`0xA9FEA9FE`、`2852039166`、`0251.0376.0251.0376` → `169.254.169.254`），IPv6 统一成压缩形式（`::ffff:a9fe:a9fe`），FQDN 的尾点需显式去掉（`metadata.google.internal.` 与 `metadata.google.internal` 是同一主机）。
- 阻断范围：`metadata`/`metadata.google.internal`/`metadata.goog`、`169.254.0.0/16`、`100.100.100.200`、IPv6 `fe80::/10`、`fd00:ec2::254`、IPv4-mapped/compatible IPv6 的链路本地/元数据地址。
- 局域网私有地址（10/8、172.16/12、192.168/16）**允许**：API 工作台是通用客户端，SPEC 只要求拒绝元数据与 link-local。

### 3.2 重定向

执行器手动跟随（`redirect: 'manual'`），每一跳重新检查协议与 `isBlockedHost`，拒绝指向元数据的跳转（`blocked_redirect`）。跨 origin 时按 `isSensitiveKey` 丢弃敏感 header（`Authorization`、`Cookie`、`X-Api-Key`、`X-Client-Secret` 等），同 origin 保留；`redirect: 'manual' | 'error'` 不跟随。

### 3.3 不可信页面内容

`wrapUntrustedPageContent` 把正文里的 `<` 转义，页面无法提前关闭包裹；DOM outline 跳过 `hidden`、`aria-hidden`、`display:none`/`visibility:hidden` 与 `<script>`；元素标注的 HTML 同样转义。控制字符（C0/C1）在 `normalizeElementText` 中被替换为空格，避免提示词拼接歧义。

### 3.4 凭据与磁盘

- `createApiSecretStore.describe()` 永远不返回密钥值；无 `ctx.credentials` 时读为不可用，而不是回落明文文件。
- `history.json` 与导出在写入前脱敏；`redactExecutionResult` 清最终 URL、每一跳 URL/Location、响应 header 中的主机解析密钥（响应 body 属于目标数据，保留原样）。
- 预览 URL 可能带 `?token=`，`vibe_status` / `vibe_observe` 输出前经 `redactUrl`（`status.ts:154`、`observe.ts:212`）。

## 4. 审计发现与处置

| # | 问题 | 严重度 | 处置 | 回归 |
|---|---|---|---|---|
| F1 | 尾点 FQDN `metadata.google.internal.` 绕过黑名单 | 高 | 规范化后去尾点再比对 | `ssrf.test.ts` blocked 矩阵 + redirect |
| F2 | IPv4-mapped/compatible IPv6、`fe80::/10`、`fd00:ec2::254`、`100.100.100.200` 未拦 | 高 | 归一化 + 扩展阻断范围 | `ssrf.test.ts`；OpenAPI `assertRemoteAllowed` 同源修复 |
| F3 | 跨 origin 重定向继续携带 `Authorization`/`Cookie` | 高 | 跨 origin 丢弃凭据；本次进一步改用 `isSensitiveKey`，覆盖自定义密钥 header | `ssrf.test.ts` 跨 origin/同 origin 两例 |
| F4 | `vibe_status`/`vibe_observe` 把带 `?token=` 的预览 URL 交给模型 | 中 | 两处输出前 `redactUrl` | `redaction.test.ts` agent tool output |
| F6 | URL fragment（`#access_token=…`）未脱敏 | 中 | `redactUrl` 增加 fragment 键值脱敏；普通锚点与 hash-router 保持原样 | `redaction.test.ts` F6 |
| 附带 | 页面文本控制字符未清理 | 低 | `normalizeElementText` 替换 C0/C1 为空格 | `untrusted-boundary.test.ts` normalization caps |

## 5. 残余风险（未在本轮修改）

| # | 风险 | 现状与原因 | 建议 |
|---|---|---|---|
| F5 | 截图/抓包过期文件不会自动删除；截图无一键清理（FR-SEC-08 为 SHOULD） | 写入时记录 `expiresAt`，读取时也不校验过期；API 历史已有 `clear()` | M6 后补 `ArtifactStore.purgeExpired()` + 面板“清空截图”；在 T060 文档中标注为已知限制 |
| F7 | 只按 host 字符串判定，不解析 DNS：指向 `127.0.0.1` 的外部域名（DNS rebinding）或解析到 link-local 的域名可绕过 | 需要在连接层固定已解析 IP；与 `fetch` 的 DNS 行为耦合，改动面大 | 后续用自定义 `lookup`/undici dispatcher 固定 IP 并重查 |
| F8 | loopback 判定在三处各自实现：`host/preview/url.ts`、`client/preview/local-url.ts`、`host/api/request.ts` | 三处当前都 fail-closed，语义略有差异（客户端不接受 URL 内凭据） | 统一到 `contracts` 一个纯函数，client 复用；改前需同步测试 |
| — | 跨 origin 重定向只丢“名字像密钥”的 header | 已由 `isSensitiveKey` 覆盖常见命名；名字不含敏感词的自定义密钥仍会跟随 | 设置项支持“重定向不携带的自定义 header 名” |

## 6. 验证方式

```bash
pnpm test:security            # 6 文件 / 90 用例
pnpm typecheck                # 0 错误
pnpm test                     # 125 文件 / 1196 用例
pnpm build                    # host 440.9 + agent 60.0 / client 454.8 KiB
```

- 聚焦单个文件用 `pnpm exec vitest run tests/security/<name>.test.ts`；`pnpm test -- <path>` 不会过滤。
- `tests/security/exposure.test.ts` 是静态扫描：新增 `connectOverCDP`、`remote-debugging`、`0.0.0.0`、`ctx.webServer`、遥测/日志调用或第二个 `createServer` 都会直接失败。
- `tests/security/cleanup.test.ts` 仅 Windows 运行（其他平台 `describe.skipIf`）：真实启动一个会再 spawn 孙进程的本地服务，断言 `taskkill /T` 后两个 PID 均消失、端口可重新监听，临时目录在 `afterEach` 删除。

## 7. 手动检查清单

1. 仅本机 fixture：`pnpm fixture:dev`（`127.0.0.1:4320`），或渲染注入页
   `pnpm exec vite --host 127.0.0.1 --port 4321 fixtures/security-injection`。
2. 打开 Studio → 预览注入页 → `vibe_observe`：可见的注入文字出现在一个 `<untrusted-page-content>` 内；hidden / aria-hidden / script 内容不出现；页面无法提前闭合包裹。
3. 协议与地址：`file:`、`chrome:`、`devtools:`、`data:`、`ftp:`、带账号密码的 URL、`169.254.169.254`、`metadata.google.internal.` 均得到明确错误，且没有发出请求。
4. 密钥：设置一个仅存在于 `ctx.credentials` 的 API token → 面板只显示“已配置/来源”，`history.json`、导出、`vibe_status`/`vibe_observe` 中均无明文。
5. CDP/预览：只用自己启动或已批准的浏览器端点；不把调试端口暴露到网络（`exposure.test.ts` 同时兜底）。
6. 清理：停止预览/开发服务后，`taskkill` 无残留、端口可复用；异常退出不留孤儿进程。
