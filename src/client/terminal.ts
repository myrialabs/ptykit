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
import { attachFit, fitTerminal } from './fit.js';
import { showLoadingOverlay } from './loading.js';
import { resolveTheme, type ThemeName, type TerminalTheme } from './themes.js';
import type { ReconnectOptions, WSStatus, WebSocketFactory } from './ws-core.js';
import type { SessionPersistence } from './persistence.js';

export interface MountTerminalOptions {
	// --- connection ---
	/**
	 * WebSocket endpoint, e.g. `/pty` or `wss://host/pty`. Optional (and ignored)
	 * when `WebSocketImpl` rides a host socket (e.g. `hostSocket(...)`), or when a
	 * pre-built `client` is supplied.
	 */
	url?: string;
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
	/**
	 * Injectable WebSocket constructor for the internally-created client. Pass
	 * `hostSocket(...)` to tunnel over a socket your app already owns.
	 */
	WebSocketImpl?: WebSocketFactory;

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
	/**
	 * A built-in preset name (`'dark'` | `'light'`) or a full xterm `ITheme` object.
	 * Defaults to the `dark` preset, so a terminal is legible without any config.
	 */
	theme?: ThemeName | TerminalTheme;
	/**
	 * Inner spacing between the terminal edge and the text grid. A number is taken
	 * as pixels (`8` → `8px`); a string is any CSS `padding` value (`'8px 12px'`).
	 * Applied to the `.xterm` element so the FitAddon accounts for it, and painted
	 * with the theme background so it reads as intentional spacing — never a gap.
	 * Default: none.
	 */
	padding?: number | string;
	/** Extra/override xterm `Terminal` options. */
	terminalOptions?: Record<string, unknown>;
	/**
	 * Extra xterm addons loaded after the FitAddon. Construct them yourself and
	 * pass the instances; use `onReady` for any post-load activation.
	 */
	addons?: unknown[];
	/**
	 * Built-in optional addons, loaded lazily (each is an optional peer dep — a
	 * missing package is skipped silently). **On by default** so an interactive
	 * terminal is batteries-included; pass `false` to opt out. Saves consumers the
	 * import + `loadAddon` boilerplate.
	 */
	clipboard?: boolean;   // `@xterm/addon-clipboard` (default true)
	webLinks?: boolean;    // `@xterm/addon-web-links` (default true)
	unicode11?: boolean;   // `@xterm/addon-unicode11` (default true; sets activeVersion = '11')
	ligatures?: boolean;   // `@xterm/addon-ligatures` (default true; loaded after open)

	// --- behavior ---
	/** Attach a FitAddon + ResizeObserver. Default `true`. */
	fit?: boolean;
	fitDebounceMs?: number;
	/**
	 * Wire a right-click context menu that copies the current selection (or pastes
	 * the clipboard into the PTY when there is no selection). Default `true` — the
	 * copy/paste UX every terminal wants, without hand-rolling a `contextmenu`
	 * listener. Pass `false` to handle it yourself.
	 */
	contextMenu?: boolean;
	/**
	 * Show a built-in spinner overlay in `target` while xterm loads and the session
	 * attaches, so the container is never blank. Default `true`; pass `false` to
	 * render your own. Removed on ready (and on error).
	 */
	loading?: boolean;
	/** Label under the loading spinner. Default `'Connecting…'`; `''` for spinner only. */
	loadingText?: string;
	/**
	 * Called after the terminal is opened and all addons are loaded, but before the
	 * session attaches — the place to activate addon features or install custom key
	 * handlers on the raw `terminal`.
	 */
	onReady?: (terminal: any) => void;

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
	/** Swap the theme at runtime (preset name or `ITheme`) — e.g. dark/light toggle. */
	setTheme(theme: ThemeName | TerminalTheme): void;
	/** Adjust the inner padding at runtime (pixels or a CSS `padding` string). */
	setPadding(padding: number | string | undefined): void;
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
	// Show a loading overlay immediately (before the async imports below) so the
	// container is never blank while we prepare.
	const removeLoading = options.loading === false ? undefined : showLoadingOverlay(target, options.loadingText);

	// Optional peer deps, loaded lazily so the core client stays xterm-free.
	const [{ Terminal }, { FitAddon }] = (await Promise.all([
		import('@xterm/xterm'),
		import('@xterm/addon-fit'),
	]).catch((err) => {
		removeLoading?.();
		throw err;
	})) as [any, any];

	const resolvedTheme = resolveTheme(options.theme);
	const terminal = new Terminal({
		scrollback: options.scrollback ?? 5000,
		fontSize: options.fontSize ?? 13,
		fontFamily: options.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace',
		lineHeight: options.lineHeight ?? 1.0,
		cursorBlink: options.cursorBlink ?? true,
		cursorStyle: options.cursorStyle ?? 'block',
		allowProposedApi: true,
		theme: resolvedTheme,
		...(options.terminalOptions ?? {}),
	});
	const fitAddon = options.fit === false ? undefined : new FitAddon();
	if (fitAddon) terminal.loadAddon(fitAddon);

