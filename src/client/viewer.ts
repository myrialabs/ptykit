/**
 * `mountViewer` — a ready-to-use, read-only xterm.js terminal for displaying
 * streamed output (build logs, install progress, debug traces) with no PTY,
 * WebSocket, or user input.
 *
 * It is the output-only sibling of {@link mountTerminal}: same appearance/addon
 * options and the same lazy xterm loading (SSR-safe), but instead of attaching a
 * session it hands back a `write`/`clear`/`fit`/`dispose` handle. Consumers push
 * text with `write()` — so an app never has to hand-wire `new Terminal()`,
 * `loadAddon`, `open`, and a `ResizeObserver` itself.
 */

import { attachFit } from './fit.js';
import { showLoadingOverlay } from './loading.js';
import { resolveTheme, type ThemeName, type TerminalTheme } from './themes.js';

export interface MountViewerOptions {
	// --- appearance ---
	scrollback?: number;
	fontSize?: number;
	fontFamily?: string;
	lineHeight?: number;
	cursorBlink?: boolean;
	cursorStyle?: 'block' | 'underline' | 'bar';
	/**
	 * A built-in preset name (`'dark'` | `'light'`) or a full xterm `ITheme` object.
	 * Defaults to the `dark` preset.
	 */
	theme?: ThemeName | TerminalTheme;
	/** Extra/override xterm `Terminal` options. */
	terminalOptions?: Record<string, unknown>;
	cols?: number;
	rows?: number;
	/** Accept keystrokes? Default `false` — a viewer is output-only. */
	stdin?: boolean;

	// --- addons ---
	/** Extra xterm addon instances loaded after the FitAddon. */
	addons?: unknown[];
	/** Built-in optional addons (lazy; skipped if the peer dep is absent). */
	clipboard?: boolean;
	webLinks?: boolean;
	unicode11?: boolean;
	ligatures?: boolean;

	// --- behavior ---
	/** Attach a FitAddon + ResizeObserver. Default `true`. */
	fit?: boolean;
	fitDebounceMs?: number;
	/** Show a built-in spinner overlay while xterm loads. Default `true`. */
	loading?: boolean;
	/** Label under the loading spinner. Default `'Loading…'`; `''` for spinner only. */
	loadingText?: string;
	/** Called with the raw `terminal` after addons load, before returning. */
	onReady?: (terminal: any) => void;
}

export interface TerminalViewerHandle {
	/** The xterm `Terminal` instance (loosely typed to avoid a hard xterm dep). */
	terminal: any;
	/** The xterm `FitAddon` (`undefined` when `fit: false`). */
	fitAddon: any;
	/** Write output to the terminal. */
	write(data: string): void;
	/** Clear + reset to a blank slate. */
	clear(): void;
	/** Re-fit to the container. */
	fit(): void;
	/** Swap the theme at runtime (preset name or `ITheme`) — e.g. dark/light toggle. */
	setTheme(theme: ThemeName | TerminalTheme): void;
	/** Dispose the terminal and stop observing resizes. Idempotent. */
	dispose(): void;
}

/**
 * Mount a read-only xterm terminal into `target`. Resolves once it is open and
 * fitted. Push output with the returned `write()`.
 */
export async function mountViewer(
	target: HTMLElement,
	options: MountViewerOptions = {},
): Promise<TerminalViewerHandle> {
	const removeLoading =
		options.loading === false ? undefined : showLoadingOverlay(target, options.loadingText ?? 'Loading…');

	const [{ Terminal }, { FitAddon }] = (await Promise.all([
		import('@xterm/xterm'),
		import('@xterm/addon-fit'),
	]).catch((err) => {
		removeLoading?.();
		throw err;
	})) as [any, any];

	const terminal = new Terminal({
		scrollback: options.scrollback ?? 5000,
		fontSize: options.fontSize ?? 13,
		fontFamily: options.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace',
		lineHeight: options.lineHeight ?? 1.0,
		cursorBlink: options.cursorBlink ?? false,
		cursorStyle: options.cursorStyle ?? 'block',
		disableStdin: options.stdin !== true,
		allowProposedApi: true,
		// Viewers stream log/tool output that often uses bare "\n" line endings;
		// default to translating them to CRLF so lines don't stair-step. Override
		// via `terminalOptions` if a source already sends CRLF.
		convertEol: true,
		theme: resolveTheme(options.theme),
		...(options.cols ? { cols: options.cols } : {}),
		...(options.rows ? { rows: options.rows } : {}),
		...(options.terminalOptions ?? {}),
	});

	const fitAddon = options.fit === false ? undefined : new FitAddon();
	if (fitAddon) terminal.loadAddon(fitAddon);

	if (options.clipboard) {
		try {
			const { ClipboardAddon } = (await import('@xterm/addon-clipboard')) as any;
			terminal.loadAddon(new ClipboardAddon());
		} catch { /* addon not installed */ }
	}
	if (options.webLinks) {
		try {
			const { WebLinksAddon } = (await import('@xterm/addon-web-links')) as any;
			terminal.loadAddon(new WebLinksAddon());
		} catch { /* addon not installed */ }
	}
	if (options.unicode11) {
		try {
			const { Unicode11Addon } = (await import('@xterm/addon-unicode11')) as any;
			terminal.loadAddon(new Unicode11Addon());
			terminal.unicode.activeVersion = '11';
		} catch { /* addon not installed */ }
	}
	for (const addon of options.addons ?? []) terminal.loadAddon(addon);

	terminal.open(target);

	if (options.ligatures) {
		try {
			const { LigaturesAddon } = (await import('@xterm/addon-ligatures')) as any;
			terminal.loadAddon(new LigaturesAddon());
		} catch { /* addon not installed / no ligature font */ }
	}

	// No PTY behind a viewer — fit locally without forwarding a server resize.
	const detachFit = fitAddon
		? attachFit({ resize: async () => {} }, terminal, fitAddon, { debounceMs: options.fitDebounceMs ?? 100 })
		: undefined;

	options.onReady?.(terminal);
	removeLoading?.();

	let disposed = false;
	return {
		terminal,
		fitAddon,
		write: (data: string) => terminal.write(data),
		clear: () => {
			terminal.clear();
			terminal.reset();
		},
		fit: () => fitAddon?.fit(),
		setTheme: (theme) => {
			terminal.options.theme = resolveTheme(theme);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			detachFit?.();
			terminal.dispose();
		},
	};
}
