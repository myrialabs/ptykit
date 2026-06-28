import { expect, test } from 'bun:test';
import { PtyKit } from './pty-kit.js';
import { FakeBackend, flushMicrotasks } from './fake-backend.js';

function makeKit(opts: Partial<ConstructorParameters<typeof PtyKit>[0]> = {}) {
	const backend = new FakeBackend();
	const kit = new PtyKit({ backend, idleFallbackMs: 1_000_000, killGraceMs: 5, ...opts });
	return { backend, kit };
}

test('createSession is idempotent — same id reuses the live session (R3)', async () => {
	const { backend, kit } = makeKit();
	const a = await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	const b = await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	expect(a).toBe(b);
	expect(backend.handles.length).toBe(1); // no second spawn
});

test('createSession rejects an id held by another namespace (anti-hijack)', async () => {
	const { kit } = makeKit();
	await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	await expect(kit.createSession({ sessionId: 's1', namespace: 'other' })).rejects.toThrow(
		'Access denied',
	);
});

test('list returns only sessions in the namespace (R12)', async () => {
	const { kit } = makeKit();
	await kit.createSession({ sessionId: 'a', namespace: 'ns1' });
	await kit.createSession({ sessionId: 'b', namespace: 'ns1' });
	await kit.createSession({ sessionId: 'c', namespace: 'ns2' });
	expect(kit.list('ns1').map((s) => s.sessionId).sort()).toEqual(['a', 'b']);
	expect(kit.list('ns2').map((s) => s.sessionId)).toEqual(['c']);
});

test('write/resize/cancel route to the session', async () => {
	const { backend, kit } = makeKit();
	await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	expect(kit.write('s1', 'ls\r')).toBe(true);
	expect(backend.last.writes).toContain('ls\r');
	expect(kit.resize('s1', 100, 30)).toBe(true);
	expect(backend.last.resizes).toEqual([[100, 30]]);
	expect(kit.cancel('s1')).toBe(true);
	expect(backend.last.writes).toContain('\x03');
});

test('getSerializedState replays accumulated output (R6/R7)', async () => {
	const { backend, kit } = makeKit();
	await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	backend.last.emitData('hello from shell');
	await flushMicrotasks();
	await new Promise((r) => setTimeout(r, 20)); // let headless xterm parse
	expect(kit.getSerializedState('s1')).toContain('hello from shell');
});

test('killSession removes the session immediately', async () => {
	const { backend, kit } = makeKit();
	await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	expect(kit.killSession('s1')).toBe(true);
	expect(kit.getSession('s1')).toBeUndefined();
	expect(backend.last.writes).toContain('\x03');
});

test('exited session is retained then removed after retainExitedMs (R8)', async () => {
	const { backend, kit } = makeKit({ retainExitedMs: 20 });
	const session = await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	backend.last.emitExit(0);
	// Still retained right after exit — reconnect can replay.
	expect(kit.getSession('s1')).toBe(session);
	expect(session.status).toBe('exited');
	await new Promise((r) => setTimeout(r, 40));
	expect(kit.getSession('s1')).toBeUndefined();
});

test('createSession on a retained-exited id spawns a fresh process', async () => {
	const { backend, kit } = makeKit({ retainExitedMs: 10_000 });
	await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	backend.last.emitExit(0);
	const revived = await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	expect(revived.status).toBe('active');
	expect(backend.handles.length).toBe(2);
});

test('idleTtl=null keeps sessions alive indefinitely (R4)', async () => {
	const { kit } = makeKit({ idleTtl: null });
	const session = await kit.createSession({ sessionId: 's1', namespace: 'ns1' });
	// Backdate activity well past any plausible TTL.
	session.lastActivityAt = new Date(Date.now() - 60 * 60_000);
	await new Promise((r) => setTimeout(r, 30));
	expect(kit.getSession('s1')).toBe(session);
});

test('dispose kills and removes every session', async () => {
	const { backend, kit } = makeKit();
	await kit.createSession({ sessionId: 'a', namespace: 'ns1' });
	await kit.createSession({ sessionId: 'b', namespace: 'ns1' });
	kit.dispose();
	expect(kit.getSession('a')).toBeUndefined();
	expect(kit.getSession('b')).toBeUndefined();
	expect(backend.handles.every((h) => h.kills.includes('SIGKILL'))).toBe(true);
});
