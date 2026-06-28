/**
 * A single PTY session: process handle + output pipeline + scrollback binding.
 *
 * Output pipeline (R5, R7a):
 *  1. Persist every chunk to the headless terminal FIRST — even with zero
 *     listeners — so scrollback stays accurate while clients are disconnected.
 *  2. Micro-task batch high-frequency output (`queueMicrotask`).
 *  3. Stamp a monotonic `seq` per flush for client-side dedup.
 *  4. Fan out the batched chunk to every listener.
 *
 * Lifecycle: idle `\r` fallback after 350ms of silence (R18); kill = Ctrl+C
 * then SIGKILL after 1s, or a direct signal (R19).
 */

import type { PtyBackend, PtyDisposable, PtyExitEvent, PtyProcessHandle } from './backend.js';
import type { BufferStore } from './scrollback.js';
import { buildPtyEnv, type EnvOptions } from './env.js';
import { resolveShell } from './shell.js';
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
	private readonly buffers: BufferStore;
	private readonly logger: Logger;
	private readonly killGraceMs: number;

	private readonly dataListeners = new Set<SessionDataListener>();
	private readonly exitListeners = new Set<SessionExitListener>();

	private pendingOutput = '';
	private flushScheduled = false;
	private receivedInitialOutput = false;

	private readonly dataSub: PtyDisposable;
	private readonly exitSub: PtyDisposable;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private killTimer: ReturnType<typeof setTimeout> | null = null;

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

		const { shell, args } = resolveShell(config.shell);
		const env = buildPtyEnv(config.env, { cols: this.cols, rows: this.rows });

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
		queueMicrotask(() => {
			const output = this.pendingOutput;
			this.pendingOutput = '';
			this.flushScheduled = false;
			this.outputSeq++;
			const seq = this.outputSeq;
			for (const listener of this.dataListeners) {
				try {
					listener(output, seq);
				} catch (err) {
					this.logger.error('session', 'data listener error', err);
				}
			}
		});
	}

	private onExit(event: PtyExitEvent): void {
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

	/** Kill: Ctrl+C then SIGKILL after the grace window, or a direct signal (R19). */
	kill(signal?: string): void {
		try {
			if (signal === 'SIGKILL' || signal === '9') {
				this.handle.kill('SIGKILL');
				return;
			}
			if (signal === 'SIGTERM' || signal === '15') {
				this.handle.kill('SIGTERM');
				return;
			}
			this.handle.write('\x03');
			this.killTimer = setTimeout(() => {
				this.killTimer = null;
				if (this.status === 'exited') return;
				try {
					this.handle.kill('SIGKILL');
				} catch {
					// already dead
				}
			}, this.killGraceMs);
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
		if (this.killTimer) clearTimeout(this.killTimer);
		this.idleTimer = null;
		this.killTimer = null;
		this.clearListeners();
	}
}
