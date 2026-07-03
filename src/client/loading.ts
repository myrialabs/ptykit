/**
 * A tiny, dependency-free loading overlay for the moment between "mount called"
 * and "terminal ready" — so a container shows a spinner instead of blank space
 * while xterm loads and the session attaches.
 *
 * Self-contained: injects one small stylesheet (once) and an absolutely-positioned
 * overlay into the target. Neutral slate colours read on both light and dark
 * backgrounds. SSR-safe (no-op without a `document`). Returns a disposer.
 */

const STYLE_ID = 'ptykit-loading-style';

const STYLE = `
@keyframes ptykit-spin { to { transform: rotate(360deg); } }
.ptykit-loading {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	pointer-events: none;
	font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
	color: #94a3b8;
}
.ptykit-loading__spinner {
	width: 18px;
	height: 18px;
	border: 2px solid currentColor;
	border-top-color: transparent;
	border-radius: 50%;
	opacity: 0.7;
	animation: ptykit-spin 0.7s linear infinite;
}
.ptykit-loading__text { opacity: 0.7; letter-spacing: 0.02em; }
@media (prefers-reduced-motion: reduce) {
	.ptykit-loading__spinner { animation-duration: 2s; }
}
`;

function ensureStyle(): void {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = STYLE;
	document.head.appendChild(style);
}

/**
 * Show a spinner overlay inside `target`. `text` labels it (empty string = spinner
 * only). Returns an idempotent disposer that removes the overlay.
 */
export function showLoadingOverlay(target: HTMLElement, text = 'Connecting…'): () => void {
	if (typeof document === 'undefined') return () => {};
	ensureStyle();

	// The overlay is absolutely positioned; make sure the target can anchor it.
	if (getComputedStyle(target).position === 'static') target.style.position = 'relative';

	const overlay = document.createElement('div');
	overlay.className = 'ptykit-loading';
	const spinner = document.createElement('div');
	spinner.className = 'ptykit-loading__spinner';
	overlay.appendChild(spinner);
	if (text) {
		const label = document.createElement('div');
		label.className = 'ptykit-loading__text';
		label.textContent = text;
		overlay.appendChild(label);
	}
	target.appendChild(overlay);

	let removed = false;
	return () => {
		if (removed) return;
		removed = true;
		overlay.remove();
	};
}
