# 打包与发布（T060）

> 版本：`dsh-vibecode-studio@0.1.0`（pre-alpha）· 更新：2026-10-31
> 面向维护者。用户安装与使用见 [USER-GUIDE.md](./USER-GUIDE.md)；安全边界见 [SECURITY.md](./SECURITY.md)。
> 发布 npm 需要用户显式批准（SPEC §9 “Ask First”），因此当前 `package.json` 保持 `"private": true`。

## 1. 版本策略

- 单一 npm 包 `dsh-vibecode-studio`，用 subpath exports 暴露三个入口：
  `.`（host）、`./agent`（agent preset 入口）、`./client`（loader 包裹的客户端 bundle）。
- pre-alpha 阶段版本号保持 `0.1.0`，破坏性变更直接改 `version`，不维护多版本并存。
- `engines` 声明 Node `>=24`、DSH `>=0.2.1-rc.2`；DSH 升级到不兼容版本时提升下限并在本文件记录。

## 2. 包内容（`files` 白名单）

`package.json` 的 `files` 是唯一白名单，`src/`、`tests/`、`fixtures/`、`spikes/`、`docs/` 都不进包。

| 路径 | 来源 | 说明 |
|---|---|---|
| `lib/index.js` | `scripts/build-host.mjs` | host 入口（ESM） |
| `lib/agent.js` | `scripts/build-host.mjs` | `src/host/agent/preset.ts` 的入口，被 `exports['./agent']` 引用 |
| `lib/client.js` | `scripts/build-client.mjs` | esbuild 产物，包裹为 `window.__ModuleLoader__.load(...)` |
| `presets/vibe-studio/cordis.patch.yml` | 源文件 | `dsh.bundle.patch` 第二项：preset 行 + `vibe-tools` 工具集 |
| `skills/vibecoding-studio/**` | 源文件 | 内置技能与 `references/`，由第二个 skill provider 挂载 |
| `cordis.patch.yml` | 源文件 | `dsh.bundle.patch` 第一项：`vibe-studio` 与 `vibe-skill-bundled` 两行 |
| `package.json` / `README.md` / `LICENSE` | npm 自动包含 | `README.md`、`LICENSE` 由 npm 强制加入，无需列入 `files` |

**与 SPEC §8.6 的偏差（有意）**：SPEC 只列了 `lib/`、`skills/`、`presets/`、README、LICENSE；
实际还必须带 `cordis.patch.yml`，否则 `dsh.bundle.patch` 指向的文件不在包里，
安装后 profile 组合配置里不会出现 `vibe-studio` 行。三个静态入口（两处 patch + `skills/`）
都用相对包根的路径，因此 tarball 与 `link:` 两种安装方式行为一致。

**运行时依赖**：`@deepseek-ai/schemastery`、`playwright-core`。
`playwright-core` 在 `src/host/targets/web/launch.ts` 里被运行时按需 `import()`，
所以必须在 `dependencies` 而不是 `devDependencies`，否则干净安装后预览报
`playwright-core is not installed`（T060 发现并修复的问题）。`react`/`react-dom`
保持 devDependency：客户端 bundle 把 `react`、`react/jsx-runtime` 标为 external，由 DSH loader 提供。

## 3. 构建与打包

```bash
pnpm install          # 确保 lockfile 与 package.json 一致
pnpm typecheck
pnpm test
pnpm test:security
pnpm build            # lib/index.js + lib/agent.js + lib/client.js
npm pack --dry-run    # 先看清单，核对只有上表文件
npm pack              # 产出 dsh-vibecode-studio-0.1.0.tgz
```

`pnpm build` 会先跑 `scripts/build-host.mjs`（tsc/esbuild 多入口）再跑
`scripts/build-client.mjs`（esbuild + loader 包裹），两者都校验入口可被 import。
产物放 `.tmp/` 或仓库根，二者都已 gitignore/npmignore 覆盖（`lib/` 本身是构建产物但被 `files` 显式包含）。

### 打包前检查清单

1. `pnpm typecheck` 与 `pnpm test` 全绿；`pnpm test:security` 全绿。
2. `npm pack --dry-run` 的文件清单与第 2 节表格完全一致（无 `src/`、`tests/`、`.tmp/` 泄漏）。
3. 打出的 `package.json` 里 `dependencies` 含 `playwright-core`，`exports` 四项齐全，`private` 仍为 `true`（未获批准前）。
4. `lib/client.js` 含 `window.__ModuleLoader__.load`，且不含 `react` 的打包副本。
5. 在一台没有本仓库 `node_modules` 的环境（或先删 `vibe-dev` 里的链接）做一次干净安装冒烟。

