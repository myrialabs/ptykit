# Production

Security hardening, backend status, and measured performance — read this
before a network-reachable deployment.

## Security

The `authorize` hook **defaults to allow-all** so the package is friendly to
try locally — this is unsafe in production. A network-reachable deployment
must provide an `authorize` implementation that checks the connection's
identity (populated by `onUpgrade`) against the requested `namespace`:

```ts
const server = createPtyKitServer(manager, {
  onUpgrade: (request) => {
    const user = authenticate(request); // your own logic
    return user ? { user } : false;      // false rejects the upgrade
  },
  authorize: (ctx) => ctx.conn.data.user?.canAccess(ctx.namespace) ?? false,
});
```

`authorize` is called for every privileged operation
(`{ operation, namespace, sessionId?, conn }`). ptykit also rejects
cross-namespace `sessionId` access on its own (anti-hijack, derived from the
session's own namespace) — but it cannot know who your users are, so a
missing or overly permissive `authorize` is the one gap this library cannot
close for you. See [Core concepts](../essential/core-concepts.md#authorize-and-anti-hijack)
for how the hook fits into the room/reattach model.

For an embedded transport (riding a socket your app already owns), set
identity directly on `createConnection({ data })` instead of via
`onUpgrade` — see [Server: embedded transport](../sdk/server.md#embedded-transport-bring-your-own-socket).

Session environment follows the same rule as `authorize`: it comes from the
server's [`env` hook](../sdk/server.md#per-session-environment), never from the
create frame. A client that could name its own variables could set `PATH` or
`LD_PRELOAD`, turning "may open a terminal" into "may run arbitrary code as the
server user". If your hook returns secrets, remember they land in the child
process environment, where anything the user runs in that shell can read them.

## Backends

`bun-pty` is the default, **tested** backend (auto-selected under Bun).
`node-pty` is implemented and type-correct, auto-activates under Node, but
stays labeled **experimental** until scale and auto-detect benchmarks justify
promoting it — see [Core concepts](../essential/core-concepts.md#backend-auto-detect)
for how detection works. On the benchmark machine (Node 25, macOS arm64),
`node-pty` failed to spawn (`posix_spawnp`), reproduced with raw `node-pty`
too — a `node-pty`/Node-25 native issue, not a ptykit bug. Both backends are
optional dependencies, resolved lazily by dynamic `import()`, so neither
runtime is ever forced to build the other's native module.

**Deploy-scenario coverage.** The benchmark run only exercised the `direct`
process case on macOS (no Docker/pm2/systemd available on that machine):
Bun→bun-pty ✅, Node→node-pty ❌ (above). The bundled/pm2/systemd/Docker ×
{Bun, Node} matrix has **not** been run — treat `node-pty` as unverified
outside a direct Node process until that data exists.

## Performance

Measured on a dev laptop (Apple M2, Bun 1.3.14, Node 24.3.0, macOS arm64).
Reproduce with `bun bench.ts`; full tables and methodology in
[bench-results.md](../../bench-results.md).

- **Throughput overhead** of the wrapped pipeline vs raw bun-pty: **5.3%**
  (target <10%) — the cost of persisting every chunk to the headless xterm
  first plus micro-task batching, measured piping `seq 1 1000000` through an
  interactive shell.
- **Reattach serialize latency**: p50 3.1–9.5ms, p95 10.0–18.8ms across
  10KB/100KB/1MB scrollback buffer targets; the newest output is always
  present in the replayed frame.
- **Idle footprint**: ~0.14 MB of parent-process **RSS delta** per session at
  100 concurrent sessions (the headless xterm + bookkeeping — each PTY's own
  process memory is separate and not counted here). In-memory scrollback was
  fine at this scale; no disk spill was warranted.

These numbers are machine-specific — a dev laptop, not a server — reproduce
them on your own target hardware before treating them as a capacity plan.
