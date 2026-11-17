/**
 * A single PTY session: process handle + output pipeline + scrollback binding.
 *
 * Output pipeline (R5, R7a):
 *  1. Persist every chunk to the headless terminal FIRST — even with zero
 *     listeners — so scrollback stays accurate while clients are disconnected.
 *  2. Micro-task batch high-frequency output (`queueMicrotask`); with
 *     `outputCoalesceMs`, a sustained flood is further held to at most one
 *     flush per window while the first chunk after a quiet spell still goes
 *     out at once, so typing echo is never delayed.
 *  3. Stamp a monotonic `seq` per flush for client-side dedup.
 *  4. Fan out the batched chunk to every listener.
 *
 * Lifecycle: idle `\r` fallback after 350ms of silence (R18); kill ends the
 * shell and every process it started — Ctrl+C, then SIGHUP/SIGTERM, then
 * SIGKILL, a grace window apart — or all at once on a direct SIGKILL (R19).
 */

import type { PtyBackend, PtyDisposable, PtyExitEvent, PtyProcessHandle } from './backend.js';
import type { BufferStore } from './scrollback.js';
import { buildPtyEnv, type EnvOptions } from './env.js';
import { resolveShell } from './shell.js';
import { isAlive, killTreeWindows, signalAll } from './process-tree.js';
import { type Logger, silentLogger } from '../shared/index.js';

/** Output listener: receives a batched chunk and its monotonic sequence. */
export type SessionDataListener = (data: string, seq: number) => void;
/** Exit listener. */
export type SessionExitListener = (event: PtyExitEvent) => void;

export interface SessionConfig {
	sessionId: string;
	namespace: string;
	streamId: string;
	shell?: string;
	cwd: string;
	cols: number;
	rows: number;
	env?: EnvOptions;
	backend: PtyBackend;
	buffers: BufferStore;
	idleFallbackMs?: number;
	killGraceMs?: number;
	outputCoalesceMs?: number;
	logger?: Logger;
}

export interface SessionInfo {
	sessionId: string;
	namespace: string;
	streamId: string;
	pid: number;
	cwd: string;
	cols: number;
	rows: number;
	createdAt: Date;
	lastActivityAt: Date;
	status: 'active' | 'exited';
	exitCode?: number;
}

export class Session {
	readonly sessionId: string;
	readonly namespace: string;
	readonly streamId: string;
	readonly createdAt = new Date();

	cwd: string;
	cols: number;
	rows: number;
	lastActivityAt = new Date();
	status: 'active' | 'exited' = 'active';
	exitCode?: number;

	/** Monotonic sequence, incremented once per flushed batch (R5). */
	outputSeq = 0;

	private readonly handle: PtyProcessHandle;
	private readonly backend: PtyBackend;
	private readonly buffers: BufferStore;
	private readonly logger: Logger;
	private readonly killGraceMs: number;
	private readonly outputCoalesceMs: number;

	private readonly dataListeners = new Set<SessionDataListener>();
	private readonly exitListeners = new Set<SessionExitListener>();

	private pendingOutput = '';
	private flushScheduled = false;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private lastFlushAt = 0;
	private receivedInitialOutput = false;

