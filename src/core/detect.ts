/**
 * Runtime detection + lazy backend loading.
 *
 * The PTY backend is an OPTIONAL dependency resolved at runtime via dynamic
 * `import()`: `bun-pty` under Bun (tested), `node-pty` under Node (experimental).
 * Importing lazily means a Node consumer never builds `bun-pty` (rust/ffi) and a
 * Bun consumer never builds `node-pty`.
 */

import type {
	PtyBackend,
	PtyBackendName,
	PtyProcessHandle,
	PtySpawnOptions,
} from './backend.js';

/** Structural shape both `bun-pty` and `node-pty` PTY objects satisfy. */
interface RawPty {
	readonly pid: number;
	readonly cols: number;
	readonly rows: number;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	onData(listener: (data: string) => void): { dispose(): void };
	onExit(listener: (event: { exitCode: number; signal?: number | string }) => void): {
		dispose(): void;
	};
}

type RawSpawn = (file: string, args: string[], options: Record<string, unknown>) => RawPty;

/** True when running under Bun. */
export function isBun(): boolean {
	return (
		typeof (globalThis as any).Bun !== 'undefined' ||
		typeof (process as any)?.versions?.bun === 'string'
	);
}

/** The backend that auto-detect will pick for the current runtime. */
export function detectBackendName(): PtyBackendName {
	return isBun() ? 'bun-pty' : 'node-pty';
}

/** Wrap a backend's raw PTY into the normalized handle. */
function wrapPty(raw: RawPty): PtyProcessHandle {
	return {
		get pid() {
			return raw.pid;
		},
		get cols() {
			return raw.cols;
		},
		get rows() {
			return raw.rows;
		},
		write: (data) => raw.write(data),
		resize: (cols, rows) => raw.resize(cols, rows),
		kill: (signal) => raw.kill(signal),
		onData: (listener) => raw.onData(listener),
		onExit: (listener) => raw.onExit(listener),
	};
}

function makeBackend(name: PtyBackendName, spawn: RawSpawn): PtyBackend {
	return {
		name,
		experimental: name === 'node-pty',
		spawn(file, args, options: PtySpawnOptions): PtyProcessHandle {
			const raw = spawn(file, args, {
				name: options.name ?? 'xterm-256color',
				cols: options.cols,
				rows: options.rows,
				cwd: options.cwd,
				env: options.env,
			});
			return wrapPty(raw);
		},
	};
}

let cached: PtyBackend | null = null;

/**
 * Load the PTY backend for the current runtime (or a forced one).
 * The result is cached process-wide.
 */
export async function loadBackend(prefer?: PtyBackendName): Promise<PtyBackend> {
	if (cached && (!prefer || cached.name === prefer)) return cached;

	const name = prefer ?? detectBackendName();
	const moduleName = name; // 'bun-pty' | 'node-pty'

	let mod: any;
	try {
		mod = await import(/* @vite-ignore */ moduleName);
	} catch (err) {
		throw new Error(
			`ptykit: failed to load the "${moduleName}" PTY backend. Install it for this runtime ` +
				`(\`${isBun() ? 'bun add' : 'npm install'} ${moduleName}\`). Underlying error: ${
					err instanceof Error ? err.message : String(err)
				}`,
		);
	}

	const spawn: RawSpawn | undefined = mod?.spawn ?? mod?.default?.spawn;
	if (typeof spawn !== 'function') {
		throw new Error(`ptykit: "${moduleName}" did not export a spawn() function.`);
	}

	cached = makeBackend(name, spawn);
	return cached;
}

/** Reset the cached backend (used by tests). */
export function resetBackendCache(): void {
	cached = null;
}
