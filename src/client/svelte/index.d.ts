/**
 * Type declarations for `@myrialabs/ptykit/svelte`.
 *
 * The component ships as raw `.svelte` source (resolved via the `svelte` export
 * condition by Svelte-aware bundlers). These hand-written types describe its
 * public props.
 */

import type { Component } from 'svelte';
import type {
	ClientSession,
	PtyKitClient,
	ReconnectOptions,
	SessionPersistence,
	WebSocketFactory,
} from '../index.js';

export interface PtyTerminalReadyContext {
	client: PtyKitClient;
	session: ClientSession;
	/** The xterm `Terminal` instance (typed loosely to avoid a hard xterm dep). */
	terminal: unknown;
}

export interface PtyTerminalProps {
	// connection
	/** Session to attach to / create (created server-side if new). */
	sessionId: string;
	/** WebSocket endpoint, e.g. `/pty`. Optional when `WebSocketImpl`/`client` rides a host socket. */
	url?: string;
	/** Room/namespace. Required when `create` is true. */
	namespace?: string;
	/** Create instead of attach. Default `false`. */
	create?: boolean;
	/** Reuse an existing client instead of creating one. */
	client?: PtyKitClient;
	/** Reconnect tuning for the internally-created client. */
	reconnect?: ReconnectOptions;
	/** sessionId persistence override. */
	persistence?: SessionPersistence;
	/** RPC timeout (ms). */
	requestTimeoutMs?: number;
	/** Injectable WebSocket constructor — pass `hostSocket(...)` to tunnel over an app socket. */
	WebSocketImpl?: WebSocketFactory;

	// session (used when creating)
	cols?: number;
	rows?: number;
	cwd?: string;
	shell?: string;

	// terminal appearance
	scrollback?: number;
	fontSize?: number;
	fontFamily?: string;
	lineHeight?: number;
	cursorBlink?: boolean;
	cursorStyle?: 'block' | 'underline' | 'bar';
	/** An xterm `ITheme` object. */
	theme?: Record<string, unknown>;
	/** Extra/override xterm `Terminal` options. */
	terminalOptions?: Record<string, unknown>;
	/** Extra xterm addons loaded after FitAddon (pass instances). */
	addons?: unknown[];
	/** Built-in optional addons, loaded lazily when enabled (optional peer deps). */
	clipboard?: boolean;
	webLinks?: boolean;
	unicode11?: boolean;
	ligatures?: boolean;

	// behavior
	/** Attach a FitAddon + ResizeObserver. Default `true`. */
	fit?: boolean;
	fitDebounceMs?: number;
	/** Called with the raw `terminal` after addons load, before attach (activate addons / key handlers). */
	onTerminalReady?: (terminal: unknown) => void;
	/** Show the built-in connection-status chip. Default `true`. */
	showStatus?: boolean;

	// styling
	/** Extra class on the root element. */
	class?: string;

	// lifecycle callbacks
	onready?: (ctx: PtyTerminalReadyContext) => void;
	ondata?: (chunk: string) => void;
	onexit?: (exitCode: number) => void;
	onstatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
	onerror?: (error: unknown) => void;
	ondirectory?: (directory: string) => void;
}

/** `<PtyTerminal sessionId url … />` — the official Svelte terminal component. */
declare const PtyTerminal: Component<PtyTerminalProps>;
export { PtyTerminal };
export default PtyTerminal;
