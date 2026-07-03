/**
 * Built-in xterm theme presets.
 *
 * A terminal without a theme falls back to xterm's stark black-on-white default
 * and a bare 16-colour ANSI palette — so every app ends up hand-writing the same
 * 18+ colour keys. PtyKit ships a curated set of complete presets so you can pick
 * one by name (`theme: 'solarized-dark'`) instead of pasting a palette, while
 * `theme` still accepts a full `ITheme` object when you want something bespoke.
 *
 * Presets are plain data (no xterm import), so importing them is free on the
 * server. Switch at runtime with the `setTheme` handle method (or the reactive
 * `theme` prop on the Svelte component) — e.g. to follow `prefers-color-scheme`.
 */

/** A loosely-typed xterm `ITheme` (avoids a hard xterm type dependency). */
export type TerminalTheme = Record<string, string>;

/** Balanced dark preset — neutral slate background, full 16-colour ANSI palette. */
export const darkTheme: TerminalTheme = {
	background: '#0f172a',
	foreground: '#e2e8f0',
	cursor: '#e2e8f0',
	cursorAccent: '#0f172a',
	selectionBackground: 'rgba(148, 163, 184, 0.3)',
	black: '#1e293b',
	red: '#ef4444',
	green: '#22c55e',
	yellow: '#eab308',
	blue: '#3b82f6',
	magenta: '#a855f7',
	cyan: '#06b6d4',
	white: '#f1f5f9',
	brightBlack: '#475569',
	brightRed: '#f87171',
	brightGreen: '#4ade80',
	brightYellow: '#facc15',
	brightBlue: '#60a5fa',
	brightMagenta: '#c084fc',
	brightCyan: '#22d3ee',
	brightWhite: '#ffffff',
};

/** Balanced light preset — white background, darker ANSI palette for contrast. */
export const lightTheme: TerminalTheme = {
	background: '#ffffff',
	foreground: '#1e293b',
	cursor: '#1e293b',
	cursorAccent: '#ffffff',
	selectionBackground: 'rgba(148, 163, 184, 0.35)',
	black: '#1e293b',
	red: '#dc2626',
	green: '#16a34a',
	yellow: '#ca8a04',
	blue: '#2563eb',
	magenta: '#9333ea',
	cyan: '#0891b2',
	white: '#f1f5f9',
	brightBlack: '#475569',
	brightRed: '#ef4444',
	brightGreen: '#22c55e',
	brightYellow: '#eab308',
	brightBlue: '#3b82f6',
	brightMagenta: '#a855f7',
	brightCyan: '#06b6d4',
	brightWhite: '#ffffff',
};

/** Solarized Dark — Ethan Schoonover's classic low-contrast dark palette. */
export const solarizedDarkTheme: TerminalTheme = {
	background: '#002b36',
	foreground: '#839496',
	cursor: '#93a1a1',
	cursorAccent: '#002b36',
	selectionBackground: '#073642',
	black: '#073642',
	red: '#dc322f',
	green: '#859900',
	yellow: '#b58900',
	blue: '#268bd2',
	magenta: '#d33682',
	cyan: '#2aa198',
	white: '#eee8d5',
	brightBlack: '#586e75',
	brightRed: '#cb4b16',
	brightGreen: '#586e75',
	brightYellow: '#657b83',
	brightBlue: '#839496',
	brightMagenta: '#6c71c4',
	brightCyan: '#93a1a1',
	brightWhite: '#fdf6e3',
};

/** Solarized Light — the light counterpart, warm paper background. */
export const solarizedLightTheme: TerminalTheme = {
	background: '#fdf6e3',
	foreground: '#657b83',
	cursor: '#586e75',
	cursorAccent: '#fdf6e3',
	selectionBackground: '#eee8d5',
	black: '#073642',
	red: '#dc322f',
	green: '#859900',
	yellow: '#b58900',
	blue: '#268bd2',
	magenta: '#d33682',
	cyan: '#2aa198',
	white: '#eee8d5',
	brightBlack: '#002b36',
	brightRed: '#cb4b16',
	brightGreen: '#586e75',
	brightYellow: '#657b83',
	brightBlue: '#839496',
	brightMagenta: '#6c71c4',
	brightCyan: '#93a1a1',
	brightWhite: '#fdf6e3',
};

