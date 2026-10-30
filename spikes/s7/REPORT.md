# S7 OpenAPI 导入 spike — 报告

- 日期：2026-10-29
- 任务：T041（M4）
- 运行命令：`pnpm tsx spikes/s7/run.ts`
- 脚本：`spikes/s7/run.ts`；原始数据：`.tmp/logs/s7-results.json`（gitignore）
- 结论：**通过**。500 端点文档冷导入 28.67 ms、热导入中位数 16.15 ms（验收线 5 s，余量约 170 倍）；远程 `$ref` 在默认策略下被拦截且零网络请求；纯循环 `$ref` 抛可读错误、结构循环生成有界示例；36/36 检查通过。可以据此实现 T042 的解析器/映射器。
- 依赖：本 spike 零新增依赖（Node 内置模块 + `src/contracts`），仅支持 JSON 输入。

## 1. 环境与测量方法

| 项 | 值 |
|---|---|
| OS | Windows 11（10.0.26100 Home China），x64 |
| Node | v24.13.0 |
| 样例 | 脚本内生成 OpenAPI 3.0.3：100 条路径 × 5 方法（GET/POST/PUT/PATCH/DELETE）= 500 操作，10 个 tag |
| 样例内容 | 10 组 tag、全局 bearer + 每路径覆盖 api-key/basic/none、server URL 变量（`env`/`base`）、`allOf` 与自引用 schema、query/header/cookie 参数、300 个 JSON 请求体 |
| 计时 | `performance.now()` 包住 parse / bundle / map / serialize；冷启动 1 次，热启动连续 9 次取 min/median/max |
| 契约校验 | 每个映射结果用真实 `isHttpRequestSpec`（`src/contracts/api.ts`）校验 |
| 网络 | 远程 `$ref` 用例只访问脚本自起的 `127.0.0.1` fixture（`node:http`，`listen(0)`）；允许清单用例用假 fetch，不联网 |

脚本串行执行全部用例，`finally` 关闭 fixture server 并校验真实 fetch 只落在 loopback。

## 2. 500 端点导入耗时

样例文档 327,748 字节，映射后请求合计 188,801 字节。

| 指标 | 冷启动 | 热启动 min | 热启动 median | 热启动 max |
|---|---|---|---|---|
| parse（JSON + 结构扫描） | 12.76 ms | 6.51 ms | 8.68 ms | 10.56 ms |
| bundle（远程 ref，样例为 0） | 3.47 ms | — | — | — |
| map（参数/体/认证/示例） | 12.45 ms | 5.63 ms | 7.76 ms | 10.29 ms |
| serialize（请求 JSON） | 1.31 ms | 0.70 ms | 1.14 ms | 1.62 ms |
| **total** | **28.67 ms** | 12.62 ms | **16.15 ms** | 18.57 ms |

规模对照（每次 3 轮取中位数）：

| 操作数 | 文档字节 | total median | parse | map | ms/操作 |
|---|---|---|---|---|---|
| 250 | 164,976 | 6.69 ms | 3.81 ms | 2.97 ms | 0.03 |
| 500 | 327,748 | 16.15 ms | 8.68 ms | 7.76 ms | 0.03 |
| 1000 | 654,882 | 29.26 ms | 15.42 ms | 14.51 ms | 0.03 |

- 线性度良好（约 0.03 ms/操作）；1000 操作最慢一轮 32.21 ms，仍远低于 5 s。
- 解析与映射基本对半；示例生成（含 `allOf`/自引用 schema）未出现失控，900 次自引用/循环截断都是常量级开销。
- 冷启动比热启动多约 12 ms，主要是首次 JIT 与模块内 Map 初始化；真实导入只发生一次，按冷启动 29 ms 评估即可。

**结论**：5 s 预算有约 170 倍余量，导入可以放在 unary 方法里同步完成，不需要 worker。

## 3. 映射结果

| 指标 | 值 |
|---|---|
| 映射端点 | 500/500，0 skipped |
| 契约有效 | 500/500（`isHttpRequestSpec`） |
| 分组 | 10 个 tag，原样保留，首个 tag 为组名 |
| 请求体 | `none` 200（GET/HEAD）、`json` 300 |
| 认证 | bearer 350、basic 50、api-key 50、none 50 |
| 警告 | `cookie_param_unsupported` 30 |
| 生成体大小 | 单例最大 142 B，总计 42,600 B（上限 4 KiB/例） |
| 请求 JSON 总量 | 188,801 B（体上限 8 MiB） |
| 路径参数 | `/resources/0/{id}` → `/resources/0/{{id}}` |
| server 变量 | `https://{env}.example.test/{base}` → `https://api.example.test/v1/...` |

设计取舍：

