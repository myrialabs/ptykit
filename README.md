<p align="center">
  <img src="https://ptykit.myrialabs.dev/favicon.svg" alt="PtyKit" width="72" height="72" />
</p>

<h1 align="center">PtyKit</h1>

<p align="center">
  <strong>PTY sessions over WebSocket for Node &amp; Bun.</strong><br />
  Collaborative rooms, serialized-scrollback reattach, and a resilient browser
  client — one typed API.
</p>

<p align="center">
  <a href="https://ptykit.myrialabs.dev">Website</a> ·
  <a href="https://www.npmjs.com/package/@myrialabs/ptykit">npm</a> ·
  <a href="./docs/api.md">API reference</a> ·
  <a href="./docs/server.md">Server</a> ·
  <a href="./docs/client.md">Client</a> ·
  <a href="./examples/README.md">Examples</a> ·
  <a href="https://github.com/myrialabs/ptykit/issues">Issues</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@myrialabs/ptykit"><img src="https://img.shields.io/npm/v/@myrialabs%2Fptykit" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/runtime-Node%2018%2B%20%7C%20Bun-black" alt="Node 18+ and Bun" />
</p>

---

PtyKit runs interactive shells server-side and streams them to the browser over a
single WebSocket. Output is kept in a headless terminal so a refresh, a dropped
connection, or a second viewer all replay the exact screen — no lost bytes, no
double output. The PTY backend is auto-detected (`bun-pty` on Bun, `node-pty` on
Node); you bring the auth.

```ts
// Server
import { PtyKit, createPtyKitServer } from '@myrialabs/ptykit';

const manager = new PtyKit();
const server = createPtyKitServer(manager, {
  path: '/pty',
  authorize: (ctx) => ctx.conn.data.user?.canAccess(ctx.namespace) ?? false,
});

Bun.serve({ port: 3000, fetch: server.fetch, websocket: server.websocket });
```

```ts
// Browser
import { PtyKitClient } from '@myrialabs/ptykit/client';

const client = new PtyKitClient({ url: '/pty', namespace: 'project-42' });
const session = await client.attach('project-42-terminal-1');
session.onData((chunk) => term.write(chunk));
term.onData((data) => session.write(data));
```

## Why PtyKit

- **WebSocket only** — one multiplexed control + data channel. No SSE, no
  transport option, no polling.
- **Collaborative rooms** — output broadcasts to a room (default = namespace), so
  **N clients ↔ 1 session**. Multiple viewers see the same live terminal.
- **Reattach that just works** — scrollback lives server-side in a headless
  xterm and replays as a single serialized frame. Survives refresh, disconnect,
  and tab switches with **zero data loss** and no double output.
- **Auto-detected backend** — `bun-pty` on Bun (the tested path), `node-pty` on
  Node (experimental). A Node consumer never builds bun-pty's rust/ffi, and
  vice-versa — both are optional, lazily loaded.
- **Resilient client** — reconnect with exponential backoff, heal-reconnect for
  "open but dead" sockets, and idempotency-aware resend, all on by default.
- **Bring your own auth** — an `authorize` hook enforces namespace access with
  anti-hijack ownership checks. The library ships no auth of its own.
- **Quiet, typed core** — no stdout/stderr writes, `sideEffects: false`, JSDoc on
  every export, runs on Node 18+ and Bun.

## Install

```sh
bun add @myrialabs/ptykit          # or: npm i @myrialabs/ptykit / pnpm add @myrialabs/ptykit
```

The PTY backend is an **optional** dependency resolved at runtime: `bun-pty` on
Bun, `node-pty` on Node. For the Node WebSocket server, `ws` is used (also
optional). Browser peers (`@xterm/xterm`, `@xterm/addon-fit`) and `svelte` are
optional peer dependencies you already have in a frontend.

## Entry points

| Import | What |
| --- | --- |
| `@myrialabs/ptykit` | Core session engine (`PtyKit`) + WebSocket server (`createPtyKitServer`). |
| `@myrialabs/ptykit/client` | Framework-agnostic browser client (`mountTerminal`, `PtyKitClient`, `attachFit`). |
| `@myrialabs/ptykit/svelte` | Official Svelte component (`<PtyTerminal/>`). |

## Quick start

| Task | API |
| --- | --- |
| Create the manager | `const m = new PtyKit({ scrollback: 5000 })` |
| Mount on Bun | `Bun.serve({ fetch: server.fetch, websocket: server.websocket })` |
| Mount on Node | `await server.attach(httpServer)` |
| Terminal (vanilla) | `await mountTerminal(el, { url: '/pty', namespace, sessionId, create: true })` |
| Attach (client) | `await client.attach(sessionId)` |
| Create (client) | `await client.create({ cols, rows })` |
| Stream output | `session.onData((chunk) => term.write(chunk))` |
| Send keystrokes | `session.write(data)` |
| Resize | `attachFit(session, term, fitAddon)` |
| Svelte | `<PtyTerminal {sessionId} url="/pty" namespace="project-42" />` |

## Server

`createPtyKitServer` mounts onto the HTTP server you already have.

**Bun** — wire `fetch` + `websocket` into `Bun.serve`:

```ts
Bun.serve({ port: 3000, fetch: server.fetch, websocket: server.websocket });
```

