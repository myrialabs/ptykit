/**
 * `@myrialabs/ptykit/xterm` — re-exports the xterm.js pieces PtyKit bundles.
 *
 * Consumers that need a raw terminal (e.g. a themed log view) can import these
 * from PtyKit instead of depending on `@xterm/*` directly — PtyKit owns the
 * xterm dependency set. Pair with `@myrialabs/ptykit/xterm.css` for the styles.
 */

export { Terminal } from '@xterm/xterm';
export { FitAddon } from '@xterm/addon-fit';
export { ClipboardAddon } from '@xterm/addon-clipboard';
export { WebLinksAddon } from '@xterm/addon-web-links';
export { Unicode11Addon } from '@xterm/addon-unicode11';
export { LigaturesAddon } from '@xterm/addon-ligatures';