/** Dracula — the popular high-contrast dark theme. */
export const draculaTheme: TerminalTheme = {
	background: '#282a36',
	foreground: '#f8f8f2',
	cursor: '#f8f8f2',
	cursorAccent: '#282a36',
	selectionBackground: '#44475a',
	black: '#21222c',
	red: '#ff5555',
	green: '#50fa7b',
	yellow: '#f1fa8c',
	blue: '#bd93f9',
	magenta: '#ff79c6',
	cyan: '#8be9fd',
	white: '#f8f8f2',
	brightBlack: '#6272a4',
	brightRed: '#ff6e6e',
	brightGreen: '#69ff94',
	brightYellow: '#ffffa5',
	brightBlue: '#d6acff',
	brightMagenta: '#ff92df',
	brightCyan: '#a4ffff',
	brightWhite: '#ffffff',
};

/** Nord — arctic, muted blue-grey palette. */
export const nordTheme: TerminalTheme = {
	background: '#2e3440',
	foreground: '#d8dee9',
	cursor: '#d8dee9',
	cursorAccent: '#2e3440',
	selectionBackground: '#434c5e',
	black: '#3b4252',
	red: '#bf616a',
	green: '#a3be8c',
	yellow: '#ebcb8b',
	blue: '#81a1c1',
	magenta: '#b48ead',
	cyan: '#88c0d0',
	white: '#e5e9f0',
	brightBlack: '#4c566a',
	brightRed: '#bf616a',
	brightGreen: '#a3be8c',
	brightYellow: '#ebcb8b',
	brightBlue: '#81a1c1',
	brightMagenta: '#b48ead',
	brightCyan: '#8fbcbb',
	brightWhite: '#eceff4',
};

/** Matrix — monochrome green-on-black, for fun. */
export const matrixTheme: TerminalTheme = {
	background: '#000000',
	foreground: '#22c55e',
	cursor: '#22c55e',
	cursorAccent: '#000000',
	selectionBackground: 'rgba(34, 197, 94, 0.3)',
	black: '#001a00',
	red: '#008f11',
	green: '#22c55e',
	yellow: '#00ff41',
	blue: '#00a86b',
	magenta: '#16a34a',
	cyan: '#4ade80',
	white: '#86efac',
	brightBlack: '#003b00',
	brightRed: '#00c030',
	brightGreen: '#4ade80',
	brightYellow: '#86efac',
	brightBlue: '#22c55e',
	brightMagenta: '#00ff41',
	brightCyan: '#86efac',
	brightWhite: '#dcfce7',
};

/**
 * Named preset registry. Add more presets here; consumers pick by name via the
 * `theme` option/prop. `dark` and `light` are the semantic defaults.
 */
export const themes = {
	dark: darkTheme,
	light: lightTheme,
	'solarized-dark': solarizedDarkTheme,
	'solarized-light': solarizedLightTheme,
	dracula: draculaTheme,
	nord: nordTheme,
	matrix: matrixTheme,
} as const;

/** A built-in preset name. */
export type ThemeName = keyof typeof themes;

/**
 * Resolve a theme option to a concrete `ITheme`. Accepts a preset name, a full
 * theme object (used verbatim), or `undefined` (falls back to the `dark` preset).
 * An unknown preset name also falls back to `dark`.
 */
export function resolveTheme(theme?: ThemeName | TerminalTheme): TerminalTheme {
	if (!theme) return darkTheme;
	if (typeof theme === 'string') return themes[theme] ?? darkTheme;
	return theme;
}
