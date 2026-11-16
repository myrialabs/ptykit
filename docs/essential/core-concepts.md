# Core concepts

The vocabulary behind ptykit's design. Read this before the [Server](../sdk/server.md)
and [Client](../sdk/client.md) references — those cover the API surface; this
page covers *why* it's shaped the way it is.

## WebSocket only

ptykit multiplexes control (create/resize/kill/…) and data (keystrokes, output)
over a **single WebSocket** — no SSE, no `transport` option, no polling. One
audited path, one reconnect story.

## Sessions

A `Session` wraps one real PTY process plus its output pipeline and scrollback
binding. `PtyKitManager` owns a `Map<sessionId, Session>` and is
transport-agnostic — `createPtyKitServer` wraps it with the WebSocket layer.

Every incoming chunk is **persisted to a headless `@xterm/headless` terminal
first**, even with zero listeners attached, then micro-task batched and
fanned out to listeners with a monotonic `seq`. Persist-first means scrollback
stays accurate while every client is disconnected — there's no window where
output is lost because nobody was watching.

`create-session` is **idempotent**: attaching to an existing session id reuses
it rather than spawning a second PTY, and a request for an id held by a
different namespace is rejected (anti-hijack). Exited sessions are retained
for `retainExitedMs` (default 5 minutes) so a reconnect can still replay
their final scrollback before the session is actually removed.

A session's environment is decided once, at spawn. The manager's `env` covers
the whole deployment; the server's [`env` hook](../sdk/server.md#per-session-environment)
adds what differs per session, resolved from the connection's identity. Because
create is idempotent, attaching to a live session never re-runs that hook — a
changed value reaches the next terminal the user opens, not the one already
running.

## Collaborative rooms

Output for a session broadcasts to a **room** (default = the namespace), and
every connection in that room receives it; the client filters by `sessionId`.
That's what makes it collaborative: **N clients ↔ 1 session**. Multiple
viewers watch the exact same live terminal, and room-level
`session-created`/`session-closed` events (surfaced client-side as
`onSessionCreated`/`onSessionClosed`) let a UI mirror the room's live session
set — a teammate's new terminal shows up without a page refresh.

```ts
const server = createPtyKitServer(manager, {
  room: (ctx) => ctx.namespace, // or group however you like
});
```

The serialized reattach frame (below) is **unicast** to the joining
connection only — existing viewers are never repainted when someone else
reattaches.

## Serialized-scrollback reattach

Scrollback isn't raw byte history — it's a **headless `@xterm/headless`
instance** (via `@xterm/addon-serialize`) that mirrors every session. On
attach, the server serializes that headless terminal into a single frame and
replays it. This is what "zero data loss" actually means: a refresh, a
dropped connection, or a second viewer all see the exact current screen, not
a byte-for-byte transcript that a real terminal emulator would have to
re-interpret line by line.

**Resize before replay.** When an attach request carries `cols`/`rows`
different from the session's current size, the server resizes the PTY *and*
the headless scrollback **before** serializing the replay frame — so the
replayed screen always matches the attaching viewport. Because a PTY has one
size, this is last-attach-wins: a second viewer at a different size resizes
the shared PTY (raising `SIGWINCH`, so the running app redraws for everyone).
This is the specific mechanism that keeps full-screen TUIs (vim, htop, coding
agents) from restoring garbled — the client's `mountTerminal` fits to its
container *before* attaching so the very first request already carries the
right size.

**Replay hygiene.** A serialized frame is delivered without a `seq` (it's a
snapshot, not a live diff). The client strips ANSI report-request sequences
(`stripReportRequests`) from replay frames specifically, so xterm doesn't
answer a color/cursor/device-attribute query into what is now an idle
prompt — those queries were meant for the terminal state at capture time, not
the one the client is replaying into. Live output (carrying a `seq`) is
delivered verbatim and deduped by sequence number.

See [Performance](../operations/production.md#performance) for measured
reattach latency and idle-memory numbers.

## `authorize` and anti-hijack

Every privileged operation (`create`/`attach`/`write`/`resize`/`kill`) is
routed through an `authorize` hook: `{ operation, namespace, sessionId?, conn }
=> boolean`. It **defaults to allow-all** so the package is friendly to try
locally. For session-referencing operations, `namespace` is derived from the
session itself — so a connection authorized only for its own namespace cannot
touch another namespace's session even if it somehow learns the `sessionId`
(anti-hijack). Identity comes from `conn.data`, populated by the `onUpgrade`
hook at connection time. ptykit ships no auth of its own — see
[Production](../operations/production.md#security) before deploying.

## Backend auto-detect

The PTY backend is an **optional** dependency resolved at runtime via dynamic
`import()`: `bun-pty` under Bun (`isBun()` checks `globalThis.Bun` /
`process.versions.bun`), `node-pty` under Node. Lazy resolution means a Node
consumer never builds `bun-pty`'s rust/ffi, and a Bun consumer never builds
`node-pty` — whichever one you don't need is simply never imported. `bun-pty`
is the tested, default path; `node-pty` is implemented and type-correct but
stays labeled **experimental** until scale/auto-detect benchmarks justify
promoting it — see [Backends](../operations/production.md#backends).

## The resilient client

`PtyKitClient` reconnects with exponential backoff by default (1s → 30s, up to
5 attempts), **heal-reconnects** a stalled idempotent request (forces one
reconnect + retry before failing, recovering an "open but dead" socket), and
resends undelivered/idempotent requests on reconnect. On every reconnect,
every session the client knows about is re-attached (idempotent
`create-session`), which is what recovers both the room subscription and the
scrollback.
