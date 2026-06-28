/**
 * Type declarations for `ptykit/svelte`.
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
	/** WebSocket endpoint, e.g. `/pty`. */
	url: string;
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

	// behavior
	/** Attach a FitAddon + ResizeObserver. Default `true`. */
	fit?: boolean;
	fitDebounceMs?: number;
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
