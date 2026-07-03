/**
 * `createPtyKitServer` — the WebSocket transport over a `PtyKit` manager.
 *
 * WebSocket only (R9). Control plane = RPC request/response keyed by
 * `requestId`; data plane = events broadcast to a collaborative room (R11) and
 * filtered client-side by `sessionId`. Access is enforced by the `authorize`
 * hook with anti-hijack ownership checks (R10).
 */

import type { PtyKitManager } from '../core/pty-kit.js';
import type { Session } from '../core/session.js';
import { checkShell } from '../core/shell.js';
import {
	CLIENT_EVENTS,
	RPC_ACTIONS,
	type Logger,
	type WireFrame,
	silentLogger,
	type CreateSessionRequest,
	type ResizeRequest,
	type CancelRequest,
	type KillSessionRequest,
	type ClearRequest,
	type PtyStatusRequest,
	type ListSessionsRequest,
	type StreamStatusRequest,
	type MissedOutputRequest,
	type ReconnectRequest,
} from '../shared/index.js';
import { RoomRegistry, type PtyKitConnection } from './connection.js';
import { nextConnectionId } from './ids.js';
import { BunTransport } from './transport-bun.js';
import { NodeTransport } from './transport-node.js';

/** Options for {@link PtyKitServer.createConnection} (embedded transports). */
export interface EmbeddedConnectionOptions {
	/** Identity/context the `authorize` hook inspects (e.g. `{ user }`). */
	data?: Record<string, unknown>;
	/** Deliver one wire frame to this client. */
	send: (frame: WireFrame) => void;
	/** Tear down the underlying transport for this client. Optional. */
	close?: () => void;
}

/** The operation an `authorize` check guards. */
export type AuthorizeOperation = 'create' | 'attach' | 'write' | 'resize' | 'kill';

export interface AuthorizeContext {
	operation: AuthorizeOperation;
	namespace: string;
	sessionId?: string;
	conn: PtyKitConnection;
}

/** Decide whether a connection may perform an operation. Return `false` to deny. */
export type AuthorizeHook = (ctx: AuthorizeContext) => boolean | Promise<boolean>;

export interface RoomContext {
	namespace: string;
	sessionId?: string;
	conn: PtyKitConnection;
}

/** Resolve the broadcast room for a context. Default: the namespace. */
export type RoomResolver = (ctx: RoomContext) => string;

/** Per-connection identity factory, run at upgrade. Return `false` to reject. */
export type UpgradeHook = (
	request: any,
) => Record<string, unknown> | false | Promise<Record<string, unknown> | false>;

export interface PtyKitServerOptions {
	/** WebSocket path to accept upgrades on. Default `'/'`. */
	path?: string;
	/**
	 * Access hook (R10). **Defaults to allow-all** for local DX — production
	 * deployments MUST provide one. See the README security note.
	 */
	authorize?: AuthorizeHook;
	/** Collaborative room resolver (R11). Default `(ctx) => ctx.namespace`. */
	room?: RoomResolver;
	/** Attach identity to a connection at upgrade; return `false` to reject. */
	onUpgrade?: UpgradeHook;
	/** Diagnostics sink. Off by default. */
	logger?: Logger;
}

function iso(): string {
	return new Date().toISOString();
}

export class PtyKitServer {
	readonly manager: PtyKitManager;
	readonly path: string;
	private readonly rooms = new RoomRegistry();
	private readonly options: PtyKitServerOptions;
	private readonly logger: Logger;
	private readonly resolveRoom: RoomResolver;

	private bunTransport?: BunTransport;
	private nodeTransport?: NodeTransport;

	constructor(manager: PtyKitManager, options: PtyKitServerOptions = {}) {
		this.manager = manager;
		this.options = options;
		this.logger = options.logger ?? silentLogger;
		this.path = options.path ?? '/';
		this.resolveRoom = options.room ?? ((ctx) => ctx.namespace);
	}

	// ---- Embedded transport (bring-your-own-socket) ------------------------

	/**
	 * Mint a transport-agnostic {@link PtyKitConnection} for embedding PtyKit on a
	 * socket you already own (e.g. an app-wide multiplexed WebSocket) instead of
	 * letting the Bun/Node transports own it. PtyKit assigns a stable id; you
	 * supply how to `send` a frame (and optionally `close`). Drive the connection
	 * with {@link handleOpen}, {@link handleFrame} / {@link handleMessage}, and
	 * {@link handleClose}.
	 *
	 * The wire protocol is unchanged — still WebSocket, still `{ action, payload }`
	 * frames — only socket ownership moves to the host.
	 */
	createConnection(opts: EmbeddedConnectionOptions): PtyKitConnection {
		return {
			id: nextConnectionId(),
			data: opts.data ?? {},
			send: opts.send,
			close: opts.close ?? (() => {}),
		};
	}

