import { expect, test } from 'bun:test';
import { resolveTheme, themes, darkTheme, lightTheme, solarizedDarkTheme } from './themes.js';

test('resolveTheme falls back to the dark preset for undefined/unknown', () => {
	expect(resolveTheme()).toBe(darkTheme);
	// @ts-expect-error — exercising the unknown-name runtime fallback
	expect(resolveTheme('nope')).toBe(darkTheme);
});

test('resolveTheme looks up preset names', () => {
	expect(resolveTheme('dark')).toBe(darkTheme);
	expect(resolveTheme('light')).toBe(lightTheme);
	expect(resolveTheme('solarized-dark')).toBe(solarizedDarkTheme);
	expect(themes.light.background).toBe('#ffffff');
	expect(themes['solarized-dark'].background).toBe('#002b36');
});

test('resolveTheme passes a full theme object through verbatim', () => {
	const custom = { background: 'rgba(0,0,0,0)', foreground: '#fff' };
	expect(resolveTheme(custom)).toBe(custom);
});

test('every preset carries a complete 16-colour ANSI palette', () => {
	const keys = [
		'background', 'foreground', 'cursor', 'selectionBackground',
		'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
		'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
		'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
	];
	for (const [name, preset] of Object.entries(themes)) {
		for (const key of keys) {
			expect(preset[key as keyof typeof preset], `${name}.${key}`).toMatch(/^(#|rgb)/);
		}
	}
});
