# Example: styled

`mountTerminal` is ready-to-use, but every bit of the look is configurable —
`theme`, `fontSize`, `fontFamily`, `lineHeight`, `cursorStyle`, `cursorBlink`,
and any extra xterm `Terminal` option via `terminalOptions`. This page defines a
few presets — dark (Midnight, Solarized, Matrix) and light (Paper, Light) — and
lets you switch live.

## Run

```bash
bun examples/styled/server.ts
# open http://localhost:8784
```

Click a preset in the toolbar to restyle the terminal. All presets share one
client and one session, so switching re-mounts and the serialized scrollback
replays — your shell history survives the restyle.

## Files

- `server.ts` — a Bun server that mounts `createPtyKitServer` on `/pty` and
  serves the page. The browser bundle is built on the fly with `Bun.build`.
- `app.ts` — the presets (each is a bundle of `mountTerminal` style options) plus
  the switch logic: `dispose()` the old handle, `mountTerminal()` with the new one.
- `index.html` — the page shell, preset toolbar, and status indicator.

## Notes

- The first mount uses `create: true`; switching re-mounts with `create: false`
  (attach) against the same `sessionId`, so the session — and its scrollback —
  persists across restyles.
- Styling options map directly to xterm: `theme` is an xterm `ITheme`,
  `terminalOptions` is spread last so you can override anything.
- In-repo, the example imports from `../../src/...`. A published app imports from
   `@myrialabs/ptykit` (server) and `@myrialabs/ptykit/client` (browser).