	/**
	 * Process one already-parsed wire frame from a connection. Prefer this over
	 * {@link handleMessage} in embedded transports that carry structured frames
	 * (avoids a redundant JSON stringify/parse round-trip).
	 */
	async handleFrame(conn: PtyKitConnection, frame: WireFrame): Promise<void> {
		if (!frame || typeof frame.action !== 'string') return;
		await this.dispatch(conn, frame.action, frame.payload);
	}

	// ---- Identity / lifecycle ----------------------------------------------

	/** Resolve connection identity at upgrade. Returns `false` to reject. */
	async resolveUpgrade(request: any): Promise<Record<string, unknown> | false> {
		if (!this.options.onUpgrade) return {};
		try {
			return await this.options.onUpgrade(request);
		} catch (err) {
			this.logger.error('server', 'onUpgrade threw', err);
			return false;
		}
	}

	handleOpen(_conn: PtyKitConnection): void {
		// no-op; rooms are joined lazily on create/attach
	}

	handleClose(conn: PtyKitConnection): void {
		this.rooms.leaveAll(conn);
	}

	/** Process one inbound raw message (string or bytes) from a connection. */
	async handleMessage(conn: PtyKitConnection, raw: string | ArrayBuffer | Uint8Array): Promise<void> {
		let frame: WireFrame;
		try {
			const text =
				typeof raw === 'string'
					? raw
					: new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
			frame = JSON.parse(text);
		} catch {
			this.logger.warn('server', 'dropping unparseable frame');
			return;
		}
		await this.handleFrame(conn, frame);
	}

	// ---- Dispatch -----------------------------------------------------------

	private async dispatch(conn: PtyKitConnection, action: string, payload: any): Promise<void> {
		if ((CLIENT_EVENTS as readonly string[]).includes(action)) {
			await this.handleEvent(conn, action, payload);
			return;
		}
		if ((RPC_ACTIONS as readonly string[]).includes(action)) {
			const requestId: string = payload?.requestId;
			const data = payload?.data ?? {};
			try {
				const result = await this.handleRpc(conn, action, data);
				this.respond(conn, action, requestId, result);
			} catch (err) {
				this.respondError(conn, action, requestId, err);
			}
			return;
		}
		this.logger.warn('server', `unknown action: ${action}`);
	}

	private respond(conn: PtyKitConnection, action: string, requestId: string, data: unknown): void {
		conn.send({ action: `${action}:response`, payload: { requestId, success: true, data } });
	}

	private respondError(conn: PtyKitConnection, action: string, requestId: string, err: unknown): void {
		const error = err instanceof Error ? err.message : 'Unknown error';
		conn.send({ action: `${action}:response`, payload: { requestId, success: false, error } });
	}

	private async authorize(
		operation: AuthorizeOperation,
		namespace: string,
		conn: PtyKitConnection,
		sessionId?: string,
	): Promise<void> {
		const hook = this.options.authorize;
		if (!hook) return; // allow-all (documented production footgun)
		const ok = await hook({ operation, namespace, sessionId, conn });
		if (!ok) throw new Error('Access denied');
	}

	/** Look up a session, deriving the namespace for an ownership check. */
	private requireSession(sessionId: string): Session {
		const session = this.manager.getSession(sessionId);
		if (!session) throw new Error('Session not found');
		return session;
	}

	private broadcast(room: string, action: string, payload: unknown): void {
		this.rooms.broadcast(room, { action, payload });
	}

	/**
	 * Install the single room-broadcast listener pair for a session, after
	 * clearing any previous listeners (R7c) so switching/returning clients never
	 * double up output. Output broadcasts to the whole room (collaborative);
	 * clients filter by `sessionId`.
	 */
	private wireBroadcast(session: Session, room: string): void {
		session.clearListeners();
		session.addDataListener((content, seq) => {
			this.broadcast(room, 'output', {
				sessionId: session.sessionId,
				content,
				seq,
				timestamp: iso(),
			});
		});
		session.addExitListener((event) => {
			this.broadcast(room, 'exit', { sessionId: session.sessionId, exitCode: event.exitCode });
		});
	}

