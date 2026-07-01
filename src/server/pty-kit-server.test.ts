import { afterEach, expect, test } from 'bun:test';
import http from 'node:http';
import { PtyKitManager } from '../core/pty-kit.js';
import { FakeBackend, flushMicrotasks } from '../core/fake-backend.js';
import { createPtyKitServer, type AuthorizeHook } from './pty-kit-server.js';
import type { WireFrame } from '../shared/index.js';

// ---- Test harness: real Bun WebSocket server + client ----------------------

interface Harness {
	port: number;
	backend: FakeBackend;
	manager: PtyKitManager;
	stop: () => void;
}

const harnesses: Harness[] = [];

function startServer(authorize?: AuthorizeHook): Harness {
	const backend = new FakeBackend();
	const manager = new PtyKitManager({ backend, idleFallbackMs: 1_000_000, killGraceMs: 5 });
	const server = createPtyKitServer(manager, {
		path: '/pty',
		authorize,
		onUpgrade: (request: Request) => {
			const user = new URL(request.url).searchParams.get('user') ?? 'anon';
			return { user };
		},
	});
	const bun = Bun.serve({ port: 0, fetch: server.fetch, websocket: server.websocket });
	const h: Harness = {
		port: bun.port,
		backend,
		manager,
		stop: () => bun.stop(true),
	};
	harnesses.push(h);
	return h;
}

afterEach(() => {
	let h: Harness | undefined;
	while ((h = harnesses.pop())) {
		h.manager.dispose();
		h.stop();
	}
});

class TestClient {
	private ws: WebSocket;
	readonly events: Array<{ action: string; payload: any }> = [];
	private waiters: Array<{ action: string; resolve: (p: any) => void }> = [];

	constructor(port: number, user = 'anon') {
		this.ws = new WebSocket(`ws://localhost:${port}/pty?user=${user}`);
		this.ws.onmessage = (e) => {
			const frame = JSON.parse(String(e.data));
			this.events.push(frame);
			this.waiters = this.waiters.filter((w) => {
				if (w.action === frame.action) {
					w.resolve(frame.payload);
					return false;
				}
				return true;
			});
		};
	}

	open(): Promise<void> {
		if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
		return new Promise((resolve, reject) => {
			this.ws.onopen = () => resolve();
			this.ws.onerror = () => reject(new Error('ws error'));
		});
	}

	waitFor(action: string, timeout = 1000): Promise<any> {
		const existing = this.events.find((e) => e.action === action);
		if (existing) return Promise.resolve(existing.payload);
		return new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(new Error(`timeout waiting for ${action}`)), timeout);
			this.waiters.push({
				action,
				resolve: (p) => {
					clearTimeout(t);
					resolve(p);
				},
			});
		});
	}

	rpc(action: string, data: any, timeout = 1000): Promise<any> {
		const requestId = `req-${Math.random().toString(36).slice(2)}`;
		const p = new Promise<any>((resolve, reject) => {
			const t = setTimeout(() => reject(new Error(`rpc timeout ${action}`)), timeout);
			const handler = (frame: { action: string; payload: any }) => {
				if (frame.action === `${action}:response` && frame.payload?.requestId === requestId) {
					clearTimeout(t);
					if (frame.payload.success) resolve(frame.payload.data);
					else reject(new Error(frame.payload.error));
					return true;
				}
				return false;
			};
			// poll existing + register
			const idx = this.events.findIndex((e) => handler(e));
			if (idx >= 0) return;
			this.waiters.push({
				action: `${action}:response`,
				resolve: (payload) => {
					if (payload?.requestId === requestId) {
						clearTimeout(t);
						if (payload.success) resolve(payload.data);
						else reject(new Error(payload.error));
					}
				},
			});
		});
		this.ws.send(JSON.stringify({ action, payload: { requestId, data } }));
		return p;
	}

	emit(action: string, payload: any): void {
		this.ws.send(JSON.stringify({ action, payload }));
	}

	close(): void {
		this.ws.close();
	}
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ---- Tests -----------------------------------------------------------------

test('create-session returns session info and broadcasts ready/tab-created', async () => {
	const h = startServer();
	const c = new TestClient(h.port);
	await c.open();

	const res = await c.rpc('create-session', { sessionId: 's1', namespace: 'ns1' });
	expect(res.sessionId).toBe('s1');
	expect(typeof res.pid).toBe('number');
	expect(res.cols).toBe(80);

	const ready = await c.waitFor('ready');
	expect(ready.sessionId).toBe('s1');
	const tab = await c.waitFor('tab-created');
	expect(tab.sessionId).toBe('s1');
});

