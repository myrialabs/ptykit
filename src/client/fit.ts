/**
 * `attachFit` (R15) — bind an xterm `FitAddon` + `ResizeObserver` to a session.
 *
 * Fits the terminal to its container on resize (debounced, default 100ms),
 * skips redundant resizes, and forwards the new dimensions to the server.
 */

import type { ClientSession } from './pty-kit-client.js';

/** Minimal xterm Terminal shape we depend on. */
interface TerminalLike {
	element?: HTMLElement | undefined;
}
/** Minimal FitAddon shape we depend on. */
interface FitAddonLike {
	fit(): void;
	proposeDimensions(): { cols: number; rows: number } | undefined;
}

export interface AttachFitOptions {
	debounceMs?: number;
}

/**
 * Observe the terminal's container, fit on resize, and send `resize` to the
 * server. Returns a disposer that stops observing.
 */
export function attachFit(
	session: Pick<ClientSession, 'resize'>,
	term: TerminalLike,
	fitAddon: FitAddonLike,
	options: AttachFitOptions = {},
): () => void {
	const debounceMs = options.debounceMs ?? 100;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let last: { cols: number; rows: number } | null = null;

	const run = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			try {
				// Skip while the terminal is hidden / not laid out. A zero-size
				// container makes `fit()` resize the terminal (and the PTY) toward
				// zero, which reflows and drops scrollback — and shows up as lost
				// lines, garbled repaints, and full-screen apps re-initializing when
				// a tab is toggled with `display:none`. Fit again once it's visible.
				const el = term.element;
				if (el && (el.clientWidth === 0 || el.clientHeight === 0)) return;
				fitAddon.fit();
				const dims = fitAddon.proposeDimensions();
				if (!dims || !(dims.cols > 0) || !(dims.rows > 0)) return;
				if (last && last.cols === dims.cols && last.rows === dims.rows) return;
				last = { cols: dims.cols, rows: dims.rows };
				void session.resize(dims.cols, dims.rows);
			} catch {
				/* container may have zero dimensions; will retry on next resize */
			}
		}, debounceMs);
	};

	const target = term.element?.parentElement ?? term.element ?? null;
	const observer =
		typeof ResizeObserver !== 'undefined' && target ? new ResizeObserver(run) : null;
	observer?.observe(target as Element);

	// Initial fit.
	run();

	return () => {
		if (timer) clearTimeout(timer);
		observer?.disconnect();
	};
}
