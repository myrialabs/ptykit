import { afterEach, beforeEach, expect, test } from 'bun:test';
import { buildPtyEnv, getCleanSpawnEnv } from './env.js';

const saved = { ...process.env };

beforeEach(() => {
	process.env.npm_config_foo = 'x';
	process.env.VITE_SECRET = 'y';
	process.env._BUN_WATCHER_CHILD = '1';
	process.env.MY_REAL_VAR = 'keep-me';
	process.env.PATH = '/usr/bin:/repo/node_modules/.bin:/bin';
});

afterEach(() => {
	for (const k of Object.keys(process.env)) delete process.env[k];
	Object.assign(process.env, saved);
});

test('getCleanSpawnEnv strips runtime pollution but keeps real vars', () => {
	const env = getCleanSpawnEnv();
	expect(env.npm_config_foo).toBeUndefined();
	expect(env.VITE_SECRET).toBeUndefined();
	expect(env._BUN_WATCHER_CHILD).toBeUndefined();
	expect(env.MY_REAL_VAR).toBe('keep-me');
});

test('getCleanSpawnEnv removes node_modules/.bin from PATH', () => {
	const env = getCleanSpawnEnv();
	expect(env.PATH).toBe('/usr/bin:/bin');
});

test('buildPtyEnv injects terminal defaults and PTY size', () => {
	const env = buildPtyEnv({ sanitize: true }, { cols: 120, rows: 40 });
	expect(env.TERM).toBe('xterm-256color');
	expect(env.COLORTERM).toBe('truecolor');
	expect(env.FORCE_COLOR).toBe('1');
	expect(env.TERM_PROGRAM).toBe('xterm.js');
	expect(env.COLUMNS).toBe('120');
	expect(env.LINES).toBe('40');
});

test('buildPtyEnv honors caller overrides but size always wins', () => {
	const env = buildPtyEnv(
		{ inject: { TERM: 'screen-256color', COLUMNS: '999' } },
		{ cols: 80, rows: 24 },
	);
	expect(env.TERM).toBe('screen-256color');
	// COLUMNS/LINES are always set from the actual PTY size, after injects.
	expect(env.COLUMNS).toBe('80');
	expect(env.LINES).toBe('24');
});
