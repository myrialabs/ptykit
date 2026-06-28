# Example: multi-tab

A tabbed terminal manager — many PTY sessions over one shared socket. Shows
`create` / `attach` / `kill`, the session registry (`listSessions`), and
refresh-safe restore.

## Run

```bash
bun examples/multi-tab/server.ts
# open http://localhost:8783
```

- **+** opens a new session (`workspace-terminal-N`).
- Click a tab to switch; **×** kills that session.
- Refresh the page — every still-running session is rediscovered via
  `listSessions()` and reattached, scrollback intact.

## Files

- `server.ts` — Bun server mounting `createPtyKitServer` on `/pty`.
- `app.ts` — the tab manager: one `PtyKitClient`, one `ClientSession` per tab.
- `index.html` — tab bar + terminal area.
