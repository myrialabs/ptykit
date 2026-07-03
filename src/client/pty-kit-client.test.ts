import { beforeEach, expect, test } from 'bun:test';
import { PtyKitClient } from './pty-kit-client.js';
import { MockWebSocket, mockFactory, respondTo, tick } from './fake-socket.js';

beforeEach(() => MockWebSocket.reset());

function makeClient() {
	const client = new PtyKitClient({
		url: 'ws://test/pty',
		namespace: 'ns1',
		reconnect: { baseDelayMs: 5, maxDelayMs: 10 },
		WebSocketImpl: mockFactory(),
	});
	return client;
}

async function attach(client: PtyKitClient, sessionId: string) {
	const socket = MockWebSocket.instances[0]!;
	socket.accept();
	const p = client.attach(sessionId);
	await tick(0);
	respondTo(socket, 'create-session', { sessionId, streamId: `${sessionId}-s`, pid: 1, currentDirectory: '/tmp', cols: 80, rows: 24 });
	return { session: await p, socket };
}

test('attach sends create-session and resolves a session', async () => {
	const client = makeClient();
	const { session, socket } = await attach(client, 's1');
	expect(session.sessionId).toBe('s1');
	const frame = socket.lastFrame('create-session');
	expect((frame!.payload as any).data.namespace).toBe('ns1');
});

test('onSessionCreated/onSessionClosed surface room tab events (not filtered by local sessions)', async () => {
	const client = makeClient();
	const { socket } = await attach(client, 's1');
	const created: string[] = [];
	const closed: string[] = [];
	client.onSessionCreated((e) => created.push(e.sessionId));
	client.onSessionClosed((e) => closed.push(e.sessionId));

	// A session opened by another client in the room — this client never attached it.
	socket.serverSend({
		action: 'session-created',
		payload: { sessionId: 's2', namespace: 'ns1', streamId: 's2-s', pid: 2, currentDirectory: '/tmp', cols: 80, rows: 24 },
	});
	socket.serverSend({ action: 'session-closed', payload: { sessionId: 's2', namespace: 'ns1' } });

	expect(created).toEqual(['s2']);
	expect(closed).toEqual(['s2']);
});

test('onData dedups live output by seq (R5)', async () => {
	const client = makeClient();
	const { session, socket } = await attach(client, 's1');
	const got: string[] = [];
	session.onData((c) => got.push(c));

	socket.serverSend({ action: 'output', payload: { sessionId: 's1', content: 'a', seq: 1 } });
	socket.serverSend({ action: 'output', payload: { sessionId: 's1', content: 'a', seq: 1 } }); // dup
	socket.serverSend({ action: 'output', payload: { sessionId: 's1', content: 'b', seq: 2 } });
	expect(got).toEqual(['a', 'b']);
});

test('replay frames (no seq) are stripped of report-requests (R17)', async () => {
	const client = makeClient();
	const { session, socket } = await attach(client, 's1');
	const got: string[] = [];
	session.onData((c) => got.push(c));

	// no seq → replay → stripReportRequests applied
	socket.serverSend({ action: 'output', payload: { sessionId: 's1', content: 'prompt\x1b[6n$ ' } });
	expect(got).toEqual(['prompt$ ']);
});

test('routes output only to the matching session', async () => {
	const client = makeClient();
	const { session, socket } = await attach(client, 's1');
	const otherP = client.attach('s2');
	await tick(0);
	respondTo(socket, 'create-session', { sessionId: 's2', streamId: 's2-s', pid: 2, currentDirectory: '/tmp', cols: 80, rows: 24 });
	const other = await otherP;

	const a: string[] = [];
	const b: string[] = [];
	session.onData((c) => a.push(c));
	other.onData((c) => b.push(c));

	socket.serverSend({ action: 'output', payload: { sessionId: 's1', content: 'for-a', seq: 1 } });
	socket.serverSend({ action: 'output', payload: { sessionId: 's2', content: 'for-b', seq: 1 } });
	expect(a).toEqual(['for-a']);
	expect(b).toEqual(['for-b']);
});

test('write forwards raw keystrokes via input event (R16)', async () => {
	const client = makeClient();
	const { session, socket } = await attach(client, 's1');
	session.write('ls\r');
	const frame = socket.lastFrame('input');
	expect((frame!.payload as any)).toEqual({ sessionId: 's1', data: 'ls\r' });
});

test('exit event is delivered to the session', async () => {
	const client = makeClient();
	const { session, socket } = await attach(client, 's1');
	let code = -1;
	session.onExit((c) => (code = c));
	socket.serverSend({ action: 'exit', payload: { sessionId: 's1', exitCode: 0 } });
	expect(code).toBe(0);
});

test('re-attaches known sessions on reconnect (R7/R14)', async () => {
	const client = makeClient();
	const { socket } = await attach(client, 's1');

	socket.serverClose();
	await tick(15);
	const socket1 = MockWebSocket.instances[1]!;
	socket1.accept(); // onReconnect → reattachAll
	await tick(0);
	expect(socket1.lastFrame('create-session')).toBeDefined();
	expect((socket1.lastFrame('create-session')!.payload as any).data.sessionId).toBe('s1');
});

test('buffers output that arrives before the first onData, then flushes (reattach replay)', async () => {
	const client = makeClient();
	const { session, socket } = await attach(client, 's1');
	// Output arrives BEFORE the caller subscribes (e.g. unicast replay frame).
	socket.serverSend({ action: 'output', payload: { sessionId: 's1', content: 'replayed screen' } });

	const got: string[] = [];
	session.onData((c) => got.push(c)); // late subscribe must still receive it
	expect(got).toEqual(['replayed screen']);
});

test('onStatus fires immediately with current status', () => {
	const client = makeClient();
	const seen: string[] = [];
	client.onStatus((s) => seen.push(s));
	expect(seen.length).toBe(1); // immediate call
});
