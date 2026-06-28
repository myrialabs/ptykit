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
 * Room registry for collaborative broadcast (R11).
 *
 * Output for a session broadcasts to its room (default = namespace); every
 * connection in the room receives it and filters by `sessionId` client-side.
 * N clients ↔ 1 session.
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
