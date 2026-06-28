# Example: collaborative-web

Two terminal panes on one page, both attached to the **same** session — a visual
demo of the collaborative room model (N clients ↔ 1 session). Type in either
pane and both update live, because output broadcasts to the room and each pane
filters by `sessionId`.

## Run

```bash
bun examples/collaborative-web/server.ts
# open http://localhost:8782
```

Type in the left pane; watch the right pane echo the same shell. Each pane is its
own `PtyKitClient` with its own connection-status indicator.

## Files

- `server.ts` — Bun server mounting `createPtyKitServer` on `/pty`, bundling the
  page on the fly.
- `app.ts` — two `mountTerminal` panes, each attached to the same `sessionId`.
- `index.html` — split layout + per-pane status.
