/**
 * Resilient WebSocket client core — the battle-tested pieces of a production
 * WebSocket client:
 *  - exponential backoff reconnect (default 1s→30s, max 5 attempts),
 *  - **heal-reconnect** for "open but dead" sockets (a stalled read forces one
 *    reconnect + retry before failing),
 *  - **idempotency-aware resend**: reads resend freely; mutations resend only if
 *    never actually delivered,
 *  - `onReconnect` fires BEFORE the queue flush so room re-subscription happens
 *    first,
 *  - connection status surfaced via `onStatus`.
 *
 * Text/JSON frames only (terminal I/O is text). The WebSocket implementation is
 * injectable for testing.
 */

import {
	RPC_ACTIONS,
	type RpcResponse,
	type WireFrame,
	type Seq,
} from '../shared/index.js';

export type WSStatus = 'connected' | 'reconnecting' | 'disconnected';

/** Minimal structural WebSocket shape (browser `WebSocket` satisfies it). */
export interface WebSocketLike {
	readyState: number;
	send(data: string): void;
	close(): void;
	onopen: ((ev?: any) => void) | null;
	onmessage: ((ev: { data: any }) => void) | null;
	onclose: ((ev?: any) => void) | null;
	onerror: ((ev?: any) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ReconnectOptions {
	enabled?: boolean;
	baseDelayMs?: number;
	maxDelayMs?: number;
	/** 0 = infinite. Default 5. */
	maxAttempts?: number;
}

export interface WsCoreOptions {
	url: string;
	reconnect?: ReconnectOptions;
	onStatus?: (status: WSStatus, attempts: number) => void;
	/** Fired on every reconnect (not the first connect), before the queue flush. */
	onReconnect?: () => void;
	/** Injectable WebSocket constructor (defaults to global `WebSocket`). */
	WebSocketImpl?: WebSocketFactory;
	/** RPC timeout (ms). Default 30000. */
	requestTimeoutMs?: number;
}

const WS_OPEN = 1;

/** RPC actions that are safe to transparently re-send after a reconnect. */
const IDEMPOTENT_ACTIONS = new Set<string>([
	'create-session', // idempotent server-side (reuse by id)
	'resize',
	'reconnect',
	'list-sessions',
	'pty-status',
	'stream-status',
	'missed-output',
	'check-shell',
]);

function isIdempotent(action: string): boolean {
	return IDEMPOTENT_ACTIONS.has(action);
}

interface PendingRequest {
	action: string;
	payload: { requestId: string; data: unknown };
	sent: boolean;
	attempts: number;
	arm: () => void;
	cleanup: () => void;
	fail: (err: Error) => void;
}

export class WsCore {
	private ws: WebSocketLike | null = null;
	private readonly url: string;
	private readonly factory: WebSocketFactory;
	private readonly reconnectOpts: Required<ReconnectOptions>;
	private readonly requestTimeoutMs: number;
	private readonly onStatus?: (status: WSStatus, attempts: number) => void;
	private readonly onReconnect?: () => void;

	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private isConnected = false;
	private shouldReconnect = true;
	private hasConnectedBefore = false;
	private healing = false;

	private readonly listeners = new Map<string, Set<(payload: any) => void>>();
	private messageQueue: WireFrame[] = [];
	private readonly pending = new Map<string, PendingRequest>();

	constructor(options: WsCoreOptions) {
		this.url = options.url;
		this.factory =
			options.WebSocketImpl ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.onStatus = options.onStatus;
		this.onReconnect = options.onReconnect;
		this.reconnectOpts = {
			enabled: options.reconnect?.enabled ?? true,
			baseDelayMs: options.reconnect?.baseDelayMs ?? 1000,
			maxDelayMs: options.reconnect?.maxDelayMs ?? 30_000,
			maxAttempts: options.reconnect?.maxAttempts ?? 5,
		};
		this.connect();
	}

	private connect(): void {
		if (this.ws) {
			try {
				this.ws.onclose = null;
				this.ws.onerror = null;
				this.ws.onmessage = null;
				this.ws.close();
			} catch {
				/* ignore stale socket */
			}
			this.ws = null;
		}

		const socket = this.factory(this.url);
		this.ws = socket;

		socket.onopen = () => {
			this.isConnected = true;
			this.reconnectAttempts = 0;
			this.onStatus?.('connected', 0);

			const isReconnect = this.hasConnectedBefore;
			this.hasConnectedBefore = true;
			if (isReconnect) {
				try {
					this.onReconnect?.();
				} catch {
					/* swallow consumer error */
				}
			}
			this.healing = false;

			// Flush fire-and-forget queue (drain locally so a re-queue can't spin).
			const queued = this.messageQueue;
			this.messageQueue = [];
			for (const frame of queued) this.sendRaw(frame);

			// Resend in-flight RPCs the previous socket may have swallowed.
			for (const entry of this.pending.values()) {
				if (entry.sent && !isIdempotent(entry.action)) continue;
				entry.sent = true;
				this.sendRaw({ action: entry.action, payload: entry.payload });
				entry.arm();
			}
		};

		socket.onmessage = (event) => {
			let frame: WireFrame;
			try {
				frame = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (frame && typeof frame.action === 'string') {
				this.dispatch(frame.action, frame.payload);
			}
		};

		socket.onerror = () => {
			/* errors surface via onclose */
		};

		socket.onclose = () => {
			this.isConnected = false;
			this.ws = null;
			if (this.shouldReconnect && this.reconnectOpts.enabled) {
				this.onStatus?.('reconnecting', this.reconnectAttempts);
				this.scheduleReconnect();
			} else {
				this.onStatus?.('disconnected', this.reconnectAttempts);
			}
		};
	}

	private scheduleReconnect(): void {
		if (
			this.reconnectOpts.maxAttempts > 0 &&
			this.reconnectAttempts >= this.reconnectOpts.maxAttempts
		) {
			this.onStatus?.('disconnected', this.reconnectAttempts);
			return;
		}
		this.reconnectAttempts++;
		const delay = Math.min(
			this.reconnectOpts.baseDelayMs * Math.pow(2, this.reconnectAttempts - 1),
			this.reconnectOpts.maxDelayMs,
		);
		this.onStatus?.('reconnecting', this.reconnectAttempts);
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	private dispatch(action: string, payload: any): void {
		const callbacks = this.listeners.get(action);
		if (!callbacks) return;
		for (const cb of callbacks) {
			try {
				cb(payload);
			} catch {
				/* swallow listener error */
			}
		}
	}

	private isSocketOpen(): boolean {
		return !!this.ws && this.ws.readyState === WS_OPEN;
	}

	private sendRaw(frame: WireFrame): void {
		if (!this.isSocketOpen()) {
			this.messageQueue.push(frame);
			return;
		}
		try {
			this.ws!.send(JSON.stringify(frame));
		} catch {
			this.messageQueue.push(frame);
		}
	}

	/** Fire-and-forget event to the server (queued if not connected). */
	emit(action: string, payload: unknown): void {
		const frame = { action, payload };
		if (this.isSocketOpen()) this.sendRaw(frame);
		else this.messageQueue.push(frame);
	}

	/** Subscribe to a server event. Returns an unsubscribe function. */
	on(action: string, callback: (payload: any) => void): () => void {
		let set = this.listeners.get(action);
		if (!set) {
			set = new Set();
			this.listeners.set(action, set);
		}
		set.add(callback);
		return () => {
			const s = this.listeners.get(action);
			if (s) {
				s.delete(callback);
				if (s.size === 0) this.listeners.delete(action);
			}
		};
	}

	/**
	 * RPC request/response. Resolves with the unwrapped `data` on success,
	 * rejects on error/timeout. Survives a transport hiccup (resend + heal).
	 */
	http<TData = any>(action: string, data: unknown = {}, timeout = this.requestTimeoutMs): Promise<TData> {
		if (!(RPC_ACTIONS as readonly string[]).includes(action)) {
			return Promise.reject(new Error(`Unknown RPC action: ${action}`));
		}
		const requestId = `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const payload = { requestId, data };
		const responseAction = `${action}:response`;
		const idempotent = isIdempotent(action);
		const MAX_HEAL = 2;

		return new Promise<TData>((resolve, reject) => {
			let unsub: (() => void) | null = null;
			let timer: ReturnType<typeof setTimeout> | null = null;

			const entry: PendingRequest = {
				action,
				payload,
				sent: false,
				attempts: 0,
				arm: () => {
					if (timeout <= 0) return;
					if (timer) clearTimeout(timer);
					timer = setTimeout(onTimeout, timeout);
				},
				cleanup: () => {
					unsub?.();
					if (timer) clearTimeout(timer);
					timer = null;
					this.pending.delete(requestId);
				},
				fail: (err: Error) => {
					entry.cleanup();
					reject(err);
				},
			};

			const onTimeout = () => {
				if (idempotent && entry.attempts < MAX_HEAL) {
					entry.attempts++;
					entry.arm();
					// Socket claims open but stalled → likely black-holed; force a
					// reconnect (guarded). The onopen resend loop re-delivers this.
					if (this.isSocketOpen() && !this.healing) {
						this.healing = true;
						this.reconnect();
					}
					return;
				}
				entry.cleanup();
				reject(new Error(`Request timeout: ${action} (${timeout}ms)`));
			};

			const handleResponse = (response: RpcResponse<TData>) => {
				if (response?.requestId !== requestId) return;
				entry.cleanup();
				if (response.success) resolve(response.data as TData);
				else reject(new Error(response.error || 'Unknown error'));
			};

			unsub = this.on(responseAction, handleResponse);
			this.pending.set(requestId, entry);
			entry.arm();

			if (this.isSocketOpen()) {
				entry.sent = true;
				this.sendRaw({ action, payload });
			}
		});
	}

	connected(): boolean {
		return this.isConnected;
	}

	/** Force a reconnect, preserving listeners and the pending/queue state. */
	reconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			try {
				this.ws.onclose = null;
				this.ws.onerror = null;
				this.ws.onmessage = null;
				this.ws.close();
			} catch {
				/* ignore */
			}
			this.ws = null;
		}
		this.isConnected = false;
		this.shouldReconnect = true;
		this.reconnectAttempts = 0;
		this.connect();
	}

	/** Permanently disconnect and fail any in-flight requests. */
	disconnect(): void {
		this.shouldReconnect = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			try {
				this.ws.close();
			} catch {
				/* ignore */
			}
			this.ws = null;
		}
		this.listeners.clear();
		this.messageQueue = [];
		this.isConnected = false;
		for (const entry of [...this.pending.values()]) {
			entry.fail(new Error('WebSocket disconnected'));
		}
		this.pending.clear();
		this.onStatus?.('disconnected', this.reconnectAttempts);
	}
}

export type { Seq };