## 4. 干净 profile 安装验证（2026-10-31 实测）

前提：`vibe-dev` profile 里先移除开发链接，确保装的是 tarball 而不是源码目录。

```bash
dsh plugin --profile vibe-dev remove dsh-vibecode-studio
dsh plugin --profile vibe-dev add file:<repo>/.tmp/pack/dsh-vibecode-studio-0.1.0.tgz
dsh --profile vibe-dev --dump-config
```

实测结果：

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm build` | `lib/index.js` 440.9 KiB、`lib/agent.js` 60.0 KiB、`lib/client.js` 454.8 KiB，“host entries import cleanly” | 构建输出 |
| `npm pack --dry-run` | 11 个文件，225.7 kB 打包 / 1.0 MB 解包，shasum `4b711b619cbd758f32f6be5c63a55b7292d2d459` | pack 输出 |
| tarball 安装 | `+5 packages`，profile 的 `dsh.profile.bundles` 自动追加 `dsh-vibecode-studio` | `dsh plugin add` 输出 |
| `--dump-config` | 退出码 0，1392 行；`vibe-studio`/`vibe-skill-bundled` 在 1242–1263 行，`dsh-vibecode-studio/agent` 在末行 | `.tmp/logs/t060-dump-config.txt` |
| 启动冒烟 | `GET /api/vibe/health` → `200`，`value.plugin = dsh-vibecode-studio`，`transportVersion: 1`，默认配置，0 条告警 | `.tmp/logs/t060-clean-install.json` |
| Studio E2E（tarball 安装） | `1 passed (22.9s)`：打开 Studio → 预览 → 拾取 → 标注 → 发送 → 预览可见 | `.tmp/logs/t060-studio-e2e.log` |
| 还原开发环境 | 改回 `link:` 后 profile `package.json` 与备份逐字节一致、`cordis.patch.yml` 一致；仅 4320 端口 TIME_WAIT，无监听进程 | `.tmp/logs/t060-backup/`、`ports-checked` |

冒烟脚本：`.tmp/t060-health.mjs`（启动 `dsh.cmd --profile vibe-dev --no-open --host 127.0.0.1 --port <n>`，
从 stdout 抓 token URL，用 `/?token=` 换 cookie，再请求 `/api/vibe/health`，最后 `taskkill /T /F` 清理进程树）。

## 5. 发布（需批准）

当前 `private: true`，`npm publish` 会被拒绝。获得用户批准后按顺序执行：

1. 确认版本号与 CHANGELOG/DEVLOG 对应；在干净工作树上重新 `pnpm build` + `npm pack`。
2. 把 `package.json` 的 `"private": true` 改为 `false`（或删除该字段）。
3. 用项目配置的 npm 凭据发布：`npm publish --access public`（scope 若无则不需要）。
4. 发布后立刻在一个临时 profile 里 `dsh plugin --profile <tmp> add dsh-vibecode-studio@<version>` 验证；
   验证完删除临时 profile，**不要**装进 `desktop`/`web`。
5. 回滚：`npm unpublish dsh-vibecode-studio@<version> --force` 只在 72 小时内且无下游依赖时使用；
   更稳妥的做法是发布一个修正版本并在 README 标注问题版本。

发布动作属于“外部、难以撤回”的操作：没有用户当次的明确指令不执行。

## 6. 回滚（打包/安装层面）

- 安装回滚：`dsh plugin --profile vibe-dev remove dsh-vibecode-studio`，再按需 `add link:<repo>` 回到开发态。
  还原后可用 `--dump-config` 确认组合树回到基线。
- 构建回滚：`lib/` 是产物，`pnpm build` 可从已提交的 `src/` 重建；不需要保留旧 `lib/`。
- 版本回滚：从 git 找回上一版 `package.json` / `cordis.patch.yml` / `presets/`，重新打包安装。
- `desktop`/`web` profile 任何情况下都不由本流程改动。

## 7. 已知未覆盖项

- 没有 Windows 安装器、没有自动更新通道；分发形式就是 npm tarball。
- 包内不含示例应用；E2E 用的 `fixtures/vite-basic` 只在仓库里。
- 未做多平台验证（当前只在 Windows 11 + Edge 上实测）。
- `npm pack` 的 shasum 随每次构建变化，发布时应重新记录并在 release note 中给出。
