# Example: basic

A single terminal in ~10 lines, using the ready-to-use `mountTerminal` helper
from `@myrialabs/ptykit/client` — no framework, no manual xterm wiring. The quickest way to
see a real collaborative terminal end-to-end.

## Run

```bash
bun examples/basic/server.ts
# open http://localhost:8781
```

Open the page in two tabs — both attach to the same session (`demo-terminal-1`)
and see the same live output (the collaborative room model). The connection
status indicator reflects `connected | reconnecting | disconnected`.

## Files

- `server.ts` — a Bun server that mounts `createPtyKitServer` on `/pty` and
  serves the page. The browser bundle is built on the fly with `Bun.build`.
- `app.ts` — the browser side: a single `mountTerminal(screen, { url, … })` call.
- `index.html` — the page shell + status indicator.

## Notes

- In-repo, the example imports from `../../src/...`. A published app imports from
   `@myrialabs/ptykit` (server) and `@myrialabs/ptykit/client` (browser).
- `authorize` is left at its allow-all default here — fine for localhost, **never
  for production**. See the security note in the root README.
- Want to customize the look (theme, font, cursor)? See the
  [`styled/`](../styled) example.
