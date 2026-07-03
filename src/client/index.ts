/**
 * `@myrialabs/ptykit/client` — framework-agnostic browser client.
 */

export {
	PtyKitClient,
	ClientSession,
	type PtyKitClientOptions,
	type OpenOptions,
} from './pty-kit-client.js';
export { attachFit, type AttachFitOptions } from './fit.js';
export {
	mountTerminal,
	type MountTerminalOptions,
	type TerminalHandle,
} from './terminal.js';
export {
	mountViewer,
	type MountViewerOptions,
	type TerminalViewerHandle,
} from './viewer.js';
export {
	themes,
	darkTheme,
	lightTheme,
	solarizedDarkTheme,
	solarizedLightTheme,
	draculaTheme,
	nordTheme,
	matrixTheme,
	resolveTheme,
	type ThemeName,
	type TerminalTheme,
} from './themes.js';
export { showLoadingOverlay } from './loading.js';
export { defaultPersistence, type SessionPersistence } from './persistence.js';
export { hostSocket, type HostSocketHandle } from './host-socket.js';
export {
	WsCore,
	type WsCoreOptions,
	type WSStatus,
	type ReconnectOptions,
	type WebSocketFactory,
	type WebSocketLike,
} from './ws-core.js';

// Re-export the wire-protocol types consumers need.
export type {
	Seq,
	OutputEvent,
	ReadyEvent,
	ExitEvent,
	CreateSessionResponse,
	SessionCreatedEvent,
	SessionClosedEvent,
} from '../shared/index.js';
