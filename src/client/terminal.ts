/**
 * `mountTerminal` — a ready-to-use xterm.js terminal wired to a PtyKit session.
 *
 * The framework-agnostic counterpart to `<PtyTerminal/>`: hand it a container
 * element and a `url` and you get back a live, fitted terminal — no manual
 * `new Terminal()`, `loadAddon`, `open`, or `onData` plumbing. It stays fully
 * configurable (appearance, theme, an existing client, callbacks) and returns a
 * handle with the underlying `terminal`/`fitAddon`/`session` for advanced use.
 *
 * xterm and the FitAddon are imported dynamically (they are optional peer deps),
 * so non-browser/headless consumers of `@myrialabs/ptykit/client` never pull them in, and
 * the call is SSR-safe — it only touches the DOM when actually invoked.
 */

import { PtyKitClient, type ClientSession } from './pty-kit-client.js';
import { attachFit } from './fit.js';
import type { ReconnectOptions, WSStatus } from './ws-core.js';
import type { SessionPersistence } from './persistence.js';

export interface MountTerminalOptions {
	// --- connection ---
	/** WebSocket endpoint, e.g. `/pty` or `wss://host/pty`. */
	url: string;
	/** Session to attach to / create. Omit when creating to auto-generate one. */
	sessionId?: string;
	/** Room/namespace. Required (here or on a passed-in `client`). */
	namespace?: string;
	/** Create a new session instead of attaching. Default `false`. */
	create?: boolean;
	/** Reuse an existing client (e.g. to share one socket across terminals). */
	client?: PtyKitClient;
	/** Reconnect tuning for the internally-created client. */
	reconnect?: ReconnectOptions;
	/** sessionId persistence override. */
	persistence?: SessionPersistence;
	/** RPC timeout (ms). */
	requestTimeoutMs?: number;

	// --- session (used when creating) ---
	cols?: number;
	rows?: number;
	cwd?: string;
	shell?: string;

	// --- terminal appearance ---
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

	// --- behavior ---
	/** Attach a FitAddon + ResizeObserver. Default `true`. */
	fit?: boolean;
	fitDebounceMs?: number;

	// --- callbacks ---
	onData?: (chunk: string) => void;
	onExit?: (exitCode: number) => void;
	onError?: (error: unknown) => void;
	onStatus?: (status: WSStatus) => void;
	onDirectory?: (directory: string) => void;
}

export interface TerminalHandle {
	/** The (possibly shared) client driving the socket. */
	client: PtyKitClient;
	/** The attached/created session. */
	session: ClientSession;
	/** The xterm `Terminal` instance (typed loosely to avoid a hard xterm dep). */
	terminal: any;
	/** The xterm `FitAddon` instance (`undefined` when `fit: false`). */
	fitAddon: any;
	/** Tear everything down: detach listeners, dispose the terminal, and — if the
	 *  client was created internally — disconnect it. Idempotent. */
	dispose(): void;
}

/**
 * Mount an xterm terminal into `target`, attach/create a PtyKit session, and
 * wire output⇄input + fit. Resolves once the session is open; rejects (and
 * calls `onError`) if attach/create fails — so a backend/connection failure
 * surfaces instead of leaving a silently blank terminal.
 */
export async function mountTerminal(
	target: HTMLElement,
	options: MountTerminalOptions,
): Promise<TerminalHandle> {
	// Optional peer deps, loaded lazily so the core client stays xterm-free.
	const [{ Terminal }, { FitAddon }] = (await Promise.all([
		import('@xterm/xterm'),
		import('@xterm/addon-fit'),
	])) as [any, any];

	const terminal = new Terminal({
		scrollback: options.scrollback ?? 5000,
		fontSize: options.fontSize ?? 13,
		fontFamily: options.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace',
		lineHeight: options.lineHeight ?? 1.0,
		cursorBlink: options.cursorBlink ?? true,
		cursorStyle: options.cursorStyle ?? 'block',
		allowProposedApi: true,
		...(options.theme ? { theme: options.theme } : {}),
		...(options.terminalOptions ?? {}),
	});
	const fitAddon = options.fit === false ? undefined : new FitAddon();
	if (fitAddon) terminal.loadAddon(fitAddon);
	terminal.open(target);

	const ownClient = !options.client;
	const client =
		options.client ??
		new PtyKitClient({
			url: options.url,
			namespace: options.namespace,
			reconnect: options.reconnect,
			persistence: options.persistence,
			requestTimeoutMs: options.requestTimeoutMs,
		});

	const unsubs: Array<() => void> = [];
	if (options.onStatus) unsubs.push(client.onStatus(options.onStatus));

	const open = {
		sessionId: options.sessionId,
		namespace: options.namespace,
		cols: options.cols ?? terminal.cols,
		rows: options.rows ?? terminal.rows,
		cwd: options.cwd,
		shell: options.shell,
	};

	let session: ClientSession;
	try {
		session = options.create
			? await client.create(open)
			: await client.attach(options.sessionId, open);
	} catch (err) {
		for (const u of unsubs) u();
		terminal.dispose();
		if (ownClient) client.disconnect();
		options.onError?.(err);
		throw err;
	}

	unsubs.push(
		session.onData((chunk) => {
			terminal.write(chunk);
			options.onData?.(chunk);
		}),
	);
	if (options.onExit) unsubs.push(session.onExit(options.onExit));
	if (options.onError) unsubs.push(session.onError(options.onError));
	if (options.onDirectory) unsubs.push(session.onDirectory(options.onDirectory));

	terminal.onData((data: string) => session.write(data));
	const detachFit = fitAddon
		? attachFit(session, terminal, fitAddon, { debounceMs: options.fitDebounceMs ?? 100 })
		: undefined;

	let disposed = false;
	return {
		client,
		session,
		terminal,
		fitAddon,
		dispose() {
			if (disposed) return;
			disposed = true;
			detachFit?.();
			for (const u of unsubs) u();
			session.detach();
			terminal.dispose();
			if (ownClient) client.disconnect();
		},
	};
}
