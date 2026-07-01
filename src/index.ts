/**
 * @myrialabs/ptykit — production-grade PTY sessions over WebSocket for Node & Bun.
 *
 * This is the main entry (`@myrialabs/ptykit`): a convenience barrel re-exporting
 * the core session engine (`PtyKitManager`) plus the WebSocket transport server
 * (`PtyKitServer`). For narrower imports the same symbols are available at
 * `@myrialabs/ptykit/core` and `@myrialabs/ptykit/server`. The browser client
 * lives at `@myrialabs/ptykit/client` and the Svelte adapter at
 * `@myrialabs/ptykit/svelte`.
 */

export * from './shared/index.js';
export * from './core/index.js';
export * from './server/index.js';
