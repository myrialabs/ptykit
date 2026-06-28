/**
 * Node transport. Node's `http.Server` has no built-in WebSocket server, so the
 * Node path uses the optional `ws` package, loaded lazily — a Bun consumer never
 * installs it.
 *
 * ```ts
 * const httpServer = http.createServer(app);
 * await server.attach(httpServer);
 * httpServer.listen(3000);
 * ```
 */

import type { Logger, WireFrame } from '../shared/index.js';
import type { PtyKitConnection } from './connection.js';
import type { PtyKitServer } from './pty-kit-server.js';
import { nextConnectionId } from './ids.js';

export class NodeTransport {
	constructor(
		private readonly server: PtyKitServer,
		private readonly logger: Logger,
	) {}

	async attach(httpServer: any): Promise<void> {
		let WebSocketServer: any;
		try {
			({ WebSocketServer } = await import(/* @vite-ignore */ 'ws'));
		} catch (err) {
			throw new Error(
				'ptykit: the Node WebSocket transport requires the "ws" package. Install it ' +
					`(\`npm install ws\`). Underlying error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		const wss = new WebSocketServer({ noServer: true });

		httpServer.on('upgrade', async (request: any, socket: any, head: any) => {
			let pathname: string;
			try {
				pathname = new URL(request.url, 'http://localhost').pathname;
			} catch {
				return;
			}
			if (pathname !== this.server.path) return; // not ours — leave for others

			const identity = await this.server.resolveUpgrade(request);
			if (identity === false) {
				socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
				socket.destroy();
				return;
			}

			wss.handleUpgrade(request, socket, head, (ws: any) => {
				const conn: PtyKitConnection = {
					id: nextConnectionId(),
					data: identity,
					send: (frame: WireFrame) => {
						try {
							ws.send(JSON.stringify(frame));
						} catch (err) {
							this.logger.error('server', 'node send failed', err);
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

				this.server.handleOpen(conn);
				ws.on('message', (data: any, isBinary: boolean) => {
					void this.server.handleMessage(conn, isBinary ? new Uint8Array(data) : data.toString());
				});
				ws.on('close', () => this.server.handleClose(conn));
				ws.on('error', (err: unknown) => this.logger.error('server', 'node socket error', err));
			});
		});
	}
}
