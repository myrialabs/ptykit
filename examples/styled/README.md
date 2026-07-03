# Example: styled

`mountTerminal` ships legible defaults (the `dark` theme preset). To restyle you
rarely need a palette at all — `theme` takes a **preset name**:

```
dark · light · solarized-dark · solarized-light · dracula · nord · matrix
```

…and still accepts a full xterm `ITheme` object when you want something bespoke.
This page offers every built-in preset plus one custom palette (Tokyo Night), and
switches them **live**.

## Run

```bash
bun examples/styled/server.ts
# open http://localhost:8784
```

Click a theme in the toolbar. The terminal is mounted once and restyled **in
place** — no remount — so the session and its scrollback never flinch.

## Files

- `server.ts` — a Bun server that mounts `createPtyKitServer` on `/pty` and
  serves the page. The browser bundle is built on the fly with `Bun.build`.
- `app.ts` — builds a button per preset name (from the exported `themes`) plus a
  custom-`ITheme` button, and applies each via `handle.setTheme(...)`.
- `index.html` — the page shell, theme toolbar, and status indicator.

## Notes

- `theme` accepts a **preset name** (see the list above), a full xterm `ITheme`
  object, or nothing (defaults to `dark`). The presets — `themes`, `darkTheme`,
  `solarizedDarkTheme`, `draculaTheme`, `nordTheme`, … and `resolveTheme` — are
  exported from `@myrialabs/ptykit/client`, so you can also import one and tweak a
  few keys: `{ ...draculaTheme, background: '#000' }`.
- Restyling is live: `handle.setTheme(...)` swaps colours on the running terminal
  — no `dispose()`/remount. The `<PtyTerminal>` Svelte component does the same
  reactively via its `theme` prop.
- In-repo, the example imports from `../../src/...`. A published app imports from
   `@myrialabs/ptykit` (server) and `@myrialabs/ptykit/client` (browser).
