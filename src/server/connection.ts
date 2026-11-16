/**
 * Transport-agnostic connection + room model.
 *
 * A `PtyKitConnection` is one WebSocket client. The transport (Bun or Node)
 * supplies the concrete object; the server logic only depends on this shape.
 * Integrator-supplied identity rides on `data` (set at upgrade time) and is what
 * the `authorize` hook inspects.
 */

import type { WireFrame } from '../shared/index.js';

export interface PtyKitConnection {
	/** Stable per-connection id. */
	readonly id: string;
	/** Integrator-attached identity/context, set at upgrade (e.g. `{ user }`). */
	data: Record<string, unknown>;
	/** Send a frame to this client. */
	send(frame: WireFrame): void;
	/** Close the underlying socket. */
	close(): void;
}

/**
 * Room registry for collaborative awareness (R11).
 *
 * A room (default = namespace) carries the events every viewer of a workspace
 * needs whether or not it is watching a given session: `session-created`,
 * `session-closed`, `ready`, `directory`. A session's OUTPUT does not travel
 * here — see {@link SubscriberRegistry}.
 */
export class RoomRegistry {
	private readonly rooms = new Map<string, Set<PtyKitConnection>>();
	private readonly membership = new Map<PtyKitConnection, Set<string>>();

	join(conn: PtyKitConnection, room: string): void {
		let members = this.rooms.get(room);
		if (!members) {
			members = new Set();
			this.rooms.set(room, members);
		}
		members.add(conn);

		let joined = this.membership.get(conn);
		if (!joined) {
			joined = new Set();
			this.membership.set(conn, joined);
		}
		joined.add(room);
	}

	/** Remove a connection from one room. */
	leave(conn: PtyKitConnection, room: string): void {
		const members = this.rooms.get(room);
		if (members) {
			members.delete(conn);
			if (members.size === 0) this.rooms.delete(room);
		}
		this.membership.get(conn)?.delete(room);
	}

	/** Remove a connection from every room it joined (on disconnect). */
	leaveAll(conn: PtyKitConnection): void {
		const joined = this.membership.get(conn);
		if (!joined) return;
		for (const room of joined) {
			const members = this.rooms.get(room);
			if (members) {
				members.delete(conn);
				if (members.size === 0) this.rooms.delete(room);
			}
		}
		this.membership.delete(conn);
	}

	/** Broadcast a frame to every connection in a room. */
	broadcast(room: string, frame: WireFrame): void {
		const members = this.rooms.get(room);
		if (!members) return;
		for (const conn of members) {
			try {
				conn.send(frame);
			} catch {
				// A dead socket will be cleaned up on its close event.
			}
		}
	}

	/** Number of connections currently in a room. */
	size(room: string): number {
		return this.rooms.get(room)?.size ?? 0;
	}
}

/**
 * Who receives a session's output: the connections that created or attached
 * it, and only until they detach, leave its namespace or disconnect.
 *
 * Output used to go to the whole room, so every viewer of a workspace paid
 * for every session in it — a busy dev server in a background tab, or a
 * workspace the user had long since navigated away from on that socket.
 * N clients ↔ 1 session still holds; it is just N attached clients.
 */
export class SubscriberRegistry {
	private readonly subscribers = new Map<string, Set<PtyKitConnection>>();
	private readonly subscriptions = new Map<PtyKitConnection, Set<string>>();

	subscribe(conn: PtyKitConnection, sessionId: string): void {
		let conns = this.subscribers.get(sessionId);
		if (!conns) {
			conns = new Set();
			this.subscribers.set(sessionId, conns);
		}
		conns.add(conn);

		let sessions = this.subscriptions.get(conn);
		if (!sessions) {
			sessions = new Set();
			this.subscriptions.set(conn, sessions);
		}
		sessions.add(sessionId);
	}

	unsubscribe(conn: PtyKitConnection, sessionId: string): void {
		const conns = this.subscribers.get(sessionId);
		if (conns) {
			conns.delete(conn);
			if (conns.size === 0) this.subscribers.delete(sessionId);
		}
		const sessions = this.subscriptions.get(conn);
		if (sessions) {
			sessions.delete(sessionId);
			if (sessions.size === 0) this.subscriptions.delete(conn);
		}
	}

	/** Drop a connection from every session it watched (on disconnect). */
	unsubscribeAll(conn: PtyKitConnection): void {
		for (const sessionId of this.subscriptions.get(conn) ?? []) {
			const conns = this.subscribers.get(sessionId);
			if (!conns) continue;
			conns.delete(conn);
			if (conns.size === 0) this.subscribers.delete(sessionId);
		}
		this.subscriptions.delete(conn);
	}

	/** Forget a session entirely (it was killed). */
	dropSession(sessionId: string): void {
		for (const conn of this.subscribers.get(sessionId) ?? []) {
			const sessions = this.subscriptions.get(conn);
			if (!sessions) continue;
			sessions.delete(sessionId);
			if (sessions.size === 0) this.subscriptions.delete(conn);
		}
		this.subscribers.delete(sessionId);
	}

	/** Sessions a connection currently watches. */
	sessionsOf(conn: PtyKitConnection): string[] {
		return [...(this.subscriptions.get(conn) ?? [])];
	}

	/** Send a frame to every connection watching a session. */
	deliver(sessionId: string, frame: WireFrame): void {
		const conns = this.subscribers.get(sessionId);
		if (!conns) return;
		for (const conn of conns) {
			try {
				conn.send(frame);
			} catch {
				// A dead socket will be cleaned up on its close event.
			}
		}
	}

	/** Number of connections watching a session. */
	size(sessionId: string): number {
		return this.subscribers.get(sessionId)?.size ?? 0;
	}
}
