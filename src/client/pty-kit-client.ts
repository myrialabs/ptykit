/**
 * `PtyKitClient` — the browser client.
 *
 * One `WsCore` socket multiplexes every session in a namespace. Server output
 * broadcasts to the room; this client filters by `sessionId` and dedups by
 * `seq` (R5). Replayed frames (no `seq`) are passed through `stripReportRequests`
 * so the terminal does not answer color/cursor queries into an idle prompt (R17).
 *
 * Reconnect is ON by default; on reconnect every known session is re-attached
 * (idempotent `create-session`) so the room subscription and scrollback recover
 * (R7/R14).
 */

import { stripReportRequests, type Seq } from '../shared/index.js';
import {
	WsCore,
	type ReconnectOptions,
	type WSStatus,
	type WebSocketFactory,
} from './ws-core.js';
import { defaultPersistence, type SessionPersistence } from './persistence.js';

export interface PtyKitClientOptions {
	/**
	 * WebSocket URL to open. Optional (and ignored) when a `WebSocketImpl` rides an
	 * existing host connection — e.g. `hostSocket(...)` for embedded transports.
	 */
	url?: string;
	/** Default namespace for `create`/`attach` when not passed explicitly. */
	namespace?: string;
	reconnect?: ReconnectOptions;
	persistence?: SessionPersistence;
	/**
	 * Injectable WebSocket constructor (defaults to global `WebSocket`). Pass
	 * `hostSocket(...)` to tunnel over a socket your app already owns.
	 */
	WebSocketImpl?: WebSocketFactory;
	requestTimeoutMs?: number;
}

export interface OpenOptions {
	sessionId?: string;
	namespace?: string;
	cwd?: string;
	cols?: number;
	rows?: number;
	shell?: string;
}

interface CreateRequest {
	sessionId: string;
	namespace: string;
	cwd?: string;
	cols?: number;
	rows?: number;
	shell?: string;
}

type DataCb = (chunk: string) => void;
type ExitCb = (exitCode: number) => void;
type DirCb = (directory: string) => void;
type ErrCb = (error: string) => void;

/** A handle to one PTY session over the shared socket. */
export class ClientSession {
	readonly sessionId: string;
	readonly namespace: string;
	/** @internal — the request used to (re)attach on reconnect. */
	readonly createRequest: CreateRequest;

	private lastSeq: Seq = 0;
	/** Output that arrived before the first `onData` listener (e.g. reattach replay). */
	private pending: string[] = [];
	private pendingBytes = 0;
	private static readonly PENDING_CAP = 1_000_000; // 1MB backlog ceiling
	private readonly dataCbs = new Set<DataCb>();
	private readonly exitCbs = new Set<ExitCb>();
	private readonly dirCbs = new Set<DirCb>();
	private readonly errCbs = new Set<ErrCb>();

	constructor(
		private readonly client: PtyKitClient,
		request: CreateRequest,
	) {
		this.sessionId = request.sessionId;
		this.namespace = request.namespace;
		this.createRequest = request;
	}

	/** Subscribe to terminal output (deduped by seq; replay frames stripped). */
	onData(cb: DataCb): () => void {
		this.dataCbs.add(cb);
		// Flush output that arrived before any listener (the reattach replay
		// frame is unicast during `attach`, before the caller subscribes).
		if (this.pending.length) {
			const buffered = this.pending;
			this.pending = [];
			this.pendingBytes = 0;
			for (const chunk of buffered) cb(chunk);
		}
		return () => this.dataCbs.delete(cb);
	}
	onExit(cb: ExitCb): () => void {
		this.exitCbs.add(cb);
		return () => this.exitCbs.delete(cb);
	}
	onDirectory(cb: DirCb): () => void {
		this.dirCbs.add(cb);
		return () => this.dirCbs.delete(cb);
	}
	onError(cb: ErrCb): () => void {
		this.errCbs.add(cb);
		return () => this.errCbs.delete(cb);
	}

	/** @internal Route an output event for this session. */
	_handleOutput(content: string, seq?: Seq): void {
		let deliver: string;
		if (seq === undefined) {
			// Replay frame — strip report-requests so xterm doesn't answer into the
			// idle prompt (R17). No seq tracking; replay is a full screen frame.
			deliver = stripReportRequests(content);
		} else {
			if (seq <= this.lastSeq) return; // dedup live output (R5)
			this.lastSeq = seq;
			deliver = content;
		}
		if (this.dataCbs.size === 0) {
			this.pending.push(deliver);
			this.pendingBytes += deliver.length;
			while (this.pendingBytes > ClientSession.PENDING_CAP && this.pending.length > 1) {
				this.pendingBytes -= this.pending.shift()!.length;
			}
			return;
		}
		for (const cb of this.dataCbs) cb(deliver);
	}
	/** @internal */
	_handleExit(exitCode: number): void {
		for (const cb of this.exitCbs) cb(exitCode);
	}
	/** @internal */
	_handleDirectory(directory: string): void {
		for (const cb of this.dirCbs) cb(directory);
	}
	/** @internal */
	_handleError(error: string): void {
		for (const cb of this.errCbs) cb(error);
	}