	private readonly dataSub: PtyDisposable;
	private readonly exitSub: PtyDisposable;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(config: SessionConfig) {
		this.sessionId = config.sessionId;
		this.namespace = config.namespace;
		this.streamId = config.streamId;
		this.cwd = config.cwd;
		this.cols = config.cols;
		this.rows = config.rows;
		this.buffers = config.buffers;
		this.logger = config.logger ?? silentLogger;
		this.killGraceMs = config.killGraceMs ?? 1000;
		this.outputCoalesceMs = Math.max(0, config.outputCoalesceMs ?? 0);

		const { shell, args } = resolveShell(config.shell);
		const env = buildPtyEnv(config.env, { cols: this.cols, rows: this.rows });

		this.backend = config.backend;
		this.handle = config.backend.spawn(shell, args, {
			name: 'xterm-256color',
			cols: this.cols,
			rows: this.rows,
			cwd: this.cwd,
			env,
		});

		// Allocate scrollback up front so persist-first always has a target.
		this.buffers.create(this.sessionId, this.cols, this.rows);

		this.dataSub = this.handle.onData((data) => this.onData(data));
		this.exitSub = this.handle.onExit((event) => this.onExit(event));

		// Some shells do not paint the first prompt until they receive input.
		// Only nudge if the PTY stayed completely silent after spawn; otherwise
		// it duplicates the initial prompt on normal shells (R18).
		const idleFallbackMs = config.idleFallbackMs ?? 350;
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			if (this.receivedInitialOutput || this.status === 'exited') return;
			try {
				this.handle.write('\r');
			} catch (err) {
				this.logger.error('session', 'idle fallback write failed', err);
			}
		}, idleFallbackMs);
	}

	get pid(): number {
		return this.handle.pid;
	}

	info(): SessionInfo {
		return {
			sessionId: this.sessionId,
			namespace: this.namespace,
			streamId: this.streamId,
			pid: this.pid,
			cwd: this.cwd,
			cols: this.cols,
			rows: this.rows,
			createdAt: this.createdAt,
			lastActivityAt: this.lastActivityAt,
			status: this.status,
			exitCode: this.exitCode,
		};
	}

	private onData(data: string): void {
		this.receivedInitialOutput = true;
		this.lastActivityAt = new Date();

		// Persist FIRST, even with zero listeners (R7a).
		this.buffers.write(this.sessionId, data);

		// Micro-task batch high-frequency output (R5).
		this.pendingOutput += data;
		if (this.flushScheduled) return;
		this.flushScheduled = true;

		// Coalescing only ever delays a flush that follows another one within the
		// window; the first chunk after a quiet spell goes out on the micro-task.
		const wait =
			this.outputCoalesceMs > 0
				? this.lastFlushAt + this.outputCoalesceMs - Date.now()
				: 0;
		if (wait > 0) {
			this.flushTimer = setTimeout(() => this.flushOutput(), wait);
		} else {
			queueMicrotask(() => this.flushOutput());
		}
	}

	/** Hand the pending batch to every listener under one new `seq`. */
	private flushOutput(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (!this.flushScheduled) return;
		const output = this.pendingOutput;
		this.pendingOutput = '';
		this.flushScheduled = false;
		this.lastFlushAt = Date.now();
		this.outputSeq++;
		const seq = this.outputSeq;
		for (const listener of this.dataListeners) {
			try {
				listener(output, seq);
			} catch (err) {
				this.logger.error('session', 'data listener error', err);
			}
		}
	}

	private onExit(event: PtyExitEvent): void {
		// Output still held by coalescing belongs before the exit, not after it.
		this.flushOutput();
		this.status = 'exited';
		this.exitCode = event.exitCode;
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		for (const listener of this.exitListeners) {
			try {
				listener(event);
			} catch (err) {
				this.logger.error('session', 'exit listener error', err);
			}
		}
	}

	// ---- Listener management (R7c: callers clear before reattaching) --------

	addDataListener(listener: SessionDataListener): void {
		this.dataListeners.add(listener);
	}
	removeDataListener(listener: SessionDataListener): void {
		this.dataListeners.delete(listener);
	}
	addExitListener(listener: SessionExitListener): void {
		this.exitListeners.add(listener);
	}
	removeExitListener(listener: SessionExitListener): void {
		this.exitListeners.delete(listener);
	}
	/** Clear ALL listeners — call before attaching fresh ones to avoid double output (R7c). */
	clearListeners(): void {
		this.dataListeners.clear();
		this.exitListeners.clear();
	}
	get dataListenerCount(): number {
		return this.dataListeners.size;
	}

	// ---- I/O ----------------------------------------------------------------

	write(data: string): boolean {
		if (this.status === 'exited') return false;
		try {
			this.handle.write(data);
			this.lastActivityAt = new Date();
			return true;
		} catch (err) {
			this.logger.error('session', `write to ${this.sessionId} failed`, err);
			return false;
		}
	}

	resize(cols: number, rows: number): boolean {
		if (this.status === 'exited') return false;
		try {
			this.handle.resize(cols, rows);
			this.cols = cols;
			this.rows = rows;
			// Keep scrollback in sync with PTY dimensions (R15).
			this.buffers.resize(this.sessionId, cols, rows);
			return true;
		} catch (err) {
			this.logger.error('session', `resize of ${this.sessionId} failed`, err);
			return false;
		}
	}

	/** Send Ctrl+C (R19). */
	cancel(): void {
		if (this.status === 'exited') return;
		try {
			this.handle.write('\x03');
		} catch (err) {
			this.logger.error('session', `cancel of ${this.sessionId} failed`, err);
		}
	}

	/** Set once a kill started; a later kill may only escalate to SIGKILL. */
	private killing = false;

	/**
	 * End the session's shell AND everything it started (R19).
	 *
	 * - No signal (a tab closed): Ctrl+C so the foreground job can stop itself;
	 *   after the grace window SIGHUP to the shell — the signal a closed
	 *   terminal sends — and SIGTERM to the rest; after another, SIGKILL to
	 *   whatever is left.
	 * - `SIGTERM`: SIGTERM to all now, SIGKILL to what is left after the grace.
	 * - `SIGKILL`: all at once.
	 *
	 * The tree is collected first (see process-tree.ts): background jobs,
	 * `setsid()` children and SIGHUP-ignoring programs used to outlive the tab.
	 * The sequence runs on its own timers so the caller may dispose the session
	 * right away — `killSession` does, and that used to cancel the pending
	 * SIGKILL so even the shell survived a closed tab.
	 */
	kill(signal?: string): void {
		const force = signal === 'SIGKILL' || signal === '9';
		if (this.killing && !force) return;
		this.killing = true;
		try {
			terminate({
				handle: this.handle,
				tree: this.backend.collectProcessTree?.(this.handle.pid) ?? [],
				mode: force ? 'kill' : signal === 'SIGTERM' || signal === '15' ? 'term' : 'close',
				graceMs: this.killGraceMs,
			});
		} catch (err) {
			this.logger.error('session', `kill of ${this.sessionId} failed`, err);
		}
	}

	serialize(): string {
		return this.buffers.serialize(this.sessionId);
	}

	clearScreen(): void {
		this.buffers.clear(this.sessionId);
	}

	bufferLength(): number {
		return this.buffers.length(this.sessionId);
	}

	/** Tear down PTY subscriptions and timers. Does NOT dispose scrollback. */
	dispose(): void {
		try {
			this.dataSub.dispose();
		} catch {
			/* ignore */
		}
		try {
			this.exitSub.dispose();
		} catch {
			/* ignore */
		}
		if (this.idleTimer) clearTimeout(this.idleTimer);
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushTimer = null;
		this.idleTimer = null;
		this.clearListeners();
	}
}

