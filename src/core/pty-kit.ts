/**
 * `PtyKitManager` — the session manager.
 *
 * Owns `Map<sessionId, Session>`, the auto-detected backend, the scrollback
 * store, and session lifecycle: idempotent create (R3), no idle TTL by default
 * (R4), retain-exited window for reconnect (R8). It is transport-agnostic — the
 * WebSocket server wraps it.
 */

import type { PtyBackend, PtyBackendName } from './backend.js';
import { loadBackend } from './detect.js';
import type { EnvOptions } from './env.js';
import { MemoryBufferStore, type BufferStore } from './scrollback.js';
import { Session } from './session.js';
import { resolveCwd } from './shell.js';
import { type Logger, silentLogger } from '../shared/index.js';

export interface PtyKitManagerOptions {
	/** Environment hygiene (R2). */
	env?: EnvOptions;
	/** Headless scrollback lines (R6). Default 5000. */
	scrollback?: number;
	/** Scrollback strategy. Only `memory` ships in v1; inject a custom `store` to extend. */
	buffer?: { strategy?: 'memory'; store?: BufferStore };
	/** Auto-kill sessions idle longer than this (ms). Default `null` = never (R4). */
	idleTtl?: number | null;
	/** Keep exited sessions this long for reconnect replay (ms). Default 5 min (R8). `null` = forever. */
	retainExitedMs?: number | null;
	/** Idle `\r` fallback delay after spawn (ms). Default 350 (R18). */
	idleFallbackMs?: number;
	/** Grace before SIGKILL after Ctrl+C on `kill` (ms). Default 1000 (R19). */
	killGraceMs?: number;
	/** Inject a backend (tests / forcing a specific one). */
	backend?: PtyBackend;
	/** Force the auto-detect choice. */
	preferBackend?: PtyBackendName;
	/** Diagnostics sink. Off by default — the core stays silent. */
	logger?: Logger;
}

export interface CreateSessionOptions {
	sessionId: string;
	namespace: string;
	streamId?: string;
	shell?: string;
	cwd?: string;
	cols?: number;
	rows?: number;
}

const DEFAULT_RETAIN_EXITED_MS = 5 * 60_000;

export class PtyKitManager {
	private readonly sessions = new Map<string, Session>();
	private readonly buffers: BufferStore;
	private readonly options: PtyKitManagerOptions;
	private readonly logger: Logger;
	private readonly retainExitedMs: number | null;
	private readonly idleTtl: number | null;

	private backend: PtyBackend | null;
	private readonly removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private idleSweeper: ReturnType<typeof setInterval> | null = null;
	private disposed = false;

	constructor(options: PtyKitManagerOptions = {}) {
		this.options = options;
		this.logger = options.logger ?? silentLogger;
		this.backend = options.backend ?? null;
		this.retainExitedMs =
			options.retainExitedMs === undefined ? DEFAULT_RETAIN_EXITED_MS : options.retainExitedMs;
		this.idleTtl = options.idleTtl ?? null;
		this.buffers = options.buffer?.store ?? new MemoryBufferStore(options.scrollback ?? 5000);

		if (this.idleTtl !== null && this.idleTtl > 0) {
			this.idleSweeper = setInterval(() => this.sweepIdle(), Math.min(this.idleTtl, 30_000));
			// Don't keep the process alive solely for the sweeper.
			(this.idleSweeper as any)?.unref?.();
		}
	}

	/** The active backend, once resolved. `null` until the first `createSession`. */
	get activeBackend(): PtyBackend | null {
		return this.backend;
	}

	private async resolveBackend(): Promise<PtyBackend> {
		if (!this.backend) {
			this.backend = await loadBackend(this.options.preferBackend);
		}
		return this.backend;
	}

