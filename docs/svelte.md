# Svelte adapter

`@myrialabs/ptykit/svelte` wraps `@myrialabs/ptykit/client` + xterm.js + FitAddon into one configurable,
SSR-safe component.

```svelte
<script>
  import { PtyTerminal } from '@myrialabs/ptykit/svelte';
</script>

<PtyTerminal sessionId="project-42-terminal-1" url="/pty" namespace="project-42" />
```

A richer example:

```svelte
<script>
  import { PtyTerminal } from '@myrialabs/ptykit/svelte';
  let client;
</script>

<PtyTerminal
  sessionId="project-42-terminal-1"
  url="/pty"
  namespace="project-42"
  create
  fontSize={14}
  cursorStyle="bar"
  theme={{ background: '#0f172a', foreground: '#e2e8f0', cursor: '#22c55e' }}
  reconnect={{ maxAttempts: 0 }}
  onready={({ client: c }) => (client = c)}
  onexit={(code) => console.log('shell exited', code)}
  onstatus={(s) => console.log('status', s)}
/>
```

## Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `sessionId` | `string` | — | Session to attach to / create. |
| `url` | `string` | — | WebSocket endpoint. |
| `namespace` | `string?` | — | Room/namespace; required with `create`. |
| `create` | `boolean` | `false` | Create instead of attach. |
| `client` | `PtyKitClient?` | — | Reuse an existing client instead of creating one. |
| `reconnect` | `ReconnectOptions?` | — | Reconnect tuning for the internal client. |
| `persistence` | `SessionPersistence?` | — | sessionId persistence override. |
| `requestTimeoutMs` | `number?` | — | RPC timeout. |
| `cols` / `rows` / `cwd` / `shell` | — | — | Session params used when creating. |
| `scrollback` | `number` | `5000` | Terminal scrollback lines. |
| `fontSize` | `number` | `13` | Reactive — reassign to resize without a remount. |
| `fontFamily` / `lineHeight` | — | — | Terminal typography. |
| `cursorBlink` | `boolean` | `true` | |
| `cursorStyle` | `'block' \| 'underline' \| 'bar'` | `'block'` | |
| `theme` | `ThemeName \| ITheme` | `'dark'` | Preset name (`dark`, `light`, `solarized-dark`, `solarized-light`, `dracula`, `nord`, `matrix`) or a theme object. **Reactive** — reassign to re-theme the live terminal with no remount. |
| `terminalOptions` | `object?` | `{}` | Extra/override xterm options. |
| `clipboard` / `webLinks` / `unicode11` / `ligatures` | `boolean` | `true` | Built-in addons (optional peer deps; pass `false` to opt out). |
| `contextMenu` | `boolean` | `true` | Right-click copy/paste; pass `false` to handle it yourself. |
| `addons` | `unknown[]?` | — | Extra addon instances loaded after the built-ins. |
| `fit` | `boolean` | `true` | Attach FitAddon + ResizeObserver (also fits before attach). |
| `fitDebounceMs` | `number` | `100` | |
| `loading` | `boolean` | `true` | Show a built-in spinner overlay while loading. |
| `loadingText` | `string` | `'Connecting…'` | Label under the spinner (`''` = spinner only). |
| `showStatus` | `boolean` | `true` | Built-in status chip. |
| `class` | `string?` | — | Extra class on the root element. |

## Events (callback props)

| Prop | Fires with |
|---|---|
| `onready` | `{ client, session, terminal }` once attached. |
| `ondata` | each output chunk written to the terminal. |
| `onexit` | the exit code when the shell exits. |
| `onstatus` | `'connected' \| 'reconnecting' \| 'disconnected'`. |
| `onerror` | a connection or server error. |
| `ondirectory` | the new working directory. |

## Peer dependencies

Requires `svelte`, `@xterm/xterm`, and `@xterm/addon-fit` in the consuming app
(declared as optional peer dependencies of `@myrialabs/ptykit`). React/Vue adapters are
community extension points; the contract is the same `@myrialabs/ptykit/client` surface in
[client.md](./client.md).