test('input is forwarded to the PTY (R16)', async () => {
	const h = startServer();
	const c = new TestClient(h.port);
	await c.open();
	await c.rpc('create-session', { sessionId: 's1', namespace: 'ns1' });

	c.emit('input', { sessionId: 's1', data: 'echo hi\r' });
	await tick();
	expect(h.backend.last.writes).toContain('echo hi\r');
});

test('output broadcasts to the room with a seq (R5/R11)', async () => {
	const h = startServer();
	const c = new TestClient(h.port);
	await c.open();
	await c.rpc('create-session', { sessionId: 's1', namespace: 'ns1' });

	h.backend.last.emitData('rendered output');
	const out = await c.waitFor('output');
	expect(out.content).toBe('rendered output');
	expect(out.seq).toBe(1);
});

test('two clients attached to one session both receive output (collaborative R11)', async () => {
	const h = startServer();
	const a = new TestClient(h.port, 'alice');
	const b = new TestClient(h.port, 'bob');
	await Promise.all([a.open(), b.open()]);

	await a.rpc('create-session', { sessionId: 's1', namespace: 'ns1' });
	await b.rpc('create-session', { sessionId: 's1', namespace: 'ns1' }); // idempotent attach
	// only one PTY spawned for the shared session
	expect(h.backend.handles.length).toBe(1);

	h.backend.last.emitData('shared frame');
	const [oa, ob] = await Promise.all([a.waitFor('output'), b.waitFor('output')]);
	expect(oa.content).toBe('shared frame');
	expect(ob.content).toBe('shared frame');
});

test('authorize denial rejects create-session', async () => {
	const authorize: AuthorizeHook = ({ namespace }) => namespace === 'allowed';
	const h = startServer(authorize);
	const c = new TestClient(h.port);
	await c.open();

	await expect(c.rpc('create-session', { sessionId: 's1', namespace: 'forbidden' })).rejects.toThrow(
		'Access denied',
	);
	expect(h.backend.handles.length).toBe(0);
});

test('anti-hijack: input to a session in another namespace is dropped (R10)', async () => {
	// The hook authorizes alice for ns1 only; bob for anything.
	const authorize: AuthorizeHook = ({ namespace, conn }) =>
		conn.data.user === 'alice' ? namespace === 'ns1' : true;
	const h = startServer(authorize);

	const alice = new TestClient(h.port, 'alice');
	const bob = new TestClient(h.port, 'bob');
	await Promise.all([alice.open(), bob.open()]);

	// bob owns s2 in ns2.
	await bob.rpc('create-session', { sessionId: 's2', namespace: 'ns2' });
	const s2 = h.backend.handles[0]!; // the only spawned PTY
	const writesBefore = s2.writes.length;

	// alice (authorized only for ns1) tries to write into ns2's session.
	alice.emit('input', { sessionId: 's2', data: 'pwn' });
	await tick();

	// The PTY must not have received alice's input — the namespace is derived
	// from the session and the hook denied her.
	expect(s2.writes.length).toBe(writesBefore);
});

test('kill-session broadcasts tab-closed and removes the session', async () => {
	const h = startServer();
	const c = new TestClient(h.port);
	await c.open();
	await c.rpc('create-session', { sessionId: 's1', namespace: 'ns1' });

	const res = await c.rpc('kill-session', { sessionId: 's1' });
	expect(res.sessionId).toBe('s1');
	const closed = await c.waitFor('tab-closed');
	expect(closed.sessionId).toBe('s1');
	expect(h.manager.getSession('s1')).toBeUndefined();
});

test('list-sessions returns sessions in the namespace', async () => {
	const h = startServer();
	const c = new TestClient(h.port);
	await c.open();
	await c.rpc('create-session', { sessionId: 'a', namespace: 'ns1' });
	await c.rpc('create-session', { sessionId: 'b', namespace: 'ns1' });

	const res = await c.rpc('list-sessions', { namespace: 'ns1' });
	expect(res.sessions.map((s: any) => s.sessionId).sort()).toEqual(['a', 'b']);
});

