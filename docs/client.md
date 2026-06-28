# Client

`ptykit/client` — the framework-agnostic browser client.

## `mountTerminal` — the ready-to-use path

Don't want to wire xterm.js by hand? `mountTerminal` is the framework-agnostic
counterpart to [`<PtyTerminal/>`](./svelte.md): hand it a container and a `url`
and it creates the xterm `Terminal`, attaches a `FitAddon`, opens the session,
and wires output⇄input — while staying fully configurable.

```ts
import { mountTerminal } from 'ptykit/client';

const handle = await mountTerminal(document.getElementById('screen')!, {
  url: '/pty',
  namespace: 'project-123',
  sessionId: 'project-123-terminal-1',
  create: true,                       // attach instead when false (the default)
  // appearance — all optional
  fontSize: 13,
  cursorStyle: 'bar',
  theme: { background: '#0f172a', foreground: '#e2e8f0' },
  // callbacks — all optional
  onStatus: (s) => render(s),         // 'connected' | 'reconnecting' | 'disconnected'
  onExit: (code) => { /* … */ },
  onError: (err) => { /* surfaced instead of a silently blank terminal */ },
});

// Escape hatch: the underlying instances are on the returned handle.
handle.terminal.focus();
handle.fitAddon?.fit();
handle.session.write('ls\r');

handle.dispose();                     // detach, dispose the terminal, disconnect
```

- `client?` — pass an existing `PtyKitClient` to share one socket across several
  terminals (e.g. a tabbed UI). When you pass one, `dispose()` leaves it
  connected; when `mountTerminal` creates its own, `dispose()` disconnects it.
- `fit: false` skips the `FitAddon` + `ResizeObserver` (then `handle.fitAddon` is
  `undefined`).
- xterm and the FitAddon are imported dynamically, so a non-browser/headless
  consumer of `ptykit/client` never pulls them in, and the call is SSR-safe.
- Resolves once the session is open; **rejects** (and calls `onError`) if
  attach/create fails — so a backend/connection failure surfaces rather than
  leaving a blank terminal.

Reach for the lower-level `PtyKitClient` below when you need full control over the
terminal lifecycle (e.g. custom addons, multiple terminals per session).

## `PtyKitClient`

One WebSocket multiplexes every session in a namespace.

```ts
import { PtyKitClient } from 'ptykit/client';

const client = new PtyKitClient({
  url: '/api/pty',
  namespace: 'project-123',          // default namespace for create/attach
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30_000, maxAttempts: 5 },
  // persistence: { load, save },     // override the default sessionStorage scoping
});

client.onStatus((s) => render(s));   // 'connected' | 'reconnecting' | 'disconnected'

// Attach to an existing session (replays serialized scrollback), or create one.
const session = await client.attach('project-123-terminal-1');
// const session = await client.create({ cols: 80, rows: 24 });

session.onData((chunk) => term.write(chunk)); // deduped by seq; replay stripped
session.onExit((code) => { /* … */ });
session.write(input);                          // raw keystroke pass-through
await session.resize(cols, rows);
await session.clear();
await session.cancel();                        // Ctrl+C
await session.kill();                          // kill the server-side session
session.detach();                              // stop locally; server session lives on
```

### Resilience (R14)

- Reconnect ON by default; exponential backoff 1s → 30s, max 5 attempts.
- **Heal-reconnect**: a stalled idempotent request forces one reconnect + retry
  before failing (recovers "open but dead" sockets).
- Idempotency-aware resend: reads (and any request never delivered) resend on
  reconnect; other mutations only if not yet sent.
- On reconnect every known session is re-attached (idempotent `create-session`)
  so the room subscription and scrollback recover.

### sessionId persistence (R13)

Defaults to `sessionStorage` scoped per namespace (in-memory fallback off the
browser). Override with `persistence: { load, save }` when the caller owns the
authoritative tab list (e.g. a server DB). `create()` without a `sessionId`
generates and persists one; `attach()` without one loads the persisted id.

### Early output buffering

The reattach replay frame is unicast during `attach()`, before your code calls
`onData`. The session buffers that output (bounded) and flushes it to the first
`onData` subscriber, so reattach never drops the replayed screen.

## `attachFit` (R15)

```ts
import { attachFit } from 'ptykit/client';

const dispose = attachFit(session, term, fitAddon, { debounceMs: 100 });
```

Observes the terminal's container, fits on resize (debounced), skips redundant
resizes, and forwards new dimensions to the server. Returns a disposer.

## Replay hygiene (R17)

Replayed frames (delivered without a `seq`) are passed through
`stripReportRequests` so the terminal does not answer color/cursor/DA queries
into an idle prompt. Live output (with a `seq`) is delivered verbatim and deduped.
