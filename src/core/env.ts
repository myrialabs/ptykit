/**
 * Environment hygiene (R2).
 *
 * Spawning a shell from inside a Bun/npm/Vite process leaks the runtime's own
 * pollution into the child (npm_*, VITE_*, a `node_modules/.bin` PATH, etc.),
 * which breaks version managers and confuses interactive shells. We strip that
 * pollution, then inject the terminal-friendly variables xterm.js expects.
 */

/** Env hygiene configuration. */
export interface EnvOptions {
	/** Strip Bun/npm/Vite runtime pollution from `process.env`. Default `true`. */
	sanitize?: boolean;
	/**
	 * Variables injected/overridden after sanitizing. Merged over the terminal
	 * defaults (`FORCE_COLOR`, `COLORTERM`, `TERM`, `TERM_PROGRAM`, `CLICOLOR`,
	 * `LC_ALL`, `LANG`). `COLUMNS`/`LINES` are always set from the PTY size.
	 */
	inject?: Record<string, string>;
}

/** Env-var name prefixes always injected by Bun/npm/Vite. */
const FILTERED_PREFIXES = ['npm_', 'VITE_'];

/** Specific var names injected by the runtime. */
const FILTERED_NAMES = new Set(['_BUN_WATCHER_CHILD']);

/** Remove `node_modules/.bin`-style entries from PATH. */
function cleanPath(env: Record<string, string>): void {
	const isWindows = process.platform === 'win32';
	const pathKey = isWindows ? (env.Path !== undefined ? 'Path' : 'PATH') : 'PATH';
	const value = env[pathKey];
	if (value) {
		const sep = isWindows ? ';' : ':';
		env[pathKey] = value
			.split(sep)
			.filter((p) => !p.includes('node_modules'))
			.join(sep);
	}
}

/** Build a clean copy of `process.env` for spawning a child shell. */
export function getCleanSpawnEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (FILTERED_NAMES.has(key)) continue;
		if (FILTERED_PREFIXES.some((p) => key.startsWith(p))) continue;
		env[key] = value;
	}
	cleanPath(env);
	return env;
}

/**
 * Produce the environment for a PTY: sanitized base (optional) plus the
 * terminal-specific variables xterm.js relies on, with caller overrides last.
 */
export function buildPtyEnv(
	options: EnvOptions | undefined,
	size: { cols: number; rows: number },
): Record<string, string> {
	const sanitize = options?.sanitize ?? true;
	const base = sanitize
		? getCleanSpawnEnv()
		: ({ ...process.env } as Record<string, string>);

	const terminalDefaults: Record<string, string> = {
		FORCE_COLOR: '1',
		COLORTERM: 'truecolor',
		TERM: 'xterm-256color',
		TERM_PROGRAM: 'xterm.js',
		CLICOLOR: '1',
		LC_ALL: 'en_US.UTF-8',
		LANG: 'en_US.UTF-8',
	};

	return {
		...base,
		...terminalDefaults,
		...(options?.inject ?? {}),
		// Size always reflects the actual PTY dimensions, regardless of injects.
		COLUMNS: String(size.cols),
		LINES: String(size.rows),
	};
}