test('reconnect replays serialized state', async () => {
	const h = startServer();
	const c = new TestClient(h.port);
	await c.open();
	await c.rpc('create-session', { sessionId: 's1', namespace: 'ns1' });
	h.backend.last.emitData('persisted line');
	await tick(40); // let headless xterm parse

	const res = await c.rpc('reconnect', { sessionId: 's1' });
	expect(res.status).toBe('active');
	expect(res.output).toContain('persisted line');
});

test('check-shell reports platform shell availability', async () => {
	const h = startServer();
	const c = new TestClient(h.port);
	await c.open();
	const res = await c.rpc('check-shell', {});
	expect(res.available).toBe(true);
	expect(typeof res.shellType).toBe('string');
});

test('Node transport: attach to an http.Server and create a session over ws (R9)', async () => {
	const backend = new FakeBackend();
	const manager = new PtyKitManager({ backend, idleFallbackMs: 1_000_000 });
	const server = createPtyKitServer(manager, { path: '/pty', onUpgrade: () => ({ user: 'node' }) });
	const httpServer = http.createServer((_req, res) => res.end('ok'));
	await server.attach(httpServer);
	await new Promise<void>((r) => httpServer.listen(0, r));
	const port = (httpServer.address() as { port: number }).port;

	const c = new TestClient(port);
	await c.open();
	const res = await c.rpc('create-session', { sessionId: 'node-s1', namespace: 'ns1' });
	expect(res.sessionId).toBe('node-s1');
	const ready = await c.waitFor('ready');
	expect(ready.sessionId).toBe('node-s1');

	c.close();
	manager.dispose();
	await new Promise<void>((r) => httpServer.close(() => r()));
});

// ---- Embedded transport (bring-your-own-socket) ----------------------------

test('embedded transport: createConnection + handleFrame drive RPC create + response', async () => {
	const backend = new FakeBackend();
	const manager = new PtyKitManager({ backend, idleFallbackMs: 1_000_000, killGraceMs: 5 });
	const server = createPtyKitServer(manager); // no HTTP wiring

	const frames: WireFrame[] = [];
	const conn = server.createConnection({ data: { user: 'a' }, send: (f) => frames.push(f) });
	server.handleOpen(conn);

	await server.handleFrame(conn, {
		action: 'create-session',
		payload: { requestId: 'r1', data: { sessionId: 's1', namespace: 'proj', cols: 80, rows: 24 } },
	});

	const resp = frames.find((f) => f.action === 'create-session:response');
	expect(resp).toBeDefined();
	const payload = resp!.payload as { success: boolean; data: { sessionId: string; pid: number } };
	expect(payload.success).toBe(true);
	expect(payload.data.sessionId).toBe('s1');
	expect(payload.data.pid).toBe(backend.last.pid);

	manager.dispose();
});

test('embedded transport: session output broadcasts to the room via conn.send', async () => {
	const backend = new FakeBackend();
	const manager = new PtyKitManager({ backend, idleFallbackMs: 1_000_000, killGraceMs: 5 });
	const server = createPtyKitServer(manager, { room: (ctx) => ctx.namespace });

	const framesA: WireFrame[] = [];
	const framesB: WireFrame[] = [];
	const connA = server.createConnection({ data: { user: 'a' }, send: (f) => framesA.push(f) });
	const connB = server.createConnection({ data: { user: 'b' }, send: (f) => framesB.push(f) });
	server.handleOpen(connA);
	server.handleOpen(connB);

	// Both connections create/attach the same session → same room (namespace).
	const create = (requestId: string) =>
		server.handleFrame(connA, {
			action: 'create-session',
			payload: { requestId, data: { sessionId: 's1', namespace: 'proj', cols: 80, rows: 24 } },
		});
	await create('r1');
	await server.handleFrame(connB, {
		action: 'create-session',
		payload: { requestId: 'r2', data: { sessionId: 's1', namespace: 'proj', cols: 80, rows: 24 } },
	});

	// Drive PTY output; it should fan out to every connection in the room.
	backend.last.emitData('hello');
	await flushMicrotasks();

	const outA = framesA.find((f) => f.action === 'output');
	const outB = framesB.find((f) => f.action === 'output');
	expect(outA).toBeDefined();
	expect(outB).toBeDefined();
	expect((outA!.payload as { content: string }).content).toContain('hello');

	// handleClose removes the connection from its rooms (no throw, no further sends).
	server.handleClose(connB);
	manager.dispose();
});
