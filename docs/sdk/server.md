# Server

The core engine (`PtyKitManager`) and the WebSocket transport (`createPtyKitServer`),
both imported from `@myrialabs/ptykit` (or the narrower `@myrialabs/ptykit/core`
and `@myrialabs/ptykit/server`). WebSocket only — no SSE, no transport option.

## `PtyKitManager`

The session manager. Owns `Map<sessionId, Session>`, spawns PTYs through the
auto-detected backend, runs the output pipeline, and keeps scrollback in a
headless xterm for serialized reattach.

```ts
import { PtyKitManager } from '@myrialabs/ptykit';

const manager = new PtyKitManager({
  env: { sanitize: true, inject: { /* extra child env vars */ } }, // R2
  scrollback: 5000,                 // headless xterm lines (R6)
  idleTtl: null,                    // sessions live until killed (R4); a number opts into idle reaping
  retainExitedMs: 5 * 60_000,       // keep exited sessions this long for reconnect (R8)
  outputCoalesceMs: 0,              // >0: hold an output flood to one flush per window (first chunk never delayed)
  // preferBackend: 'bun-pty',      // force the backend; default = auto-detect
  // logger: myLogger,              // off by default — the core stays silent
});

await manager.createSession({ sessionId, namespace, shell?, cwd?, cols?, rows?, env? }); // idempotent (R3)
manager.getSerializedState(sessionId); // serialized scrollback frame (R6/R7)
manager.write(sessionId, data);
manager.resize(sessionId, cols, rows);
manager.cancel(sessionId);             // Ctrl+C (R19)
manager.killSession(sessionId);        // Ctrl+C → SIGKILL, then remove (R19)
manager.clear(sessionId);
manager.list(namespace);
manager.onSessionRemoved((sessionId) => { /* kill, idle TTL or end of retain window */ });
manager.dispose();                     // kill + remove everything
```

To extend scrollback (e.g. a disk-backed store) implement `BufferStore` and pass
`buffer: { store }` — the public API does not change.

