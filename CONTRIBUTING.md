# Contributing

DSH Vibecode Studio is in the spike phase. Small, well-scoped changes with evidence are more useful than large speculative patches.

## Development setup

1. Install Node.js 24 and pnpm 11.
2. Run `pnpm install`.
3. Run `pnpm typecheck`.
4. Run `pnpm spike:s1 --seconds 10` to exercise the current transport spike.

Manual DSH runs use a throwaway profile such as `vibe-dev`. Do not modify the `desktop` or `web` profiles directly.

## Before opening a pull request

- Keep changes focused; split unrelated refactors out.
- `pnpm typecheck` passes.
- `pnpm spike:s1 --build-only` produces both bundles.
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
