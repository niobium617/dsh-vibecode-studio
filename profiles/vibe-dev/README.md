# `vibe-dev` profile — dsh-vibecode-studio development

> DSH `0.2.1-rc.2`. **Development only.** Never install this package into the
> real `desktop` or `web` profiles.

The profile itself lives under `$DSH_HOME/profiles/vibe-dev` (outside this
repo); this page records how to install, configure and remove it.

## 1. Build and install

Run from the repository root:

```bash
pnpm install
pnpm build
dsh plugin --profile vibe-dev add link:<absolute-path-to-this-repo>
```

Use an **absolute** path for `link:`; pnpm resolves relative paths against the
profile directory. `dsh plugin add` also appends `dsh-vibecode-studio` to the
profile's `dsh.profile.bundles` via the package's `cordis.patch.yml`.

After each build, restart DSH or let the host hot-reload the package.

## 2. Start

```bash
dsh --profile vibe-dev --no-open --host 127.0.0.1 --port 4317
```

Open the tokenized URL printed by DSH. In the right sidebar, click **新标签页**
and choose **Vibe Studio**.

Check the composed profile, including this plugin's entry:

```bash
dsh --profile vibe-dev --dump-config
```

## 3. Configuration

Defaults are defined by `Config` in `src/host/config.ts` and applied by the
loader; the host exposes the resolved values as the `vibeStudio` service.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `logLevel` | `debug` \| `info` \| `warn` \| `error` | `info` | Host log level |
| `allowedOrigins` | string[] | `http://localhost`, `http://127.0.0.1` | Origins the preview may navigate to; normalized to `URL.origin` |
| `retentionDays` | integer 1–365 | `7` | Retention for screenshots, captures and logs |
| `contextBudgetBytes` | integer 1024–65536 | `8192` | Maximum bytes of untrusted page context sent to the model |
| `screenshotEnabled` | boolean | `true` | Allow screenshot capture into the artifact store |

Override values in the profile's own `cordis.patch.yml` (that is the user layer
for `$DSH_HOME/profiles/vibe-dev`, not the repo copy of this file):

```yaml
- id: vibe-studio
  config:
    logLevel: debug
    allowedOrigins:
      - http://localhost:5173
    retentionDays: 14
```

### Invalid config

Schema type/enum errors stop the plugin from activating and print a readable
`ValidationError`; unknown keys and malformed origins fail in
`resolveConfig()`. Verify without editing the profile:

```bash
cat > .tmp/t008-invalid.yml <<'YAML'
- id: vibe-studio
  config:
    logLevel: verbose
YAML
dsh --profile vibe-dev --patch .tmp/t008-invalid.yml --no-open --host 127.0.0.1 --port 4319
# dsh: warning: 1 entry did not activate
# vibe-studio (dsh-vibecode-studio): ValidationError: invalid config:
#   - $.logLevel expected "debug" | "info" | "warn" | "error" but got "verbose"
```

`--dump-config` prints the composed tree but does **not** validate configs; use
a boot or the unit tests for that.

## 4. Remove and clean up

```bash
dsh plugin --profile vibe-dev remove dsh-vibecode-studio
```

Stop any DSH process started for a test and confirm the port is released. Do
not touch `$DSH_HOME/profiles/desktop` or `.../web`; `desktop` is owned by the
Electron app and the CLI refuses to manage it.

## 5. Tests

```bash
pnpm typecheck
pnpm test          # includes tests/unit/config.test.ts
pnpm build
```