	/**
	 * Create a session, or reuse an existing active one with the same id (R3).
	 * If a retained-exited session holds the id, it is discarded and replaced.
	 * Throws if the id is held by a different namespace (anti-hijack defense).
	 */
	async createSession(opts: CreateSessionOptions): Promise<Session> {
		if (this.disposed) throw new Error('PtyKitManager has been disposed');

		const existing = this.sessions.get(opts.sessionId);
		if (existing) {
			if (existing.namespace !== opts.namespace) {
				throw new Error('Access denied');
			}
			if (existing.status === 'active') {
				existing.lastActivityAt = new Date();
				return existing;
			}
			// Exited remnant — drop it and spawn fresh under the same id.
			this.remove(opts.sessionId);
		}

		const backend = await this.resolveBackend();
		const cwd = resolveCwd(opts.cwd);
		const cols = opts.cols ?? 80;
		const rows = opts.rows ?? 24;
		const streamId = opts.streamId ?? `${opts.sessionId}-stream`;

		const session = new Session({
			sessionId: opts.sessionId,
			namespace: opts.namespace,
			streamId,
			shell: opts.shell,
			cwd,
			cols,
			rows,
			env: this.options.env,
			backend,
			buffers: this.buffers,
			idleFallbackMs: this.options.idleFallbackMs,
			killGraceMs: this.options.killGraceMs,
			logger: this.logger,
		});

		// Schedule retain-then-remove when the process exits on its own (R8).
		session.addExitListener(() => this.scheduleRemoval(opts.sessionId));

		this.sessions.set(opts.sessionId, session);
		return session;
	}

	getSession(sessionId: string): Session | undefined {
		return this.sessions.get(sessionId);
	}

	/** All sessions in a namespace. */
	list(namespace: string): Session[] {
		return [...this.sessions.values()].filter((s) => s.namespace === namespace);
	}

	write(sessionId: string, data: string): boolean {
		return this.sessions.get(sessionId)?.write(data) ?? false;
	}

	resize(sessionId: string, cols: number, rows: number): boolean {
		return this.sessions.get(sessionId)?.resize(cols, rows) ?? false;
	}

	cancel(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		session.cancel();
		return true;
	}

	clear(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		session.clearScreen();
		return true;
	}

	/** Serialized scrollback frame, ready to replay to a client (R6/R7). */
	getSerializedState(sessionId: string): string {
		return this.sessions.get(sessionId)?.serialize() ?? '';
	}

	/**
	 * Kill a session and remove it immediately (no retain window — the caller
	 * asked for it gone). Returns false if no such session.
	 */
	killSession(sessionId: string, signal?: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		session.kill(signal);
		this.remove(sessionId);
		return true;
	}

	private scheduleRemoval(sessionId: string): void {
		if (this.retainExitedMs === null) return; // keep forever until killed/disposed
		if (this.removalTimers.has(sessionId)) return;
		const timer = setTimeout(() => {
			this.removalTimers.delete(sessionId);
			this.remove(sessionId);
		}, this.retainExitedMs);
		(timer as any)?.unref?.();
		this.removalTimers.set(sessionId, timer);
	}

	private sweepIdle(): void {
		if (this.idleTtl === null) return;
		const cutoff = Date.now() - this.idleTtl;
		for (const session of this.sessions.values()) {
			if (session.status === 'active' && session.lastActivityAt.getTime() < cutoff) {
				this.killSession(session.sessionId, 'SIGKILL');
			}
		}
	}

	/** Fully remove a session: dispose PTY subscriptions, timers, and scrollback. */
	private remove(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.dispose();
		this.buffers.dispose(sessionId);
		this.sessions.delete(sessionId);
		const timer = this.removalTimers.get(sessionId);
		if (timer) {
			clearTimeout(timer);
			this.removalTimers.delete(sessionId);
		}
	}

	/** Kill and remove every session. */
	dispose(): void {
		this.disposed = true;
		if (this.idleSweeper) {
			clearInterval(this.idleSweeper);
			this.idleSweeper = null;
		}
		for (const sessionId of [...this.sessions.keys()]) {
			this.sessions.get(sessionId)?.kill('SIGKILL');
			this.remove(sessionId);
		}
	}
}
