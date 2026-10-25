# Security Policy

DSH Vibecode Studio is pre-alpha software. There is no supported release yet.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting:

<https://github.com/niobium617/dsh-vibecode-studio/security/advisories/new>

Include the affected component, reproduction steps, impact, and any suggested mitigation. You will receive an acknowledgement as soon as the maintainers can triage the report.

## Security model (planned)

- The preview is a localhost surface first. Non-local targets are rejected unless the user explicitly approves them.
- `file:`, `chrome:`, `devtools:`, cloud metadata endpoints, and private-network targets are blocked by default.
- The preview page is untrusted content. Host APIs are exposed only through narrow, exact `ctx.connection` fetch routes.
- Credentials stay in `ctx.credentials`; the browser bundle never receives secret values, only `describe` metadata.
- CDP attaches only to an already-started, approved endpoint and is never exposed to the network.
- Annotation handoff is explicit. The plugin does not send, approve, commit, or run anything on its own.

Reports that help us test these boundaries are especially welcome.
