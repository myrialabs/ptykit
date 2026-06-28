/**
 * Bun transport. Bun's HTTP server IS `Bun.serve`, so there is no external
 * `http.Server` to attach to — instead the integrator wires our `fetch` and
 * `websocket` handlers into their `Bun.serve` call:
 *
 * ```ts
 * Bun.serve({ port, fetch: server.fetch, websocket: server.websocket });
 * ```
 */

import type { Logger, WireFrame } from '../shared/index.js';
import type { PtyKitConnection } from './connection.js';
import type { PtyKitServer } from './pty-kit-server.js';
import { nextConnectionId } from './ids.js';

interface BunSocketData {
	identity: Record<string, unknown>;
	conn: PtyKitConnection | null;
}

export class BunTransport {
	constructor(
		private readonly server: PtyKitServer,
		private readonly logger: Logger,
	) {}

	private matchesPath(request: Request): boolean {
		try {
			return new URL(request.url).pathname === this.server.path;
		} catch {
			return false;
		}
	}

	/** Bun `fetch` handler. Returns `undefined` after a successful upgrade. */
	readonly fetch = async (request: Request, bunServer: any): Promise<Response | undefined> => {
		if (!this.matchesPath(request)) return undefined;

		const identity = await this.server.resolveUpgrade(request);
		if (identity === false) {
			return new Response('Unauthorized', { status: 401 });
		}

		const data: BunSocketData = { identity, conn: null };
		const ok = bunServer.upgrade(request, { data });
		if (ok) return undefined;
		return new Response('Expected a WebSocket upgrade', { status: 426 });
	};

	/** Bun `websocket` handlers. */
	readonly websocket = {
		open: (ws: any) => {
			const sockData = ws.data as BunSocketData;
			const conn: PtyKitConnection = {
				id: nextConnectionId(),
				data: sockData.identity,
				send: (frame: WireFrame) => {
					try {
						ws.send(JSON.stringify(frame));
					} catch (err) {
						this.logger.error('server', 'bun send failed', err);
					}
				},
				close: () => {
					try {
						ws.close();
					} catch {
						/* already closed */
					}
				},
			};
			sockData.conn = conn;
			this.server.handleOpen(conn);
		},
		message: (ws: any, message: string | ArrayBuffer | Uint8Array) => {
			const conn = (ws.data as BunSocketData).conn;
			if (conn) void this.server.handleMessage(conn, message);
		},
		close: (ws: any) => {
			const conn = (ws.data as BunSocketData).conn;
			if (conn) this.server.handleClose(conn);
		},
	};
}
