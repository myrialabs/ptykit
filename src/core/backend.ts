/**
 * PTY backend abstraction.
 *
 * Both supported backends — `bun-pty` (tested) and `node-pty` (experimental) —
 * expose a near-identical `IPty` surface (`spawn(file, args, opts) → handle`
 * with `onData`/`onExit`/`write`/`resize`/`kill`/`pid`/`cols`/`rows`). This
 * interface is the thin common shape the rest of the core depends on, so the
 * session engine never imports a backend directly.
 */

/** A disposable event subscription. */
export interface PtyDisposable {
	dispose(): void;
}

/** PTY process exit event. */
export interface PtyExitEvent {
	exitCode: number;
	signal?: number | string;
}

/** Options for spawning a PTY. */
export interface PtySpawnOptions {
	/** Terminal name set in the child env. Defaults to `xterm-256color`. */
	name?: string;
	cols: number;
	rows: number;
	cwd: string;
	env: Record<string, string>;
}

/** A live PTY process handle, normalized across backends. */
export interface PtyProcessHandle {
	readonly pid: number;
	readonly cols: number;
	readonly rows: number;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	onData(listener: (data: string) => void): PtyDisposable;
	onExit(listener: (event: PtyExitEvent) => void): PtyDisposable;
}

/** Backend identifier. */
export type PtyBackendName = 'bun-pty' | 'node-pty';

/** A PTY backend: spawns processes and reports its support status. */
export interface PtyBackend {
	readonly name: PtyBackendName;
	/**
	 * `true` while the backend has not yet been gated to "supported" by the
	 * scale and auto-detect benchmarks. `node-pty` is experimental; `bun-pty` is
	 * the tested path.
	 */
	readonly experimental: boolean;
	spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcessHandle;
}
