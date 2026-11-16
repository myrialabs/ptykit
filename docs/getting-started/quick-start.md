# Quick start

Install, mount a server, and attach a browser terminal to it.

## Install

```sh
bun add @myrialabs/ptykit          # or: npm i @myrialabs/ptykit / pnpm add @myrialabs/ptykit
```

The PTY backend is an **optional** dependency resolved at runtime: `bun-pty` on
Bun, `node-pty` on Node. For the Node WebSocket server, `ws` is used (also
optional). Browser peers (`@xterm/xterm`, `@xterm/addon-fit`) and `svelte` are
optional peer dependencies you already have in a frontend project. See
[Backends](../operations/production.md#backends) for the bun-pty/node-pty
status and which one gets installed for your runtime.

## Server

`createPtyKitServer` wraps a `PtyKitManager` (the transport-agnostic session
engine) with a WebSocket transport.

```ts
import { PtyKitManager, createPtyKitServer } from '@myrialabs/ptykit';

const manager = new PtyKitManager();
const server = createPtyKitServer(manager, {
  path: '/pty',
  authorize: (ctx) => ctx.conn.data.user?.canAccess(ctx.namespace) ?? false,
});

Bun.serve({ port: 3000, fetch: server.fetch, websocket: server.websocket });
```

On Node, attach to an `http.Server` instead (uses the optional `ws` package):

```ts
import http from 'node:http';
const httpServer = http.createServer(app);
await server.attach(httpServer);
httpServer.listen(3000);
```

`authorize` **defaults to allow-all** so this snippet runs as-is for local
development — see [Production](../operations/production.md#security) before
deploying anywhere network-reachable.

## Browser

`mountTerminal` is the ready-to-use client path: hand it a container and a
`url`, and it creates the xterm terminal, attaches a `FitAddon`, opens the
session, and wires output⇄input.

```ts
import { mountTerminal } from '@myrialabs/ptykit/client';

await mountTerminal(document.getElementById('term'), {
  url: '/pty',
  namespace: 'demo',
  sessionId: 'terminal-1',
  create: true,
  onStatus: (s) => console.log(s), // 'connected' | 'reconnecting' | 'disconnected'
});
```

Prefer full control over the terminal instance? Drop down to `PtyKitClient`
directly:

```ts
import { PtyKitClient } from '@myrialabs/ptykit/client';

const client = new PtyKitClient({ url: '/pty', namespace: 'project-42' });
const session = await client.attach('project-42-terminal-1');
session.onData((chunk) => term.write(chunk));
term.onData((data) => session.write(data));
```

## Svelte

```svelte
<script>
  import { PtyTerminal } from '@myrialabs/ptykit/svelte';
</script>

<PtyTerminal sessionId="project-42-terminal-1" url="/pty" namespace="project-42" create />
```

## Cheat sheet

| Task | API |
| --- | --- |
| Create the manager | `const m = new PtyKitManager({ scrollback: 5000 })` |
| Mount on Bun | `Bun.serve({ fetch: server.fetch, websocket: server.websocket })` |
| Mount on Node | `await server.attach(httpServer)` |
| Terminal (vanilla) | `await mountTerminal(el, { url: '/pty', namespace, sessionId, create: true })` |
| Attach (client) | `await client.attach(sessionId)` |
| Create (client) | `await client.create({ cols, rows })` |
| Stream output | `session.onData((chunk) => term.write(chunk))` |
| Send keystrokes | `session.write(data)` |
| Resize | `attachFit(session, term, fitAddon)` |
| Svelte | `<PtyTerminal {sessionId} url="/pty" namespace="project-42" />` |

## Where next

- [Core concepts](../essential/core-concepts.md) — the vocabulary: sessions,
  rooms, reattach, `authorize`, backend auto-detect.
- [Server](../sdk/server.md) / [Client](../sdk/client.md) / [Svelte](../sdk/svelte.md)
  — the full SDK surface per entry point.
- [Examples](../../examples/README.md) — runnable scenarios covering
  collaboration, reattach, reconnect, and authorization.