	private async handleEvent(conn: PtyKitConnection, action: string, payload: any): Promise<void> {
		if (action === 'input') {
			const { sessionId, data } = payload ?? {};
			let session: Session;
			try {
				session = this.requireSession(sessionId);
				await this.authorize('write', session.namespace, conn, sessionId);
			} catch (err) {
				// Input is fire-and-forget; surface failures as a room error event.
				this.logger.warn('server', 'input rejected', err);
				return;
			}
			const ok = this.manager.write(sessionId, data);
			if (!ok) {
				const room = this.resolveRoom({ namespace: session.namespace, sessionId, conn });
				this.broadcast(room, 'error', {
					sessionId,
					error: 'Session not found or PTY not available',
				});
			}
		}
	}

	private async handleRpc(conn: PtyKitConnection, action: string, data: any): Promise<unknown> {
		switch (action) {
			case 'create-session':
				return this.opCreateSession(conn, data as CreateSessionRequest);
			case 'resize':
				return this.opResize(conn, data as ResizeRequest);
			case 'cancel':
				return this.opCancel(conn, data as CancelRequest);
			case 'kill-session':
				return this.opKill(conn, data as KillSessionRequest);
			case 'clear':
				return this.opClear(conn, data as ClearRequest);
			case 'check-shell':
				return checkShell();
			case 'pty-status':
				return this.opPtyStatus(conn, data as PtyStatusRequest);
			case 'list-sessions':
				return this.opListSessions(conn, data as ListSessionsRequest);
			case 'stream-status':
				return this.opStreamStatus(conn, data as StreamStatusRequest);
			case 'missed-output':
				return this.opMissedOutput(conn, data as MissedOutputRequest);
			case 'reconnect':
				return this.opReconnect(conn, data as ReconnectRequest);
			default:
				throw new Error(`Unsupported operation: ${action}`);
		}
	}

	private async opCreateSession(conn: PtyKitConnection, data: CreateSessionRequest) {
		await this.authorize('create', data.namespace, conn, data.sessionId);
		const room = this.resolveRoom({ namespace: data.namespace, sessionId: data.sessionId, conn });

		const session = await this.manager.createSession({
			sessionId: data.sessionId,
			namespace: data.namespace,
			streamId: data.streamId,
			shell: data.shell,
			cwd: data.cwd,
			cols: data.cols ?? 80,
			rows: data.rows ?? 24,
		});

		this.rooms.join(conn, room);
		this.wireBroadcast(session, room);

		// Align the session to the attaching client's viewport BEFORE serializing so
		// the replayed frame matches it exactly. Without this, a client reattaching
		// at a different size replays a frame serialized at the OLD dimensions —
		// which garbles full-screen TUIs (codex/claude/opencode) whose alt-screen
		// content is absolutely positioned. Resizing also raises SIGWINCH, so the
		// app redraws cleanly for every viewer. No-op when the size already matches.
		if (data.cols && data.rows && (session.cols !== data.cols || session.rows !== data.rows)) {
			this.manager.resize(session.sessionId, data.cols, data.rows);
		}

		const cols = session.cols;
		const rows = session.rows;

		// Collaborative awareness events to the whole room.
		this.broadcast(room, 'ready', {
			sessionId: session.sessionId,
			streamId: session.streamId,
			pid: session.pid,
			cols,
			rows,
		});
		this.broadcast(room, 'directory', {
			sessionId: session.sessionId,
			newDirectory: session.cwd,
		});

		// Replay serialized scrollback to the JOINING client only — re-sending it
		// to the whole room would repaint already-attached viewers (R7).
		const replay = session.serialize();
		if (replay) {
			conn.send({
				action: 'output',
				payload: { sessionId: session.sessionId, content: replay, timestamp: iso() },
			});
		}

		this.broadcast(room, 'session-created', {
			sessionId: session.sessionId,
			namespace: session.namespace,
			streamId: session.streamId,
			pid: session.pid,
			currentDirectory: session.cwd,
			cols,
			rows,
		});

		return {
			sessionId: session.sessionId,
			streamId: session.streamId,
			pid: session.pid,
			currentDirectory: session.cwd,
			cols,
			rows,
		};
	}

	private async opResize(conn: PtyKitConnection, data: ResizeRequest) {
		const session = this.requireSession(data.sessionId);
		await this.authorize('resize', session.namespace, conn, data.sessionId);
		if (!this.manager.resize(data.sessionId, data.cols, data.rows)) {
			throw new Error('No active PTY session found');
		}
		return { sessionId: data.sessionId, cols: data.cols, rows: data.rows };
	}

	private async opCancel(conn: PtyKitConnection, data: CancelRequest) {
		const session = this.requireSession(data.sessionId);
		await this.authorize('write', session.namespace, conn, data.sessionId);
		const pid = session.pid;
		session.cancel();
		return { sessionId: data.sessionId, pid };
	}