The manager's `env` is process-wide policy: hygiene plus the variables every
shell in this deployment should have. `createSession({ env })` is the per-session
half — values that differ from one session to the next. See
[Per-session environment](#per-session-environment).

## `createPtyKitServer`

```ts
import { createPtyKitServer } from '@myrialabs/ptykit';

const server = createPtyKitServer(manager, {
  path: '/api/pty',
  authorize: async (ctx) => boolean,  // create/attach/write/resize/kill (R10)
  room: (ctx) => ctx.namespace,       // collaborative broadcast scope (R11)
  env: (ctx) => ({ VAR: 'value' }),   // per-session environment, resolved server-side
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

### Embedded transport (bring-your-own-socket)

If you already run an app-wide WebSocket (a multiplexed control/data socket that
also carries other features), you don't need a second PtyKit socket. Skip the
Bun/Node mounting above and drive the server from your own socket instead — the
wire protocol is unchanged (still WebSocket, still `{ action, payload }` frames);
only socket ownership moves to the host.

```ts
const server = createPtyKitServer(manager, {
  authorize: (ctx) => canAccess(ctx.conn.data.user, ctx.namespace),
  room: (ctx) => ctx.namespace,
});

// For each host connection, mint a PtyKit connection whose `send` tunnels a
// frame over your socket, and carry your identity on `data`.
const conn = server.createConnection({
  data: { user },                        // what `authorize` inspects
  send: (frame) => host.send(id, frame), // deliver a frame to this client
  close: () => host.close(id),
});
server.handleOpen(conn);

// Feed inbound frames. Use `handleFrame` when you already have a parsed object
// (no redundant JSON round-trip); `handleMessage` accepts a raw string/bytes.
host.onFrame(id, (frame) => server.handleFrame(conn, frame));
host.onClose(id, () => server.handleClose(conn));
```

`onUpgrade`/`resolveUpgrade` are for the HTTP-upgrade path; in embedded mode you
set identity directly on `createConnection({ data })`.

### The `authorize` hook

Called for every privileged operation with
`{ operation, namespace, sessionId?, conn }`. **Defaults to allow-all** for local
DX — production deployments MUST implement it. For session-referencing operations
the `namespace` is derived from the session itself, so a connection authorized
only for its own namespace cannot touch another's session (anti-hijack, R10).
Identity comes from `conn.data`, populated by `onUpgrade`.

### Per-session environment

`PtyKitManagerOptions.env.inject` is fixed when the manager is constructed, so
every shell in the process gets identical variables. That is the right shape for
deployment-wide policy and the wrong one for anything that varies per session —
who opened the terminal, which workspace it belongs to.

The `env` hook fills that gap. It runs just before spawn and receives
`{ namespace, sessionId, cwd, conn }`; whatever it returns is merged over the
manager's `inject`, with the per-session value winning on a name collision.

```ts
const server = createPtyKitServer(manager, {
  env: ({ conn, namespace }) => {
    const user = conn.data.user as User;
    return {
      GIT_AUTHOR_NAME: user.name,
      GIT_AUTHOR_EMAIL: user.email,
      WORKSPACE: namespace,
    };
  },
});
```

The hook may be async — the spawn waits for it.

**Why a hook and not a field on the create frame.** The client asks for a
session; it does not get to say what environment that session runs with. A
browser able to name its own variables could set `PATH` or `LD_PRELOAD`, which
turns "may open a terminal" into "may run arbitrary code as the server user".
Sending `env` in a `create-session` payload is therefore ignored. The answer
comes from the host, which already holds the connection identity in `conn.data`.

Two limits worth designing around:

- **Spawn-time only.** The environment is read once, when the PTY is created.
  Because `create-session` is idempotent (R3), attaching to a live session does
  not re-run the hook, and changing what the hook would return never reaches a
  session that is already running. Surface the active values in your UI and let
  the user open a new terminal to pick up a change.
- **Failures are non-fatal.** A hook that throws yields no extra variables and
  is reported through the logger. A failed identity lookup should not cost the
  user their terminal.

### Rooms / broadcast

Output (`output`, `exit`, input `error`) goes to the connections **attached** to
the session — via `create-session` or `reconnect` — and stops on
`detach-session`, `leave-namespace` or disconnect. This is what makes N clients ↔
1 session collaborative without every viewer of a workspace paying for every
session in it. The serialized reattach frame is unicast to the joining
connection so existing viewers are not repainted. When a session leaves the
manager by any path, its viewers are dropped, so a later session reusing the id
starts with none.

Session lifecycle is broadcast to the whole room (`room(ctx)`, default = the
namespace) as `session-created` / `session-closed` (each carries
`{ sessionId, namespace, … }`), along with `ready` and `directory`, so clients
can mirror the room's live session set. The browser client surfaces these via
[`onSessionCreated` / `onSessionClosed`](./client.md#collaborative-session-awareness).

### Reattach resizes before replay

`create-session` is idempotent (R3): attaching to an existing session reuses it.
When the request carries `cols`/`rows` that differ from the session's current
size, the server **resizes the session (PTY + scrollback) before serializing the
replay frame**, so the replayed screen always matches the attaching viewport.
Because a PTY has one size, this is last-attach-wins — a second viewer at a
different size resizes the shared PTY (raising `SIGWINCH`, so the running app
redraws cleanly for everyone). This is what keeps full-screen TUIs from restoring
garbled. Pair it with the client's fit-before-attach (`mountTerminal` does this
automatically).

### Operations & events

Operations (RPC): `create-session`, `resize`, `cancel`, `kill-session`, `clear`,
`check-shell`, `pty-status`, `list-sessions`, `stream-status`, `missed-output`,
`reconnect`, `detach-session`, `leave-namespace`; plus the `input` event. Server→client events: `ready`, `output`
(with `seq`), `directory`, `exit`, `error`, `session-created`, `session-closed`.