- **路径参数**统一转成环境占位符 `{{name}}`，与 T036 变量语法一致；名字不符合 `API_ENV_NAME_PATTERN` 时清洗并在 `warnings` 记 `path_param_renamed`。URL 不做 `encodeURI`，避免把已有 `{{}}` 编码。
- **可选参数**保留为行但 `enabled: false`（query/header 都是），与请求构建 UI 的开关语义一致；required 参数 `enabled: true`。没有示例值的 required 参数记 `missing_param_value`，仍发送空值行。
- **cookie 参数**不支持（`HttpRequestSpec` 没有 cookie 字段），记警告并丢弃，不偷偷塞进 header。
- **禁止/非法 header** 用执行器同一份规则丢弃（`host`、`content-length` 等），`authorization` 参数在已有 auth 时丢弃并记 `authorization_param_replaced`。
- **GET/HEAD 带体**按执行器语义记 `body_dropped_for_get_head`，不生成体。
- **认证**只映射 bearer/basic/api-key，值写成 `{{schemeName}}` 占位符（T036 的密钥解析留到发送时），不把任何字面量写进导入结果。
- **server URL**：3.x 用 `servers[0]` + `variables` 默认值；2.0 用 `schemes[0]` + `host` + `basePath`。变量缺失时回退为 `{{name}}` 并记 `missing_server_variable`。
- **示例生成**优先级 `example` → `const`/`default` → `enum[0]` → `allOf` 合并 → `oneOf/anyOf` 第一支 → 类型默认值；上限 8 层 / 6 层 ref / 2000 节点 / 4 KiB / 数组 2 项 / 对象 25 属性，示例中的 `$ref` 字符串按数据保留、不解析。

## 4. 远程 `$ref` 与 SSRF

默认策略：**只允许 loopback（`127.0.0.0/8`、`::1`、`localhost`）且需显式 `allowLoopback`**；其他地址必须命中显式 `allowedOrigins`（scheme + host + port 精确匹配）。无论允许清单如何，link-local/元数据地址、`file:` 等非 http(s) scheme、URL 内凭据、相对路径一律拒绝。

| 场景 | 结果 |
|---|---|
| 公网 `https://example.com/...`（默认） | `remote_ref_blocked`，**0 次网络调用** |
| loopback + `allowLoopback` | 1 次 fetch，解析成功（含文档内相对 `$ref`） |
| 同一文档被 2 个 ref 引用 | 只 fetch 1 次（按 URL 去重） |
| 显式 origin 允许清单 | 只 fetch 允许的 origin（假 fetch 1 次） |
| fixture 302 → `169.254.169.254` | `remote_ref_redirect`，`redirect: 'manual'`，不跟随 |
| 2 MiB + `content-length` | `remote_ref_too_large`，读体前按 `content-length` 拒绝 |
| 2 MiB chunked（无 length） | `remote_ref_too_large`，读后按字节数拒绝 |
| 非法 JSON | `remote_ref_failed` + 解析错误文本 |
| HTTP 404 | `remote_ref_failed` + 状态码 |
| 远程文档 10 个 / 单文档 1 MiB 上限 | 硬上限，超限可读报错 |

SSRF 策略矩阵 13/13：公网默认、loopback 默认、loopback 允许、IPv6 `::1`、`localhost`、显式 origin、显式 origin 不同端口、`169.254.169.254`（即使允许清单）、`metadata.google.internal`、`file:`、URL 凭据、RFC1918 `10.0.0.1`、阿里云 `100.100.100.200`。

**结论**：默认零联网，远程 `$ref` 必须由调用方显式打开；即使打开，元数据/内网/非 http(s) 仍被硬拦截。全部拒绝路径错误可读（17/17 单行 ≤ 300 字符，带 `$ref` 位置）。

## 5. 循环 `$ref`

| 场景 | 结果 |
|---|---|
| 纯别名环 `PureA -> PureB -> PureA` | `ref_cycle`，消息带完整链 `A -> B -> A`，不崩溃 |
| 映射时命中纯环 | 请求体降级为 `none`，`warnings` 保留 `ref_cycle: ...`，其余端点正常 |
| 结构环 `A.b -> B`、`B.a -> A` | 4/4 端点有效，示例 `{"b":{}}`，不递归爆栈 |
| 自引用数组 `Node.children[] -> Node` | 示例 `{"id":"n1","children":[]}`（25 B），在 ref 栈处截断 |

实现取舍：**结构环与纯环分开处理**。纯 `$ref` 链（resolve 时只跟 `$ref`）遇到重复即抛 `ref_cycle`；示例生成用独立的 ref 栈，命中即返回 `undefined`（数组里表现为少一项/空数组），因此结构环不会变成错误，也不会无限展开。全局还有 128 层遍历深度、50 万节点上限。

## 6. 其他失败路径（全部可读）

