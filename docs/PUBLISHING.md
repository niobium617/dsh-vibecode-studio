# Public release checklist

The repository starts private while the implementation is unstable. Before changing visibility to public:

## Content

- [ ] Run a repo-wide grep for absolute paths (e.g. `F:\`, `/Users/`, `/home/`) and replace machine-specific paths with placeholders such as `<DSH_ROOT>` and `<repo>`; check `tasks/`, `docs/`, README, and spike reports.
- [ ] Confirm `git log -p` contains no tokens, credentials, private URLs, or personal data.
- [ ] Confirm `.tmp/`, `spikes/s1/bench.json`, `spikes/s1/metrics.jsonl`, `spikes/s1/package/lib/`, `spikes/s2/package/lib/`, and `spikes/s2/.build/` are untracked.
- [ ] Confirm `spikes/s1/REPORT.md` and `spikes/s2/REPORT.md` contain no machine paths, tokens, session ids, or local-profile state.
- [ ] Keep only evidence that a fresh reader can reproduce. Do not publish local-only profile state.
- [ ] Confirm `__vibeS1` and `__vibeS2` exist only in the spikes and are documented as spike-only; remove or gate them before the product package ships.
- [ ] Record license/provenance for any borrowed design or code; no unverified or incompatible snippets.

## Repository presentation

- [ ] README is accurate about status and installability.
- [ ] Add the GitHub description, topics, and social preview.
- [ ] Confirm CI is green on `main`.
- [ ] Add a short GIF or screenshot of the preview + annotation flow once T003 exists. Use a synthetic demo app, not a private project.
- [ ] Check docs links and code fences.
- [ ] Confirm `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md` are present.

## Verification

- [ ] `pnpm typecheck` passes on a clean install.
- [ ] `pnpm spike:s1` passes both modes (local loopback: fps ≥ 10, zero errors/invalid frames). This benchmark does not exercise the client's document-relative `appRoute()` or the Desktop `dsh-app://` fetch bridge; repeat the Web/Desktop carrier acceptance in `spikes/s1/REPORT.md` §5–6, whose setup is environment-specific.
- [ ] `spikes/s1/soak.mjs` completes a 600 s stream run on Web and isolated Desktop with `packageChanged: false`, zero reconnects, and < 50 MB memory growth.
- [ ] `pnpm spike:s2:build` passes; manually repeat the text/no-auto-send/clipboard/session checks in `spikes/s2/run.md` on Web and isolated Desktop. Direct `createDrafts` attachment behavior is experimental and must not be presented as a public product path.
- [ ] README/CONTRIBUTING warn to run `pnpm spike:s1:build` and `pnpm spike:s2:build` before linking the spike packages.
- [ ] CI is green on the release commit.

## Safety

- [ ] The preview defaults to localhost and rejects restricted schemes/hosts.
- [ ] No secret ever crosses the host/client boundary.
- [ ] No automatic send, approve, or commit behavior.
- [ ] CDP endpoints stay local and process trees are cleaned up.

## History

If the private history contains material that should not become public, create a clean release branch with a squashed initial commit before flipping visibility. Do not rewrite history while others are collaborating on the private repository.
