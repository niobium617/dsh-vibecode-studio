# vite-basic fixture

Minimal React app used by Playwright E2E and, from M2 onward, by preview,
input, inspect, console/network and verification tests.

- Start: `pnpm fixture:dev` → `http://127.0.0.1:4320`
- Stop: `Ctrl+C`; the port is strict, so a stale server fails fast.
- Dev-only endpoints: `POST /api/echo`, `GET /api/boom` (500), `GET /api/slow?ms=500`.
- `Trigger console error` emits one intentional `console.error` for verify tests.

Keep elements addressable by role/label/test id; later tasks extend this app
rather than creating a second fixture.
