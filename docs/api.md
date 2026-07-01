# API Reference

The public surface of `@myrialabs/ptykit`, split across three entry points.

## Entry points

| Import | Exports |
|---|---|
| `@myrialabs/ptykit` | Barrel: `PtyKitManager`, `createPtyKitServer`, wire-protocol types, `PTYKIT_VERSION`. |
| `@myrialabs/ptykit/core` | `PtyKitManager` and the core seams (backend, scrollback, env/shell). |
| `@myrialabs/ptykit/server` | `PtyKitServer`, `createPtyKitServer`, `RoomRegistry`, transport hook types. |
| `@myrialabs/ptykit/client` | `mountTerminal`, `PtyKitClient`, `ClientSession`, `attachFit`, `defaultPersistence`, `WsCore`. |
| `@myrialabs/ptykit/svelte` | `PtyTerminal` (default + named). |

## `@myrialabs/ptykit` (core + server)

- `PtyKitManager` — session manager. See [server.md](./server.md#ptykitmanager).
- `createPtyKitServer(manager, options)` — WebSocket server. See
  [server.md](./server.md#createptykitserver).
- Backend: `loadBackend`, `detectBackendName`, `PtyBackend`, `PtyProcessHandle`.
- Scrollback seam: `BufferStore`, `MemoryBufferStore`.
- Env/shell: `buildPtyEnv`, `getCleanSpawnEnv`, `resolveShell`, `checkShell`.
- Wire types: `RpcMap`, `ServerEventMap`, `OutputEvent`, `Seq`, `stripReportRequests`, …

## `@myrialabs/ptykit/client`

- `mountTerminal(target, options)` — ready-to-use xterm terminal wired to a
  session; returns a `{ client, session, terminal, fitAddon, dispose }` handle.
  See [client.md](./client.md#mountterminal--the-ready-to-use-path).
- `PtyKitClient` / `ClientSession` — see [client.md](./client.md).
- `attachFit(session, term, fitAddon, { debounceMs })` — see [client.md](./client.md#attachfit).
- `defaultPersistence()` / `SessionPersistence` — sessionId persistence.
- `hostSocket(handle)` / `HostSocketHandle` — adapt an app-owned WebSocket into the
  `WebSocketImpl` seam so the client rides it instead of opening its own. See
  [client.md](./client.md#embedded-ride-a-socket-you-already-own).
- `WsCore` — the low-level resilient socket (advanced use).

## `@myrialabs/ptykit/svelte`

- `PtyTerminal` — `<PtyTerminal sessionId url namespace? create? />`. See
  [svelte.md](./svelte.md).

## Behavior coverage

The collaborative room model, `authorize` enforcement + anti-hijack, serialized
reattach (zero data loss, no double output), reconnect/heal, and `seq` dedup all
have dedicated tests under `src/`.
