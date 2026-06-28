/**
 * ptykit — production-grade PTY sessions over WebSocket for Node & Bun.
 *
 * This is the main entry (`ptykit`): the core session engine plus the
 * WebSocket transport server. The browser client lives at `ptykit/client`
 * and the Svelte adapter at `ptykit/svelte`.
 */

export * from './shared/index.js';
export * from './core/index.js';
export * from './server/index.js';
