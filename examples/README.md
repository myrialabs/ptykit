# PtyKit examples

Each `.ts` file is a self-contained, runnable scenario. Run any with Bun:

```sh
bun run examples/<file>.ts
```

They spin up a real PTY (bun-pty) and a real WebSocket server in-process, so you
see the actual behavior end-to-end.

## Files

| Example | What it shows |
| --- | --- |
| [`quick-start.ts`](./quick-start.ts) | Minimal server + client: create a session, run a command |
| [`collaborative.ts`](./collaborative.ts) | Two clients ↔ one session, both see the same live output |
| [`reattach.ts`](./reattach.ts) | Disconnect → reattach replays scrollback, input keeps working |
| [`reconnect.ts`](./reconnect.ts) | Auto-reconnect with backoff + `onStatus` across a server blip |
| [`authorize.ts`](./authorize.ts) | The `authorize` hook + `onUpgrade` identity + anti-hijack |
| [`node-server.ts`](./node-server.ts) | Mounting on a Node `http.Server` via the `ws` package |
| [`headless-capture.ts`](./headless-capture.ts) | The core engine without a server: drive a session, read serialized scrollback |
| [`custom-shell-env.ts`](./custom-shell-env.ts) | Custom shell, cwd, and environment hygiene |

## Browser examples

Each folder is a small web app. The plain ones bundle on the fly with `Bun.build`
(no install step) — run the server and open the printed URL:

| Example | Run | What it shows |
| --- | --- | --- |
| [`basic/`](./basic) | `bun examples/basic/server.ts` → :8781 | A single terminal via the ready-to-use `mountTerminal` helper |
| [`collaborative-web/`](./collaborative-web) | `bun examples/collaborative-web/server.ts` → :8782 | Two `mountTerminal` panes, one session — type in either, both update |
| [`multi-tab/`](./multi-tab) | `bun examples/multi-tab/server.ts` → :8783 | Tabbed multi-session manager (`mountTerminal` + one shared client) |
| [`styled/`](./styled) | `bun examples/styled/server.ts` → :8784 | Theming a terminal: live presets (dark + light) via `mountTerminal` |
| [`svelte/`](./svelte) | `bun install && bun run dev` → :5180 | The `<PtyTerminal/>` Svelte component in a Vite app |

## Notes

- The examples import from `../src/...`, so they run straight from a clone. In
  your own project, import from `'ptykit'` and `'ptykit/client'` instead.
- The `.ts` examples need **Bun** (they use `bun-pty` and `Bun.serve`).
  `node-server.ts` also runs under Node if you have a working `node-pty` build.
- The `basic/`, `styled/`, `collaborative-web/`, and `multi-tab/` browser examples
  bundle their page on the fly with `Bun.build` — no install step. Just run the
  server and open the printed URL.
- The `svelte/` example is a Vite app: build the library once at the repo root
  (`bun run build`), then `cd examples/svelte && bun install && bun run dev`.
