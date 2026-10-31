# Contributing

DSH Vibecode Studio is in early development (pre-alpha). Small, well-scoped changes with evidence are more useful than large speculative patches.

## Development setup

1. Install Node.js 24 and pnpm 11 (`packageManager` pins the expected pnpm version).
2. Run `pnpm install`.
3. Run `pnpm typecheck` — TypeScript across host, client, tests, and scripts.
4. Run `pnpm test` — the vitest suite (host, client, contracts, security). It needs no network access and no DSH installation.
5. Run `pnpm build` — produces `lib/index.js`, `lib/agent.js`, and `lib/client.js`.

Focused runs: `pnpm test -- <path>` does **not** filter; use `pnpm exec vitest run <path>` instead.

Environment-specific checks (optional, require a local DSH install):

- `pnpm test:security` — security suite only.
- `pnpm test:e2e` — Playwright end-to-end against a real DSH; set `VIBE_DSH_BIN` to the DSH launcher.
- `pnpm test:soak` — 30-minute, 100-annotation soak run.
- `pnpm fixture:dev` — serves the demo web app at `http://127.0.0.1:4320` for manual preview/inspect testing.

Manual DSH runs use a throwaway profile such as `vibe-dev`. Do not modify the `desktop` or `web` profiles directly.

`spikes/` holds the transport and composer feasibility evidence behind the design. Only spike work needs `pnpm spike:s1:build` / `pnpm spike:s1`; `spikes/s1/package/lib/` is generated and gitignored, so build before linking a spike package into a profile. Do not rebuild a linked spike package while a Web/Desktop benchmark or soak is running: DSH hot-reloads the client bundle and the running measurement is discarded.

For unfamiliar functionality, first survey actively maintained GitHub projects with a clear license. Compare their design, dependencies, and known issues; prefer proven approaches, but do not copy incompatible or unverified code. Validate the chosen approach against this project and record the comparison in the task or spike notes.

## Before opening a pull request

- Keep changes focused; split unrelated refactors out.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- Add or update tests for behavior and protocol changes; put security regressions in `tests/security/`.
- If transport or timing behavior changed, include the benchmark output in the PR description.
- Update the relevant task line and verification note in `tasks/todo.md` when a planned task is finished.
- If a plan assumption turns out to be wrong, update `docs/SPEC-vibecoding-studio.md` and `tasks/plan.md` first. Do not silently change scope.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(s1): add long-poll pull transport
fix(s1): keep stream state per request
docs(repo): add public review checklist
```

Keep commits reviewable and reversible. Do not commit build outputs, local measurements, or secrets.

## Security and privacy rules

These are non-negotiable for this project:

- Host/client communication goes through `ctx.connection`.
- Page and API content are untrusted input.
- Secrets belong in `ctx.credentials`; UI may only read `describe` metadata.
- Preview targets are localhost by default. Non-local targets require explicit user approval.
- Do not add automatic sending, approving, or committing.
- Do not attach to arbitrary CDP endpoints or expose CDP to the network.
- Sanitize logs and exported context (authorization, cookie, token, password fields).

## Review

Maintainers review for correctness, security boundaries, test evidence, and documentation. Changes that alter a protocol or a SPEC acceptance criterion need an explicit note in the PR.
