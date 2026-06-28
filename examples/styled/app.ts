/**
 * Styling a terminal with `mountTerminal`.
 *
 * `mountTerminal` is ready-to-use but stays fully configurable: theme, font,
 * cursor, line height, and any extra xterm `Terminal` option pass straight
 * through. This page defines a few presets and re-mounts the terminal when you
 * pick one — all panes share one client and one session, so the serialized
 * scrollback replays and your shell history survives the restyle.
 *
 * In-repo it imports from `../../src/client/...`; a published app would import
 * from `ptykit/client`.
 */

import {
	PtyKitClient,
	mountTerminal,
	type MountTerminalOptions,
	type TerminalHandle,
} from '../../src/client/index.js';

/** A named bundle of the style-related `mountTerminal` options. */
type Preset = Pick<
	MountTerminalOptions,
	'fontSize' | 'fontFamily' | 'lineHeight' | 'cursorStyle' | 'cursorBlink' | 'theme'
>;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const presets: Record<string, Preset> = {
	Midnight: {
		fontSize: 14,
		fontFamily: MONO,
		cursorStyle: 'bar',
		theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#22c55e' },
	},
	Solarized: {
		fontSize: 14,
		fontFamily: MONO,
		lineHeight: 1.1,
		cursorStyle: 'block',
		theme: {
			background: '#002b36',
			foreground: '#93a1a1',
			cursor: '#b58900',
			black: '#073642',
			green: '#859900',
			blue: '#268bd2',
			red: '#dc322f',
		},
	},
	Matrix: {
		fontSize: 15,
		fontFamily: MONO,
		cursorStyle: 'underline',
		cursorBlink: true,
		theme: { background: '#000000', foreground: '#22c55e', cursor: '#22c55e' },
	},
	Paper: {
		fontSize: 14,
		fontFamily: 'Georgia, "Times New Roman", serif',
		lineHeight: 1.2,
		cursorStyle: 'bar',
		cursorBlink: false,
		theme: { background: '#fdf6e3', foreground: '#586e75', cursor: '#cb4b16' },
	},
	Light: {
		// A crisp light mode — readable ANSI palette tuned for a white background.
		fontSize: 14,
		fontFamily: MONO,
		cursorStyle: 'bar',
		theme: {
			background: '#ffffff',
			foreground: '#24292f',
			cursor: '#0969da',
			cursorAccent: '#ffffff',
			selectionBackground: '#b6e3ff',
			black: '#24292f',
			red: '#cf222e',
			green: '#116329',
			yellow: '#4d2d00',
			blue: '#0969da',
			magenta: '#8250df',
			cyan: '#1b7c83',
			white: '#6e7781',
		},
	},
};

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty`;
const SESSION = 'styled-terminal-1';

const screenEl = document.getElementById('screen') as HTMLDivElement;
const statusEl = document.getElementById('status')!;
const barEl = document.getElementById('presets') as HTMLDivElement;

// One shared client/socket; each restyle re-mounts the same session on it.
const client = new PtyKitClient({ url: wsUrl, namespace: 'demo' });
client.onStatus((s) => {
	statusEl.textContent = s;
	statusEl.dataset.status = s;
});

let handle: TerminalHandle | undefined;
let created = false;

async function applyPreset(name: string) {
	const preset = presets[name];
	if (!preset) return;

	for (const btn of barEl.querySelectorAll('button')) {
		btn.classList.toggle('active', btn.dataset.preset === name);
	}

	// Tear down the previous terminal (keeps the shared client/session alive).
	handle?.dispose();

	handle = await mountTerminal(screenEl, {
		url: wsUrl,
		client,
		sessionId: SESSION,
		create: !created, // create once, then attach (replays scrollback)
		...preset,
	});
	created = true;
	handle.terminal.focus();
}

for (const name of Object.keys(presets)) {
	const btn = document.createElement('button');
	btn.textContent = name;
	btn.dataset.preset = name;
	btn.addEventListener('click', () => void applyPreset(name));
	barEl.appendChild(btn);
}

await applyPreset('Midnight');