| 场景 | 错误码 | 消息要点 |
|---|---|---|
| 缺失本地 `$ref` | `ref_unresolved` | 含 `#/components/schemas/Missing` 与出现位置 `/paths/...` |
| 文档 > 8 MiB | `document_too_large` | 实际字节数与上限 |
| 非法 JSON | `invalid_json` | 解析器原文 |
| 缺 `paths` | `invalid_document` | 指明缺失对象 |
| 1005 操作 > 1000 | `too_many_operations` | 实际操作数与上限 |
| 示例数据里的 `$ref` 字符串 | — | 0 个外部 ref、0 次 fetch，原样保留在 body |

## 7. 依赖调研与解析器设计取舍

按项目规则先查了 GitHub 上活跃、许可证清晰的同类项目：

| 项目 | 许可证 | 版本/活跃度 | 取舍 |
|---|---|---|---|
| `@apidevtools/swagger-parser` | MIT | v13.1.0，1209 stars，维护活跃 | **不作为依赖**：`bundle`/`dereference` 默认会主动抓取远程 `$ref`，SSRF 策略要插进去需要替换其 resolver，且会一次性全量解引用大文档；可作为行为对照 |
| `@apidevtools/json-schema-ref-parser` | MIT | v16.0.5，活跃 | 同上，解析/抓取耦合，错误模型不含本项目错误码 |
| `yaml` | ISC | v2.9.1，活跃 | 仅在 T042 需要 YAML 输入时引入；JSON 用内置 `JSON.parse` 即可 |

设计取舍：

1. **自研解析 + 解析/抓取分离**：先扫描文档收集 `$ref`，再按策略 bundle 远程文档，最后映射。SSRF 判断发生在任何 I/O 之前，天然满足“默认零联网”。
2. **懒解引用**：只在生成参数/请求体示例时解引用到需要的节点，避免全量 dereference 的循环展开与内存放大。
3. **JSON Pointer 严格实现**：percent-decode 后 `~1`→`/`、`~0`→`~`；解析失败给出 ref 原文与所在 pointer。
4. **数据位置识别**：`example`、`default`、`enum`、`const`、`examples[*].value`、`x-*` 内的 `$ref` 字符串是数据，不当作结构引用（已验证 0 fetch）。
5. **硬上限**：文档 8 MiB、1000 操作、遍历 128 层/50 万节点、远程 10 文档/单文档 1 MiB/5 s、示例 4 KiB，全部有可读错误，避免恶意文档拖死 host。
6. **只支持 JSON**：本 spike 与 T042 首版都按 JSON 输入；YAML 需要额外依赖，等有真实需求再评估（`yaml` ISC 是首选）。
7. **映射输出直接复用 `HttpRequestSpec`**，每个结果都用真实契约校验，导入器不需要第二套类型。

## 8. 对 T042（OpenAPI 导入）的结论

1. **接口**：`parse → scan/bundle → map` 三段，`map` 输出 `{ endpoints, groups, warnings, skipped }`；每段都带硬上限与稳定错误码（本报告 §4/§6）。
2. **默认策略**：远程 `$ref` 关闭（默认零 fetch）；loopback 仅在显式开关下允许；其他 origin 必须由用户显式加入允许清单；元数据/内网/非 http(s)/凭据/相对路径永远拒绝。
3. **远程抓取**：`redirect: 'manual'`、拒绝 3xx、先看 `content-length` 再读、读后复核字节数、5 s 超时、按绝对 URL 去重、文档数与总字节设上限。
4. **循环**：纯 `$ref` 链抛 `ref_cycle`（消息含完整链）；示例生成用独立 ref 栈截断结构环；GET/HEAD 不生成体。
5. **映射**：路径参数 `{{name}}`、可选参数 `enabled:false`、cookie 丢弃并警告、认证用 `{{scheme}}` 占位符、server 变量回退 `{{name}}`，全部走 `isHttpRequestSpec` 校验后再返回。
6. **UI 提示**：把 `warnings` 按类别展示（cookie 不支持、header 被忽略、示例截断、认证占位符待配置），错误消息直接展示，不吞。
7. **验收对照**：500 端点 < 5 s（实测 28.67 ms 冷 / 16.15 ms 热中位）、远程 ref 拦截（0 fetch）、循环不崩溃且可读、SSRF 矩阵 13/13、17 类错误全部单行可读。

## 9. 限制与后续

- 只在当前机器（Windows 11 + Node 24.13）测量；样例为脚本生成，真实文档的 `allOf`/递归/多 server 组合可能更慢，但 0.03 ms/操作的线性度留有足够余量。
- 只测 JSON 文档；YAML 未测（需引入 `yaml`，ISC）。
- 未覆盖：`callbacks`/`webhooks`、OpenAPI 3.1 的 `type: [string, null]` 全形态、多文件本地 `$ref`（本 spike 只允许绝对 loopback/允许 origin）、`links`/`discriminator` 语义。
- 远程 `$ref` 的 DNS 解析结果未做二次校验（本 spike 只按 hostname 判断 + 显式 origin 精确匹配）；T042 若要放开公网，需在 fetch 层再校验解析后的 IP。
- 本 spike 不写产品代码；导入器实现见 T042。
