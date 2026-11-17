import { expect, test } from 'bun:test';
import { Session } from './session.js';
import { FakeBackend, SpyBufferStore, flushMicrotasks } from './fake-backend.js';

function makeSession(overrides: Partial<ConstructorParameters<typeof Session>[0]> = {}) {
	const backend = new FakeBackend();
	const buffers = new SpyBufferStore();
	const session = new Session({
		sessionId: 's1',
		namespace: 'ns1',
		streamId: 's1-stream',
		cwd: '/tmp',
		cols: 80,
		rows: 24,
		backend,
		buffers,
		idleFallbackMs: 1_000_000, // disabled unless a test wants it
		killGraceMs: 5,
		...overrides,
	});
	return { backend, buffers, session, handle: backend.last };
}

test('spawns the resolved shell with the requested size', () => {
	const { handle } = makeSession();
	expect(handle.spawnOptions.cols).toBe(80);
	expect(handle.spawnOptions.rows).toBe(24);
	expect(handle.spawnOptions.env.TERM).toBe('xterm-256color');
});

test('persists output to scrollback FIRST, even with zero listeners (R7a)', () => {
	const { buffers, handle } = makeSession();
	handle.emitData('no listeners yet');
	expect(buffers.writes).toEqual([['s1', 'no listeners yet']]);
});

test('micro-task batches output and stamps a monotonic seq (R5)', async () => {
	const { session, handle } = makeSession();
	const got: Array<[string, number]> = [];
	session.addDataListener((data, seq) => got.push([data, seq]));

	handle.emitData('a');
	handle.emitData('b');
	handle.emitData('c');
	expect(got).toEqual([]); // not flushed synchronously

	await flushMicrotasks();
	expect(got).toEqual([['abc', 1]]); // one batched flush, seq=1

	handle.emitData('d');
	await flushMicrotasks();
	expect(got).toEqual([
		['abc', 1],
		['d', 2],
	]);
});

test('fans out to multiple listeners (R5)', async () => {
	const { session, handle } = makeSession();
	const a: string[] = [];
	const b: string[] = [];
	session.addDataListener((d) => a.push(d));
	session.addDataListener((d) => b.push(d));
	handle.emitData('shared');
	await flushMicrotasks();
	expect(a).toEqual(['shared']);
	expect(b).toEqual(['shared']);
});

test('clearListeners drops all listeners (R7c)', async () => {
	const { session, handle } = makeSession();
	const seen: string[] = [];
	session.addDataListener((d) => seen.push(d));
	session.clearListeners();
	handle.emitData('after clear');
	await flushMicrotasks();
	expect(seen).toEqual([]);
});

test('idle fallback sends \\r only when the PTY stays silent (R18)', async () => {
	const { handle } = makeSession({ idleFallbackMs: 5 });
	await new Promise((r) => setTimeout(r, 20));
	expect(handle.writes).toContain('\r');
});

test('idle fallback is suppressed once output arrives (R18)', async () => {
	const { handle } = makeSession({ idleFallbackMs: 5 });
	handle.emitData('prompt$ ');
	await new Promise((r) => setTimeout(r, 20));
	expect(handle.writes).not.toContain('\r');
});

test('kill: Ctrl+C, then SIGHUP after the grace window, then SIGKILL (R19)', async () => {
	const { handle, session } = makeSession({ killGraceMs: 10 });
	session.kill();
	expect(handle.writes).toContain('\x03');
	expect(handle.kills).toEqual([]);
	await new Promise((r) => setTimeout(r, 15));
	expect(handle.kills).toEqual(['SIGHUP']);
	await new Promise((r) => setTimeout(r, 15));
	expect(handle.kills).toEqual(['SIGHUP', 'SIGKILL']);
});

test('kill completes even when the session is disposed right after (R19)', async () => {
	// killSession disposes at once; that used to cancel the pending SIGKILL, so
	// a closed tab left its shell running.
	const { handle, session } = makeSession({ killGraceMs: 5 });
	session.kill();
	session.dispose();
	await new Promise((r) => setTimeout(r, 25));
	expect(handle.kills).toEqual(['SIGHUP', 'SIGKILL']);
});

test('kill stops escalating once the shell exits (R19)', async () => {
	const { handle, session } = makeSession({ killGraceMs: 5 });
	session.kill();
	await new Promise((r) => setTimeout(r, 8));
	handle.emitExit(129);
	await new Promise((r) => setTimeout(r, 15));
	expect(handle.kills).toEqual(['SIGHUP']);
});

test('kill with explicit signal goes direct (R19)', () => {
	const { handle, session } = makeSession();
	session.kill('SIGKILL');
	expect(handle.kills).toEqual(['SIGKILL']);
	expect(handle.writes).not.toContain('\x03');
});

test('kill ends every process the backend reports for the shell (R19)', async () => {
	const children = [Bun.spawn(['sleep', '30']), Bun.spawn(['sleep', '31'])];
	const backend = new FakeBackend();
	backend.collectProcessTree = () => children.map((c) => c.pid);
	const session = new Session({
		sessionId: 's-tree',
		namespace: 'ns1',
		streamId: 's-tree-stream',
		cwd: '/tmp',
		cols: 80,
		rows: 24,
		backend,
		buffers: new SpyBufferStore(),
		idleFallbackMs: 1_000_000,
		killGraceMs: 5,
	});
	session.kill();
	session.dispose();
	const codes = await Promise.all(children.map((c) => c.exited));
	expect(children.every((c) => c.signalCode === 'SIGTERM' || c.signalCode === 'SIGKILL')).toBe(true);
	expect(codes).toHaveLength(2);
});

test('write/resize/cancel become no-ops after exit', () => {
	const { handle, session } = makeSession();
	handle.emitExit(0);
	expect(session.status).toBe('exited');
	expect(session.write('x')).toBe(false);
	expect(session.resize(10, 10)).toBe(false);
});

test('resize keeps scrollback in sync with the PTY (R15)', () => {
	const { handle, buffers, session } = makeSession();
	session.resize(120, 40);
	expect(handle.resizes).toEqual([[120, 40]]);
	expect(buffers.resizes).toEqual([['s1', 120, 40]]);
});

test('outputCoalesceMs sends the first chunk at once and holds a flood to one flush per window', async () => {
	const { session, handle } = makeSession({ outputCoalesceMs: 40 });
	const got: Array<[string, number]> = [];
	session.addDataListener((data, seq) => got.push([data, seq]));

	handle.emitData('first');
	await flushMicrotasks();
	expect(got).toEqual([['first', 1]]); // a quiet spell → no delay (typing echo)

	handle.emitData('a');
	handle.emitData('b');
	await flushMicrotasks();
	expect(got).toHaveLength(1); // within the window → held

	await new Promise((r) => setTimeout(r, 60));
	expect(got).toEqual([
		['first', 1],
		['ab', 2],
	]);
});

test('outputCoalesceMs flushes held output before the exit is reported', async () => {
	const { session, handle } = makeSession({ outputCoalesceMs: 1000 });
	const order: string[] = [];
	session.addDataListener((data) => order.push(`data:${data}`));
	session.addExitListener(() => order.push('exit'));

	handle.emitData('one');
	await flushMicrotasks();
	handle.emitData('two'); // held by the window
	handle.emitExit(0);
	expect(order).toEqual(['data:one', 'data:two', 'exit']);
});
