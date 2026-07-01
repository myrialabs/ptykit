# API Reference

The public surface of `@myrialabs/ptykit`, split across three entry points.

## Entry points

| Import | Exports |
|---|---|
| `@myrialabs/ptykit` | `PtyKit`, `createPtyKitServer`, wire-protocol types, `PTYKIT_VERSION`. |
| `@myrialabs/ptykit/client` | `mountTerminal`, `PtyKitClient`, `ClientSession`, `attachFit`, `defaultPersistence`, `WsCore`. |
| `@myrialabs/ptykit/svelte` | `PtyTerminal` (default + named). |

## `@myrialabs/ptykit` (core + server)

- `PtyKit` — session manager. See [server.md](./server.md#ptykit).
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
- `WsCore` — the low-level resilient socket (advanced use).

## `@myrialabs/ptykit/svelte`

- `PtyTerminal` — `<PtyTerminal sessionId url namespace? create? />`. See
  [svelte.md](./svelte.md).

## Behavior coverage

The collaborative room model, `authorize` enforcement + anti-hijack, serialized
reattach (zero data loss, no double output), reconnect/heal, and `seq` dedup all
have dedicated tests under `src/`.
