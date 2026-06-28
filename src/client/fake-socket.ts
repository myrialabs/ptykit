/**
 * Test-only mock WebSocket. Excluded from the published build (see `tsconfig`),
 * transpiled by `bun test`, linted by ESLint.
 */

import type { WebSocketFactory, WebSocketLike } from './ws-core.js';
import type { WireFrame } from '../shared/index.js';

export class MockWebSocket implements WebSocketLike {
	static instances: MockWebSocket[] = [];
	static reset(): void {
		MockWebSocket.instances = [];
	}

	readyState = 0; // CONNECTING
	readonly url: string;
	readonly sent: string[] = [];
	onopen: ((ev?: any) => void) | null = null;
	onmessage: ((ev: { data: any }) => void) | null = null;
	onclose: ((ev?: any) => void) | null = null;
	onerror: ((ev?: any) => void) | null = null;

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.readyState = 3;
		this.onclose?.();
	}

	// ---- test controls ----
	accept(): void {
		this.readyState = 1; // OPEN
		this.onopen?.();
	}
	serverClose(): void {
		this.readyState = 3;
		this.onclose?.();
	}
	serverSend(frame: WireFrame): void {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}

	/** Frames this socket has sent, parsed. */
	get frames(): WireFrame[] {
		return this.sent.map((s) => JSON.parse(s));
	}
	/** The most recent sent frame with the given action. */
	lastFrame(action: string): WireFrame | undefined {
		return [...this.frames].reverse().find((f) => f.action === action);
	}
}

export function mockFactory(): WebSocketFactory {
	return (url: string) => new MockWebSocket(url);
}

/** Find the requestId of the last RPC of `action` and reply with success `data`. */
export function respondTo(socket: MockWebSocket, action: string, data: unknown): void {
	const frame = socket.lastFrame(action);
	const requestId = (frame?.payload as any)?.requestId;
	socket.serverSend({ action: `${action}:response`, payload: { requestId, success: true, data } });
}

export const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
