/**
 * @myrialabs/ptykit — production-grade PTY sessions over WebSocket for Node & Bun.
 *
 * This is the main entry (`@myrialabs/ptykit`): the core session engine plus the
 * WebSocket transport server. The browser client lives at `@myrialabs/ptykit/client`
 * and the Svelte adapter at `@myrialabs/ptykit/svelte`.
 */

export * from './shared/index.js';
export * from './core/index.js';
export * from './server/index.js';