	private async opKill(conn: PtyKitConnection, data: KillSessionRequest) {
		const session = this.manager.getSession(data.sessionId);
		if (!session) return { sessionId: data.sessionId };
		await this.authorize('kill', session.namespace, conn, data.sessionId);
		const pid = session.pid;
		const room = this.resolveRoom({ namespace: session.namespace, sessionId: data.sessionId, conn });
		this.manager.killSession(data.sessionId);
		this.broadcast(room, 'session-closed', { sessionId: data.sessionId, namespace: session.namespace });
		return { sessionId: data.sessionId, pid };
	}

	private async opClear(conn: PtyKitConnection, data: ClearRequest) {
		const session = this.requireSession(data.sessionId);
		await this.authorize('write', session.namespace, conn, data.sessionId);
		this.manager.clear(data.sessionId);
		return { sessionId: data.sessionId };
	}

	private async opPtyStatus(conn: PtyKitConnection, data: PtyStatusRequest) {
		const session = this.manager.getSession(data.sessionId);
		if (!session) {
			return { isActive: false, sessionId: data.sessionId, message: 'PTY not found' };
		}
		await this.authorize('attach', session.namespace, conn, data.sessionId);
		return {
			isActive: session.status === 'active',
			sessionId: data.sessionId,
			pid: session.pid,
		};
	}

	private async opListSessions(conn: PtyKitConnection, data: ListSessionsRequest) {
		await this.authorize('attach', data.namespace, conn);
		const sessions = this.manager.list(data.namespace).map((s) => {
			const info = s.info();
			return {
				sessionId: info.sessionId,
				pid: info.pid,
				cwd: info.cwd,
				createdAt: info.createdAt.toISOString(),
				lastActivityAt: info.lastActivityAt.toISOString(),
			};
		});
		return { sessions };
	}

	private async opStreamStatus(conn: PtyKitConnection, data: StreamStatusRequest) {
		const session = this.requireSession(data.sessionId);
		await this.authorize('attach', session.namespace, conn, data.sessionId);
		return {
			status: session.status,
			bufferLength: session.bufferLength(),
			startedAt: session.createdAt.toISOString(),
			processId: session.pid,
		};
	}

	private async opMissedOutput(conn: PtyKitConnection, data: MissedOutputRequest) {
		const session = this.requireSession(data.sessionId);
		await this.authorize('attach', session.namespace, conn, data.sessionId);
		return {
			sessionId: data.sessionId,
			output: session.serialize(),
			status: session.status,
			timestamp: iso(),
		};
	}

	private async opReconnect(conn: PtyKitConnection, data: ReconnectRequest) {
		const session = this.requireSession(data.sessionId);
		await this.authorize('attach', session.namespace, conn, data.sessionId);
		const room = this.resolveRoom({ namespace: session.namespace, sessionId: data.sessionId, conn });
		this.rooms.join(conn, room);

		const output = session.serialize();
		if (output) {
			conn.send({
				action: 'output',
				payload: { sessionId: data.sessionId, content: output, timestamp: iso() },
			});
		}

		if (session.status === 'active') {
			// Ensure ongoing output reaches the room even if create-session hasn't
			// (re)installed listeners yet.
			if (session.dataListenerCount === 0) this.wireBroadcast(session, room);
		} else {
			this.broadcast(room, 'exit', { sessionId: data.sessionId, exitCode: session.exitCode ?? 0 });
		}

		return { sessionId: data.sessionId, output, status: session.status };
	}

	// ---- Transport mounting -------------------------------------------------

	/** Mount onto a Node `http.Server` (uses the optional `ws` package). */
	async attach(httpServer: any): Promise<void> {
		this.nodeTransport = new NodeTransport(this, this.logger);
		await this.nodeTransport.attach(httpServer);
	}

	/** Bun `fetch` handler — upgrades matching requests; returns undefined otherwise. */
	get fetch() {
		this.bunTransport ??= new BunTransport(this, this.logger);
		return this.bunTransport.fetch;
	}

	/** Bun `websocket` handlers object to pass to `Bun.serve`. */
	get websocket() {
		this.bunTransport ??= new BunTransport(this, this.logger);
		return this.bunTransport.websocket;
	}
}

/** Create a WebSocket server over a `PtyKitManager`. */
export function createPtyKitServer(manager: PtyKitManager, options: PtyKitServerOptions = {}): PtyKitServer {
	return new PtyKitServer(manager, options);
}
