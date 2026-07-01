/**
 * `hostSocket` — ride PtyKit's client on a WebSocket you already own.
 *
 * PtyKit's transport is WebSocket-only, and normally `PtyKitClient` opens its own
 * socket to `url`. When your app already runs a single multiplexed WebSocket (one
 * connection carrying many features), you don't want a second PtyKit socket.
 * `hostSocket` adapts your existing connection into the {@link WebSocketLike} that
 * `WsCore` drives, so you keep PtyKit's reconnect/heal/idempotent-resend while the
 * host owns the actual socket. The wire protocol is unchanged — still WebSocket,
 * still `{ action, payload }` frames — only socket ownership moves to the host.
 *
 * Pass the result as `WebSocketImpl`:
 *
 * ```ts
 * const client = new PtyKitClient({
 *   namespace: 'project-42',
 *   WebSocketImpl: hostSocket({
 *     send: (frame) => appWs.emit('pty:frame', frame),
 *     subscribe: (onFrame) => appWs.on('pty:frame', onFrame),
 *     isOpen: () => appWs.status === 'connected',
 *     onStatusChange: (cb) => appWs.onStatus((s) => cb(s === 'connected')),
 *   }),
 * });
 * ```
 */

import type { WireFrame } from '../shared/index.js';
import type { WebSocketFactory, WebSocketLike } from './ws-core.js';

/** The host transport `hostSocket` bridges PtyKit onto. */
export interface HostSocketHandle {
	/** Send one client→server frame over the host transport. */
	send(frame: WireFrame): void;
	/** Receive server→client frames. Returns an unsubscribe. */
	subscribe(onFrame: (frame: WireFrame) => void): () => void;
	/** Whether the host transport is currently connected. */
	isOpen(): boolean;
	/**
	 * Notify when the host transport connects (`true`) or disconnects (`false`).
	 * Drives PtyKit's reconnect + re-attach. Returns an unsubscribe.
	 */
	onStatusChange(cb: (open: boolean) => void): () => void;
}

const WS_OPEN = 1;
const WS_CLOSED = 3;

/**
 * Build a {@link WebSocketFactory} (for `WebSocketImpl`) that tunnels PtyKit
 * frames over an existing host connection instead of opening a new socket.
 */
export function hostSocket(handle: HostSocketHandle): WebSocketFactory {
	return () => {
		let dead = false;
		let opened = false;
		let unsubFrame: (() => void) | null = null;
		let unsubStatus: (() => void) | null = null;

		const socket: WebSocketLike = {
			get readyState() {
				return !dead && handle.isOpen() ? WS_OPEN : WS_CLOSED;
			},
			send(data: string) {
				// WsCore already serialized the frame; hand the host a structured
				// frame so it can route by action on its own wire without re-parsing.
				try {
					handle.send(JSON.parse(data) as WireFrame);
				} catch {
					/* drop malformed frame */
				}
			},
			close() {
				dead = true;
				unsubFrame?.();
				unsubStatus?.();
			},
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
		};

		const goDown = () => {
			if (dead) return;
			dead = true;
			unsubFrame?.();
			unsubStatus?.();
			socket.onclose?.();
		};
		const goUp = () => {
			if (dead || opened) return;
			opened = true;
			socket.onopen?.();
		};

		unsubFrame = handle.subscribe((frame) => {
			if (!dead) socket.onmessage?.({ data: JSON.stringify(frame) });
		});
		unsubStatus = handle.onStatusChange((open) => {
			// Fire `onclose` only on a real drop of an established link; while merely
			// waiting for the host to come up, stay pending so WsCore doesn't burn
			// reconnect attempts — it re-attaches the moment the host reconnects.
			if (open) goUp();
			else if (opened) goDown();
		});

		// Announce the initial state on a microtask so WsCore can assign handlers
		// first. If the host is already up, open immediately; otherwise wait.
		queueMicrotask(() => {
			if (!dead && handle.isOpen()) goUp();
		});

		return socket;
	};
}
