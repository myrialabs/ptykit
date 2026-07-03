/**
 * Theming a terminal with `mountTerminal`.
 *
 * `theme` accepts a built-in preset **name** — `dark`, `light`, `solarized-dark`,
 * `solarized-light`, `dracula`, `nord`, `matrix` — so you never hand-write a
 * palette. It also takes a full xterm `ITheme` object when you want something
 * bespoke (the "Custom" button below). Picking a theme **restyles the live
 * terminal in place** via `handle.setTheme(...)`: no remount, so the session and
 * its scrollback stay put.
 *
 * In-repo it imports from `../../src/client/...`; a published app would import
 * from `@myrialabs/ptykit/client`.
 */

import {
	PtyKitClient,
	mountTerminal,
	themes,
	type TerminalHandle,
	type TerminalTheme,
	type ThemeName,
} from '../../src/client/index.js';

// Every built-in preset, by name — no palette to write.
const PRESETS = Object.keys(themes) as ThemeName[];

// `theme` also accepts a full ITheme object. This custom palette (Tokyo Night)
// shows you can override a preset entirely when a name isn't enough.
const CUSTOM: TerminalTheme = {
	background: '#1a1b26',
	foreground: '#c0caf5',
	cursor: '#c0caf5',
	selectionBackground: '#283457',
	black: '#15161e',
	red: '#f7768e',
	green: '#9ece6a',
	yellow: '#e0af68',
	blue: '#7aa2f7',
	magenta: '#bb9af7',
	cyan: '#7dcfff',
	white: '#a9b1d6',
	brightBlack: '#414868',
	brightRed: '#f7768e',
	brightGreen: '#9ece6a',
	brightYellow: '#e0af68',
	brightBlue: '#7aa2f7',
	brightMagenta: '#bb9af7',
	brightCyan: '#7dcfff',
	brightWhite: '#c0caf5',
};

const choices: Array<{ label: string; theme: ThemeName | TerminalTheme }> = [
	...PRESETS.map((name) => ({ label: name, theme: name as ThemeName | TerminalTheme })),
	{ label: 'custom · Tokyo Night', theme: CUSTOM },
];

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty`;
const SESSION = 'styled-terminal-1';

const screenEl = document.getElementById('screen') as HTMLDivElement;
const statusEl = document.getElementById('status')!;
const barEl = document.getElementById('presets') as HTMLDivElement;

// One shared client/socket; the terminal is mounted once and restyled in place.
const client = new PtyKitClient({ url: wsUrl, namespace: 'demo' });
client.onStatus((s) => {
	statusEl.textContent = s;
	statusEl.dataset.status = s;
});

let handle: TerminalHandle | undefined;

async function ensureMounted(): Promise<TerminalHandle> {
	if (!handle) {
		handle = await mountTerminal(screenEl, {
			url: wsUrl,
			client,
			sessionId: SESSION,
			create: true,
			fontSize: 14,
		});
	}
	return handle;
}

async function applyTheme(label: string, theme: ThemeName | TerminalTheme) {
	for (const btn of barEl.querySelectorAll('button')) {
		btn.classList.toggle('active', btn.dataset.preset === label);
	}
	const h = await ensureMounted();
	h.setTheme(theme); // preset name or full ITheme — no remount
	h.terminal.focus();
}

for (const { label, theme } of choices) {
	const btn = document.createElement('button');
	btn.textContent = label;
	btn.dataset.preset = label;
	btn.addEventListener('click', () => void applyTheme(label, theme));
	barEl.appendChild(btn);
}

await applyTheme('dark', 'dark');
