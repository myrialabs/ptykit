# Example: svelte

A minimal Vite + Svelte app using the official `<PtyTerminal/>` component. The
PtyKit WebSocket server is mounted directly onto Vite's dev server (see
`vite.config.ts`), so one command serves both the app and `/pty`.

## Run

From a clone, build the library once so `file:../..` resolves the `dist/`:

```bash
bun run build            # at the repo root

cd examples/svelte
bun install
bun run dev              # run under Bun so the bun-pty backend is used
# open http://localhost:8785
```

## Files

- `vite.config.ts` — the Svelte plugin + a tiny plugin that attaches
  `createPtyKitServer` to Vite's HTTP server.
- `src/App.svelte` — renders `<PtyTerminal/>` with a custom theme, cursor, and a
  status callback.
- `src/main.ts` / `index.html` — Svelte 5 mount + page shell.

## Notes

- `ptykit/svelte` ships the component as raw `.svelte` source (resolved via the
  `svelte` export condition), which `@sveltejs/vite-plugin-svelte` compiles in
  your app — no prebuilt component to fight with.
- The `dev`/`preview` scripts run Vite as `bun --bun vite`. This matters: a plain
  `bun run vite` still launches Vite's `node` shebang, so the PtyKit server
  attached in `vite.config.ts` would run under Node and auto-detect the
  experimental (and unbuilt) `node-pty` backend — the terminal connects but stays
  blank. `bun --bun` forces the Vite process onto the Bun runtime so the tested
  `bun-pty` backend is used.
- `App.svelte` wires an `onerror` handler so a backend/connection failure shows in
  the status chip instead of leaving a silently empty terminal.
