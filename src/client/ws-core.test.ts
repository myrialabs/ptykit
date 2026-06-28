import { beforeEach, expect, test } from 'bun:test';
import { WsCore, type WSStatus } from './ws-core.js';
import { MockWebSocket, mockFactory, tick } from './fake-socket.js';

beforeEach(() => MockWebSocket.reset());

function makeCore(onStatus?: (s: WSStatus, n: number) => void, onReconnect?: () => void) {
	const core = new WsCore({
		url: 'ws://test/pty',
		reconnect: { baseDelayMs: 5, maxDelayMs: 10, maxAttempts: 5 },
		requestTimeoutMs: 30,
		WebSocketImpl: mockFactory(),
		onStatus,
		onReconnect,
	});
	return core;
}

test('reports connected status on open', () => {
	const statuses: WSStatus[] = [];
	makeCore((s) => statuses.push(s));
	MockWebSocket.instances[0]!.accept();
	expect(statuses).toContain('connected');
});

test('queues fire-and-forget messages until connected, then flushes', () => {
	const core = makeCore();
	core.emit('input', { sessionId: 's1', data: 'x' });
	const socket = MockWebSocket.instances[0]!;
	expect(socket.sent.length).toBe(0); // not open yet
	socket.accept();
	expect(socket.lastFrame('input')).toBeDefined();
});

test('http resolves with unwrapped data on success', async () => {
	const core = makeCore();
	const socket = MockWebSocket.instances[0]!;
	socket.accept();
	const p = core.http('list-sessions', { namespace: 'ns1' });
	const frame = socket.lastFrame('list-sessions');
	expect(frame).toBeDefined();
	const requestId = (frame!.payload as any).requestId;
	socket.serverSend({
		action: 'list-sessions:response',
		payload: { requestId, success: true, data: { sessions: [] } },
	});
	await expect(p).resolves.toEqual({ sessions: [] });
});

test('http rejects with the server error message', async () => {
	const core = makeCore();
	const socket = MockWebSocket.instances[0]!;
	socket.accept();
	const p = core.http('resize', { sessionId: 's1', cols: 80, rows: 24 });
	const requestId = (socket.lastFrame('resize')!.payload as any).requestId;
	socket.serverSend({
		action: 'resize:response',
		payload: { requestId, success: false, error: 'No active PTY session found' },
	});
	await expect(p).rejects.toThrow('No active PTY session found');
});

test('reconnects with backoff and fires onReconnect on a second connect', async () => {
	const statuses: WSStatus[] = [];
	let reconnects = 0;
	makeCore((s) => statuses.push(s), () => reconnects++);

	MockWebSocket.instances[0]!.accept();
	MockWebSocket.instances[0]!.serverClose();
	expect(statuses).toContain('reconnecting');

	await tick(15); // let backoff timer fire
	expect(MockWebSocket.instances.length).toBe(2);
	MockWebSocket.instances[1]!.accept();
	expect(reconnects).toBe(1);
	expect(statuses[statuses.length - 1]).toBe('connected');
});

test('heal-reconnect: a stalled idempotent read forces a reconnect + resend', async () => {
	const core = makeCore();
	const socket0 = MockWebSocket.instances[0]!;
	socket0.accept();

	const p = core.http('list-sessions', { namespace: 'ns1' }); // idempotent
	const requestId = (socket0.lastFrame('list-sessions')!.payload as any).requestId;

	// No response → after requestTimeoutMs the core heals (reconnects).
	await tick(40);
	expect(MockWebSocket.instances.length).toBe(2);

	const socket1 = MockWebSocket.instances[1]!;
	socket1.accept(); // resend loop re-delivers the request on the fresh socket
	const resent = socket1.lastFrame('list-sessions');
	expect((resent!.payload as any).requestId).toBe(requestId);

	socket1.serverSend({
		action: 'list-sessions:response',
		payload: { requestId, success: true, data: { sessions: [] } },
	});
	await expect(p).resolves.toEqual({ sessions: [] });
});

test('disconnect stops reconnecting and fails in-flight requests', async () => {
	const core = makeCore();
	const socket = MockWebSocket.instances[0]!;
	socket.accept();
	const p = core.http('list-sessions', { namespace: 'ns1' });
	core.disconnect();
	await expect(p).rejects.toThrow('WebSocket disconnected');
	socket.serverClose();
	await tick(15);
	expect(MockWebSocket.instances.length).toBe(1); // no reconnect after disconnect
});
