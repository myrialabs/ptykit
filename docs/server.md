# Server

The core engine (`PtyKit`) and the WebSocket transport (`createPtyKitServer`),
both imported from `@myrialabs/ptykit`. WebSocket only — no SSE, no transport option.

## `PtyKit`

The session manager. Owns `Map<sessionId, Session>`, spawns PTYs through the
auto-detected backend, runs the output pipeline, and keeps scrollback in a
headless xterm for serialized reattach.

```ts
import { PtyKit } from '@myrialabs/ptykit';

const manager = new PtyKit({
  env: { sanitize: true, inject: { /* extra child env vars */ } }, // R2
  scrollback: 5000,                 // headless xterm lines (R6)
  idleTtl: null,                    // sessions live until killed (R4); a number opts into idle reaping
  retainExitedMs: 5 * 60_000,       // keep exited sessions this long for reconnect (R8)
  // preferBackend: 'bun-pty',      // force the backend; default = auto-detect
  // logger: myLogger,              // off by default — the core stays silent
});

await manager.createSession({ sessionId, namespace, shell?, cwd?, cols?, rows? }); // idempotent (R3)
manager.getSerializedState(sessionId); // serialized scrollback frame (R6/R7)
manager.write(sessionId, data);
manager.resize(sessionId, cols, rows);
manager.cancel(sessionId);             // Ctrl+C (R19)
manager.killSession(sessionId);        // Ctrl+C → SIGKILL, then remove (R19)
manager.clear(sessionId);
manager.list(namespace);
manager.dispose();                     // kill + remove everything
```

To extend scrollback (e.g. a disk-backed store) implement `BufferStore` and pass
`buffer: { store }` — the public API does not change.

## `createPtyKitServer`

```ts
import { createPtyKitServer } from '@myrialabs/ptykit';

const server = createPtyKitServer(manager, {
  path: '/api/pty',
  authorize: async (ctx) => boolean,  // create/attach/write/resize/kill (R10)
  room: (ctx) => ctx.namespace,       // collaborative broadcast scope (R11)
  onUpgrade: (request) => ({ user }), // attach identity at upgrade; false to reject
});
```

### Mounting

**Bun** — wire `fetch` + `websocket` into `Bun.serve`:

```ts
Bun.serve({ port: 3000, fetch: server.fetch, websocket: server.websocket });
```

**Node** — attach to an existing `http.Server` (uses the optional `ws` package):

```ts
import http from 'node:http';
const httpServer = http.createServer(app);
await server.attach(httpServer);
httpServer.listen(3000);
```

### The `authorize` hook

Called for every privileged operation with
`{ operation, namespace, sessionId?, conn }`. **Defaults to allow-all** for local
DX — production deployments MUST implement it. For session-referencing operations
the `namespace` is derived from the session itself, so a connection authorized
only for its own namespace cannot touch another's session (anti-hijack, R10).
Identity comes from `conn.data`, populated by `onUpgrade`.

### Rooms / broadcast

Output broadcasts to every connection whose `room(ctx)` matches; clients filter
by `sessionId`. This is what makes N clients ↔ 1 session collaborative. The
serialized reattach frame is unicast to the joining connection so existing
viewers are not repainted.

### Operations & events

Operations (RPC): `create-session`, `resize`, `cancel`, `kill-session`, `clear`,
`check-shell`, `pty-status`, `list-sessions`, `stream-status`, `missed-output`,
`reconnect`; plus the `input` event. Server→client events: `ready`, `output`
(with `seq`), `directory`, `exit`, `error`, `tab-created`, `tab-closed`.
