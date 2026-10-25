# Public release checklist

The repository starts private while the implementation is unstable. Before changing visibility to public:

## Content

- [ ] Replace machine-specific paths in `tasks/HANDOFF.md` and `docs/dsh-plugin-ecosystem-analysis.md` with placeholders such as `<DSH_INSTALL>`, `<DSH_HOME>`, and `<PROJECT_ROOT>`.
- [ ] Confirm `git log -p` contains no tokens, credentials, private URLs, or personal data.
- [ ] Review `.tmp/` and `spikes/s1/bench.json` are untracked.
- [ ] Keep only evidence that a fresh reader can reproduce. Do not publish local-only profile state.

## Repository presentation

- [ ] README is accurate about status and installability.
- [ ] Add the GitHub description, topics, and social preview.
- [ ] Confirm CI is green on `main`.
- [ ] Add a short GIF or screenshot of the preview + annotation flow once T003 exists. Use a synthetic demo app, not a private project.
- [ ] Check docs links and code fences.
- [ ] Confirm `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md` are present.

## Safety

- [ ] The preview defaults to localhost and rejects restricted schemes/hosts.
- [ ] No secret ever crosses the host/client boundary.
- [ ] No automatic send, approve, or commit behavior.
- [ ] CDP endpoints stay local and process trees are cleaned up.

## History

If the private history contains material that should not become public, create a clean release branch with a squashed initial commit before flipping visibility. Do not rewrite history while others are collaborating on the private repository.