interface TerminateOptions {
	handle: PtyProcessHandle;
	/** The shell's processes, collected before anything was signalled. */
	tree: number[];
	mode: 'close' | 'term' | 'kill';
	graceMs: number;
}

/**
 * Run a session's kill sequence. Deliberately not tied to the Session: its
 * timers must outlive `dispose()`, and once disposed the session no longer
 * hears its own exit — so liveness is read from the processes themselves.
 */
function terminate({ handle, tree, mode, graceMs }: TerminateOptions): void {
	const shellPid = handle.pid;
	// Our own exit subscription: the session's goes away with dispose().
	let shellExited = false;
	let exitSub: PtyDisposable | null = null;
	try {
		exitSub = handle.onExit(() => {
			shellExited = true;
		});
	} catch {
		/* backend without exit events: fall back to signalling unconditionally */
	}
	const done = () => {
		try {
			exitSub?.dispose();
		} catch {
			/* ignore */
		}
	};
	const signalShell = (signal: string) => {
		try {
			handle.kill(signal);
		} catch {
			// Already gone.
		}
	};
	const later = (step: () => void) => {
		const timer = setTimeout(step, graceMs);
		(timer as { unref?: () => void }).unref?.();
	};

	if (process.platform === 'win32') {
		done();
		if (mode === 'kill') {
			killTreeWindows(shellPid);
			return;
		}
		if (mode === 'close') {
			try {
				handle.write('\x03');
			} catch {
				/* closed */
			}
		}
		later(() => killTreeWindows(shellPid));
		return;
	}

	const finish = () => {
		if (!shellExited) signalShell('SIGKILL');
		signalAll(tree.filter(isAlive), 'SIGKILL');
		done();
	};

	if (mode === 'kill') {
		signalShell('SIGKILL');
		signalAll(tree, 'SIGKILL');
		done();
		return;
	}

	if (mode === 'term') {
		signalShell('SIGTERM');
		signalAll(tree, 'SIGTERM');
		later(finish);
		return;
	}

	try {
		handle.write('\x03');
	} catch {
		/* closed */
	}
	later(() => {
		if (!shellExited) signalShell('SIGHUP');
		signalAll(tree.filter(isAlive), 'SIGTERM');
		later(finish);
	});
}