	// Built-in optional addons — lazy, each an optional peer dep (skip if absent).
	// On by default; opt out with `false`.
	if (options.clipboard !== false) {
		try {
			const { ClipboardAddon } = (await import('@xterm/addon-clipboard')) as any;
			terminal.loadAddon(new ClipboardAddon());
		} catch { /* addon not installed */ }
	}
	if (options.webLinks !== false) {
		try {
			const { WebLinksAddon } = (await import('@xterm/addon-web-links')) as any;
			terminal.loadAddon(new WebLinksAddon());
		} catch { /* addon not installed */ }
	}
	if (options.unicode11 !== false) {
		try {
			const { Unicode11Addon } = (await import('@xterm/addon-unicode11')) as any;
			terminal.loadAddon(new Unicode11Addon());
			terminal.unicode.activeVersion = '11';
		} catch { /* addon not installed */ }
	}
	for (const addon of options.addons ?? []) terminal.loadAddon(addon);
	terminal.open(target);
	// Paint the container background and apply any padding BEFORE the first fit, so
	// the FitAddon measures the padded box and any leftover (padding + integer-cell
	// remainder) blends into the terminal instead of showing a contrasting colour
	// behind it — a seamless, gap-free fill.
	applyChrome(target, terminal, resolvedTheme.background, options.padding);
	if (options.ligatures !== false) {
		try {
			const { LigaturesAddon } = (await import('@xterm/addon-ligatures')) as any;
			terminal.loadAddon(new LigaturesAddon());
		} catch { /* addon not installed / no ligature font */ }
	}
	const detachContextMenu = options.contextMenu === false ? undefined : attachContextMenu(terminal);
	options.onReady?.(terminal);

	// Fit to the container BEFORE attaching so the create/attach request carries
	// the real viewport size. The server then resizes the session (and its
	// scrollback) to match before replaying — the fix for garbled full-screen TUI
	// restores, where the replayed frame's dimensions didn't match the viewport.
	let fitCols: number | undefined;
	let fitRows: number | undefined;
	if (fitAddon) {
		try {
			const dims = fitTerminal(terminal, fitAddon);
			if (dims) {
				fitCols = dims.cols;
				fitRows = dims.rows;
			}
		} catch { /* container not laid out yet; attachFit retries once visible */ }
	}

	const ownClient = !options.client;
	const client =
		options.client ??
		new PtyKitClient({
			url: options.url,
			namespace: options.namespace,
			reconnect: options.reconnect,
			persistence: options.persistence,
			requestTimeoutMs: options.requestTimeoutMs,
			WebSocketImpl: options.WebSocketImpl,
		});

	const unsubs: Array<() => void> = [];
	if (detachContextMenu) unsubs.push(detachContextMenu);
	if (options.onStatus) unsubs.push(client.onStatus(options.onStatus));

	const open = {
		sessionId: options.sessionId,
		namespace: options.namespace,
		cols: options.cols ?? fitCols ?? terminal.cols,
		rows: options.rows ?? fitRows ?? terminal.rows,
		cwd: options.cwd,
		shell: options.shell,
	};

	let session: ClientSession;
	try {
		session = options.create
			? await client.create(open)
			: await client.attach(options.sessionId, open);
	} catch (err) {
		removeLoading?.();
		for (const u of unsubs) u();
		terminal.dispose();
		if (ownClient) client.disconnect();
		options.onError?.(err);
		throw err;
	}
	removeLoading?.();

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
	let currentBackground = resolvedTheme.background;
	let currentPadding = options.padding;
	return {
		client,
		session,
		terminal,
		fitAddon,
		setTheme(theme) {
			const resolved = resolveTheme(theme);
			terminal.options.theme = resolved;
			// Repaint the padding/remainder fill so it tracks the new background.
			currentBackground = resolved.background;
			applyChrome(target, terminal, currentBackground, currentPadding);
		},
		setPadding(padding) {
			currentPadding = padding;
			applyChrome(target, terminal, currentBackground, padding);
		},
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

/**
 * Make the terminal fill its container seamlessly: paint the theme background and
 * apply inner `padding`, so the padded area and the FitAddon's sub-cell remainder
 * read as part of the terminal instead of exposing a contrasting colour.
 *
 * The `.xterm` element is the one that matters: xterm's base stylesheet gives it
 * an opaque `background: #000`, and PtyKit stretches it to `height: 100%`, so it
 * covers the whole mount box — including the bottom/right remainder below the
 * (theme-coloured) viewport. Repainting it with the theme background is what
 * actually closes the gap; the container is painted too as a cheap fallback for
 * any layout where `.xterm` doesn't fill it. Padding goes on `.xterm` so the
 * FitAddon measures the padded box and shrinks the grid to fit. The `.xterm`
 * steps are a no-op before the terminal is opened.
 */
function applyChrome(
	container: HTMLElement,
	terminal: any,
	background: string | undefined,
	padding: number | string | undefined,
): void {
	if (background) container.style.backgroundColor = background;
	const el: HTMLElement | undefined = terminal.element;
	if (!el) return;
	if (background) el.style.backgroundColor = background;
	el.style.padding = padding === undefined ? '' : typeof padding === 'number' ? `${padding}px` : padding;
}

/**
 * Wire a right-click context menu onto an open xterm terminal: copy the current
 * selection to the clipboard, or — when nothing is selected — paste the clipboard
 * into the terminal (which forwards to the PTY via `onData`). Returns a disposer;
 * a no-op if the terminal has no element yet or the Clipboard API is unavailable.
 */
function attachContextMenu(terminal: any): () => void {
	const el: HTMLElement | undefined = terminal.element;
	if (!el) return () => {};
	const handler = async (event: MouseEvent) => {
		event.preventDefault();
		const selection: string = terminal.getSelection?.() ?? '';
		try {
			if (selection.trim()) {
				await navigator.clipboard.writeText(selection);
				terminal.clearSelection?.();
			} else {
				const text = await navigator.clipboard.readText();
				if (text) terminal.paste?.(text);
			}
		} catch {
			/* clipboard unavailable / permission denied */
		}
	};
	el.addEventListener('contextmenu', handler);
	return () => el.removeEventListener('contextmenu', handler);
}