	/** Send raw keystrokes (fire-and-forget pass-through, R16). */
	write(data: string): void {
		this.client._emitInput(this.sessionId, data);
	}
	resize(cols: number, rows: number): Promise<void> {
		return this.client._resize(this.sessionId, cols, rows);
	}
	cancel(): Promise<void> {
		return this.client._cancel(this.sessionId);
	}
	clear(): Promise<void> {
		return this.client._clear(this.sessionId);
	}
	/** Kill the session on the server. */
	kill(): Promise<void> {
		return this.client._kill(this.sessionId);
	}
	/** Stop receiving locally; does NOT kill the server-side session. */
	detach(): void {
		this.dataCbs.clear();
		this.exitCbs.clear();
		this.dirCbs.clear();
		this.errCbs.clear();
		this.client._forget(this.sessionId);
	}
}

export class PtyKitClient {
	private readonly core: WsCore;
	private readonly persistence: SessionPersistence;
	private readonly defaultNamespace?: string;
	private readonly sessions = new Map<string, ClientSession>();

	private status: WSStatus = 'reconnecting';
	private readonly statusCbs = new Set<(s: WSStatus) => void>();

	constructor(options: PtyKitClientOptions) {
		this.persistence = options.persistence ?? defaultPersistence();
		this.defaultNamespace = options.namespace;
		this.core = new WsCore({
			url: options.url ?? '',
			reconnect: options.reconnect,
			WebSocketImpl: options.WebSocketImpl,
			requestTimeoutMs: options.requestTimeoutMs,
			onStatus: (s) => {
				this.status = s;
				for (const cb of this.statusCbs) cb(s);
			},
			onReconnect: () => this.reattachAll(),
		});

		// Route broadcast events to the matching session.
		this.core.on('output', (p: any) => this.sessions.get(p?.sessionId)?._handleOutput(p.content, p.seq));
		this.core.on('exit', (p: any) => this.sessions.get(p?.sessionId)?._handleExit(p.exitCode));
		this.core.on('directory', (p: any) =>
			this.sessions.get(p?.sessionId)?._handleDirectory(p.newDirectory),
		);
		this.core.on('error', (p: any) => this.sessions.get(p?.sessionId)?._handleError(p.error));
	}

	/** Subscribe to connection status. Fires immediately with the current value. */
	onStatus(cb: (status: WSStatus) => void): () => void {
		this.statusCbs.add(cb);
		cb(this.status);
		return () => this.statusCbs.delete(cb);
	}

	connected(): boolean {
		return this.core.connected();
	}

	private resolveNamespace(ns?: string): string {
		const namespace = ns ?? this.defaultNamespace;
		if (!namespace) throw new Error('ptykit: a namespace is required (set it on the client or the call)');
		return namespace;
	}

	private generateId(namespace: string): string {
		return `${namespace}-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	/** Create a new session (or attach if the id already exists — server is idempotent). */
	async create(options: OpenOptions = {}): Promise<ClientSession> {
		const namespace = this.resolveNamespace(options.namespace);
		const sessionId = options.sessionId ?? this.generateId(namespace);
		this.persistence.save(namespace, sessionId);
		return this.open({ sessionId, namespace, cwd: options.cwd, cols: options.cols, rows: options.rows, shell: options.shell });
	}

	/** Attach to an existing session (replays serialized scrollback). */
	async attach(sessionId?: string, options: OpenOptions = {}): Promise<ClientSession> {
		const namespace = this.resolveNamespace(options.namespace);
		const id = sessionId ?? this.persistence.load(namespace);
		if (!id) throw new Error('ptykit: no sessionId provided and none persisted for this namespace');
		this.persistence.save(namespace, id);
		return this.open({ sessionId: id, namespace, cwd: options.cwd, cols: options.cols, rows: options.rows, shell: options.shell });
	}

	private async open(request: CreateRequest): Promise<ClientSession> {
		let session = this.sessions.get(request.sessionId);
		if (!session) {
			session = new ClientSession(this, request);
			this.sessions.set(request.sessionId, session);
		}
		// Listener is registered (above) before the request is sent, so the replay
		// frame the server unicasts is captured by this session.
		await this.core.http('create-session', request);
		return session;
	}

	private reattachAll(): void {
		for (const session of this.sessions.values()) {
			this.core.http('create-session', session.createRequest).catch(() => {
				/* best-effort re-attach; next user action will retry */
			});
		}
	}

	/** List sessions a namespace currently has on the server. */
	listSessions(namespace?: string) {
		return this.core.http('list-sessions', { namespace: this.resolveNamespace(namespace) });
	}

	disconnect(): void {
		this.core.disconnect();
	}

	// ---- internal session plumbing -----------------------------------------

	/** @internal */
	_emitInput(sessionId: string, data: string): void {
		this.core.emit('input', { sessionId, data });
	}
	/** @internal */
	_resize(sessionId: string, cols: number, rows: number): Promise<void> {
		return this.core.http('resize', { sessionId, cols, rows }).then(() => undefined);
	}
	/** @internal */
	_cancel(sessionId: string): Promise<void> {
		return this.core.http('cancel', { sessionId }).then(() => undefined);
	}
	/** @internal */
	_clear(sessionId: string): Promise<void> {
		return this.core.http('clear', { sessionId }).then(() => undefined);
	}
	/** @internal */
	_kill(sessionId: string): Promise<void> {
		return this.core.http('kill-session', { sessionId }).then(() => {
			this.sessions.delete(sessionId);
		});
	}
	/** @internal */
	_forget(sessionId: string): void {
		this.sessions.delete(sessionId);
	}
}
