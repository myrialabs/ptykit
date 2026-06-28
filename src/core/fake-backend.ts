/**
 * Test-only fakes for the core engine. Excluded from the published build
 * (see `tsconfig.json`), transpiled by `bun test`, linted by ESLint.
 */

import type {
	PtyBackend,
	PtyBackendName,
	PtyDisposable,
	PtyExitEvent,
	PtyProcessHandle,
	PtySpawnOptions,
} from './backend.js';
import type { BufferStore } from './scrollback.js';

/** A controllable PTY handle: records I/O, lets a test drive data/exit. */
export class FakeHandle implements PtyProcessHandle {
	pid = 4242;
	cols: number;
	rows: number;
	readonly writes: string[] = [];
	readonly kills: Array<string | undefined> = [];
	readonly resizes: Array<[number, number]> = [];
	readonly spawnFile: string;
	readonly spawnArgs: string[];
	readonly spawnOptions: PtySpawnOptions;

	private readonly dataListeners = new Set<(d: string) => void>();
	private readonly exitListeners = new Set<(e: PtyExitEvent) => void>();

	constructor(file: string, args: string[], options: PtySpawnOptions) {
		this.spawnFile = file;
		this.spawnArgs = args;
		this.spawnOptions = options;
		this.cols = options.cols;
		this.rows = options.rows;
	}

	write(data: string): void {
		this.writes.push(data);
	}
	resize(cols: number, rows: number): void {
		this.resizes.push([cols, rows]);
		this.cols = cols;
		this.rows = rows;
	}
	kill(signal?: string): void {
		this.kills.push(signal);
	}
	onData(listener: (d: string) => void): PtyDisposable {
		this.dataListeners.add(listener);
		return { dispose: () => this.dataListeners.delete(listener) };
	}
	onExit(listener: (e: PtyExitEvent) => void): PtyDisposable {
		this.exitListeners.add(listener);
		return { dispose: () => this.exitListeners.delete(listener) };
	}

	/** Drive output from the fake PTY. */
	emitData(data: string): void {
		for (const l of this.dataListeners) l(data);
	}
	/** Drive process exit. */
	emitExit(exitCode = 0, signal?: number | string): void {
		for (const l of this.exitListeners) l({ exitCode, signal });
	}
}

/** A backend that hands out `FakeHandle`s and records every spawn. */
export class FakeBackend implements PtyBackend {
	readonly name: PtyBackendName;
	readonly experimental: boolean;
	readonly handles: FakeHandle[] = [];

	constructor(name: PtyBackendName = 'bun-pty', experimental = false) {
		this.name = name;
		this.experimental = experimental;
	}

	spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcessHandle {
		const handle = new FakeHandle(file, args, options);
		this.handles.push(handle);
		return handle;
	}

	/** The most recently spawned handle. */
	get last(): FakeHandle {
		return this.handles[this.handles.length - 1]!;
	}
}

/** A scrollback store that records calls (and keeps a simple concatenation). */
export class SpyBufferStore implements BufferStore {
	readonly writes: Array<[string, string]> = [];
	readonly created: string[] = [];
	readonly disposed: string[] = [];
	readonly cleared: string[] = [];
	readonly resizes: Array<[string, number, number]> = [];
	private readonly content = new Map<string, string>();

	create(sessionId: string): void {
		this.created.push(sessionId);
		if (!this.content.has(sessionId)) this.content.set(sessionId, '');
	}
	write(sessionId: string, data: string): void {
		this.writes.push([sessionId, data]);
		this.content.set(sessionId, (this.content.get(sessionId) ?? '') + data);
	}
	serialize(sessionId: string): string {
		return this.content.get(sessionId) ?? '';
	}
	clear(sessionId: string): void {
		this.cleared.push(sessionId);
		this.content.set(sessionId, '');
	}
	resize(sessionId: string, cols: number, rows: number): void {
		this.resizes.push([sessionId, cols, rows]);
	}
	length(sessionId: string): number {
		return (this.content.get(sessionId) ?? '').length;
	}
	dispose(sessionId: string): void {
		this.disposed.push(sessionId);
		this.content.delete(sessionId);
	}
}

/** Await pending micro-tasks so a batched flush has run. */
export async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
