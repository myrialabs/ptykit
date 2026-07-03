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
	rows?: number;
	resize?(cols: number, rows: number): void;
	/** Private render internals — read the same way `FitAddon` does, for cell size. */
	_core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
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
 * Compute the fitted dimensions and resize the terminal to them.
 *
 * Preferred path computes cols/rows directly from the container's content box and
 * the live cell size, which fixes two things xterm's stock `FitAddon` gets wrong
 * for an embedded, edge-to-edge terminal:
 *
 * 1. **Scrollbar gutter** — `FitAddon` always subtracts a hard-coded ~15px for the
 *    scrollbar (`overviewRuler.width || DEFAULT_SCROLL_BAR_WIDTH`), even when the OS
 *    uses 0-width overlay scrollbars. That leaves a wide, asymmetric gap on the
 *    right. We subtract the *measured* scrollbar width instead (0 for overlays →
 *    grid fills the width; the real width on classic scrollbars → no overlap).
 * 2. **Bottom fill vs. padding** — a character grid only shows whole rows, so a
 *    non-multiple height leaves a sliver at the bottom. With no vertical padding we
 *    add one (clipped) row so the grid fills edge-to-edge; with padding we don't —
 *    the padding band already absorbs the remainder, and overscanning would eat the
 *    bottom padding entirely.
 *
 * Falls back to `FitAddon.proposeDimensions()` when the DOM/cell size isn't
 * measurable yet. Returns the applied dims, or `undefined` if not laid out.
 */
export function fitTerminal(
	term: TerminalLike,
	fitAddon: FitAddonLike,
): { cols: number; rows: number } | undefined {
	const dims = computeDimensions(term) ?? fitAddon.proposeDimensions();
	if (!dims || !(dims.cols > 0) || !(dims.rows > 0)) return undefined;
	term.resize?.(dims.cols, dims.rows);
	return dims;
}

/**
 * Cols/rows from the container content box and live cell size — see
 * {@link fitTerminal}. `undefined` when it can't measure (caller falls back).
 */
function computeDimensions(term: TerminalLike): { cols: number; rows: number } | undefined {
	const el = term.element;
	const parent = el?.parentElement;
	const cell = cellSize(term);
	if (!el || !parent || !cell || typeof getComputedStyle !== 'function') return undefined;

	const cs = getComputedStyle(el);
	const padTop = parseFloat(cs.paddingTop) || 0;
	const padBottom = parseFloat(cs.paddingBottom) || 0;
	const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
	const availWidth = parent.clientWidth - padX - scrollbarWidth(el);
	const availHeight = parent.clientHeight - padTop - padBottom;
	if (!(availWidth > 0) || !(availHeight > 0)) return undefined;

	const cols = Math.max(2, Math.floor(availWidth / cell.width));
	let rows = Math.max(1, Math.floor(availHeight / cell.height));
	// Fill the vertical remainder edge-to-edge only when no vertical padding is
	// there to absorb it; with padding, the remainder blends into the padding band
	// and an extra row would overflow (and clip away) that padding.
	if (padTop === 0 && padBottom === 0 && availHeight - rows * cell.height > 1) rows += 1;
	return { cols, rows };
}

/** Live CSS cell size from the render service (the field `FitAddon` uses too). */
function cellSize(term: TerminalLike): { width: number; height: number } | undefined {
	const c = term._core?._renderService?.dimensions?.css?.cell;
	return c && (c.width ?? 0) > 0 && (c.height ?? 0) > 0
		? { width: c.width as number, height: c.height as number }
		: undefined;
}

/**
 * Width the scrollbar actually reserves in layout — `offsetWidth - clientWidth` of
 * the viewport. 0 for overlay scrollbars (so the grid fills the width), the real
 * width for classic ones (so text isn't hidden under it). Unlike `FitAddon`'s
 * hard-coded reservation, this adapts to the platform.
 */
function scrollbarWidth(el: HTMLElement): number {
	const vp = el.querySelector?.('.xterm-viewport') as HTMLElement | null;
	if (!vp) return 0;
	return Math.max(0, vp.offsetWidth - vp.clientWidth);
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
				const dims = fitTerminal(term, fitAddon);
				if (!dims) return;
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