**Node** — attach to an `http.Server` (uses the optional `ws` package):

```ts
import http from 'node:http';
const httpServer = http.createServer(app);
await server.attach(httpServer);
httpServer.listen(3000);
```

The `PtyKit` manager owns the sessions and is transport-agnostic:

```ts
const manager = new PtyKit({
  scrollback: 5000,         // headless xterm lines
  idleTtl: null,            // sessions live until killed; a number opts into idle reaping
  retainExitedMs: 5 * 60_000, // keep exited sessions this long for reconnect replay
  env: { sanitize: true, inject: { MY_VAR: '1' } }, // strip runtime pollution, inject yours
});
```

See [docs/server.md](./docs/server.md) for the full surface, operations, and events.

## Collaborative rooms

Output broadcasts to a room (default = the namespace) and clients filter by
`sessionId`, so any number of clients can attach to the same session and watch
the same live terminal. The serialized reattach frame is unicast to the joining
client, so existing viewers are never repainted.

```ts
const server = createPtyKitServer(manager, {
  room: (ctx) => ctx.namespace, // or group however you like
});
```

## The resilient client

Skip the xterm boilerplate with `mountTerminal` — the framework-agnostic
counterpart to `<PtyTerminal/>`. Give it a container and a url; it creates the
terminal, fits it, opens the session, and wires output⇄input, while staying fully
configurable.

```ts
import { mountTerminal } from '@myrialabs/ptykit/client';

const { session, terminal, dispose } = await mountTerminal(el, {
  url: '/pty',
  namespace: 'project-42',
  sessionId: 'project-42-terminal-1',
  create: true,
  onStatus: (s) => render(s),
});
```

Need full control? Drop down to `PtyKitClient`. Reconnect is on by default —
exponential backoff (1s → 30s), heal-reconnect for sockets that are "open but
dead", and idempotency-aware resend. On reconnect, every known session is
re-attached so the room subscription and scrollback recover.

```ts
const client = new PtyKitClient({
  url: '/pty',
  namespace: 'project-42',
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30_000, maxAttempts: 5 },
  persistence: { load, save }, // optional: own the active-session id yourself
});

client.onStatus((s) => render(s)); // 'connected' | 'reconnecting' | 'disconnected'
```

See [docs/client.md](./docs/client.md) for `mountTerminal`, `attachFit`,
persistence, and the session API.

## Svelte

```svelte
<script>
  import { PtyTerminal } from '@myrialabs/ptykit/svelte';
</script>

<PtyTerminal sessionId="project-42-terminal-1" url="/pty" namespace="project-42" />
```

The component is fully configurable (theme, font, reconnect, lifecycle
callbacks, …). See [docs/svelte.md](./docs/svelte.md).

## Security

The `authorize` hook **defaults to allow-all** so the package is friendly to try
locally — this is unsafe in production. A network-reachable deployment must
provide an `authorize` implementation that checks the connection's identity
(populated by `onUpgrade`) against the requested `namespace`. PtyKit also rejects
cross-namespace `sessionId` access (anti-hijack), but it cannot know who your
users are — that's your hook's job.

## node-pty status

`bun-pty` is the default, tested backend. The `node-pty` adapter exists and
auto-activates under Node, but is marked **experimental** until the scale and
auto-detect benchmarks gate it. On the benchmark machine (Node 25, macOS arm64),
node-pty failed to spawn (`posix_spawnp`, reproduced with raw node-pty) — see
[bench-results.md](./bench-results.md).

## Performance

Measured on a dev laptop (Apple M2, Bun 1.3.14). Reproduce with `bun bench.ts`;
full numbers in [bench-results.md](./bench-results.md).

- **Throughput overhead** of the wrapped pipeline vs raw bun-pty: **~7%**
  (target <10%) — the cost of persist-to-headless-first + batching.
- **Reattach** serialize latency: p50 ~3–9ms, p95 ~10–19ms across 10KB/100KB/1MB
  buffers; the newest output is always present.
- **Idle footprint**: ~0.13 MB of parent-process RSS per session. In-memory
  scrollback was fine at 100 sessions — no disk spill needed.

## Documentation

- [API reference](./docs/api.md) — every export across the three entry points.
- [Server](./docs/server.md) — `PtyKit`, `createPtyKitServer`, rooms, `authorize`.
- [Client](./docs/client.md) — `mountTerminal`, `PtyKitClient`, reconnect, persistence, `attachFit`.
- [Svelte](./docs/svelte.md) — the `<PtyTerminal/>` component.
- [Examples](./examples/README.md) — runnable scenarios.

## Support

If PtyKit is useful to you, consider supporting its development:

| Method | Address / Link |
|--------|----------------|
| Bitcoin (BTC) | `bc1qd9fyx4r84cce2a9hkjksetah802knadw5msls3` |
| Solana (SOL) | `Ev3P4KLF1PNC5C9rZYP8M3DdssyBQAQAiNJkvNmPQPVs` |
| Ethereum (ERC-20) | `0x61D826e5b666AA5345302EEEd485Acca39b1AFCF` |
| USDT (TRC-20) | `TLH49i3EoVKhFyLb6u2JUXZWScK7uzksdC` |
| Saweria | [saweria.co/myrialabs](https://saweria.co/myrialabs) |

## License

MIT — see [LICENSE](LICENSE).
