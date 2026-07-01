import { expect, test } from 'bun:test';
import { hostSocket, type HostSocketHandle } from './host-socket.js';
import type { WireFrame } from '../shared/index.js';

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

/** A controllable fake host transport. */
function makeHost() {
	let open = false;
	const frameSubs = new Set<(f: WireFrame) => void>();
	const statusSubs = new Set<(o: boolean) => void>();
	const sent: WireFrame[] = [];
	const handle: HostSocketHandle = {
		send: (f) => sent.push(f),
		subscribe: (cb) => {
			frameSubs.add(cb);
			return () => frameSubs.delete(cb);
		},
		isOpen: () => open,
		onStatusChange: (cb) => {
			statusSubs.add(cb);
			return () => statusSubs.delete(cb);
		},
	};
	return {
		handle,
		sent,
		setOpen(v: boolean) {
			open = v;
			for (const cb of statusSubs) cb(v);
		},
		deliver(frame: WireFrame) {
			for (const cb of frameSubs) cb(frame);
		},
		frameSubCount: () => frameSubs.size,
		statusSubCount: () => statusSubs.size,
	};
}

test('hostSocket: opens on microtask when host already up (first connect)', async () => {
	const host = makeHost();
	host.setOpen(true);
	const socket = hostSocket(host.handle)('ignored-url');

	let opened = false;
	socket.onopen = () => (opened = true);
	expect(opened).toBe(false); // not synchronous
	await flush();
	expect(opened).toBe(true);
	expect(socket.readyState).toBe(1);
});

test('hostSocket: send() forwards a structured frame to the host', async () => {
	const host = makeHost();
	host.setOpen(true);
	const socket = hostSocket(host.handle)('');
	socket.send(JSON.stringify({ action: 'input', payload: { sessionId: 's', data: 'x' } }));
	expect(host.sent).toHaveLength(1);
	expect(host.sent[0]).toEqual({ action: 'input', payload: { sessionId: 's', data: 'x' } });
});

test('hostSocket: host frames arrive at onmessage as JSON strings', async () => {
	const host = makeHost();
	host.setOpen(true);
	const socket = hostSocket(host.handle)('');
	const seen: string[] = [];
	socket.onmessage = (ev) => seen.push(String(ev.data));
	host.deliver({ action: 'output', payload: { sessionId: 's', content: 'hi', seq: 1 } });
	expect(seen).toHaveLength(1);
	expect(JSON.parse(seen[0]!)).toEqual({ action: 'output', payload: { sessionId: 's', content: 'hi', seq: 1 } });
});

test('hostSocket: a real drop after open fires onclose and unsubscribes', async () => {
	const host = makeHost();
	host.setOpen(true);
	const socket = hostSocket(host.handle)('');
	let opened = false;
	let closed = false;
	socket.onopen = () => (opened = true);
	socket.onclose = () => (closed = true);
	await flush();
	expect(opened).toBe(true);

	host.setOpen(false);
	expect(closed).toBe(true);
	expect(socket.readyState).toBe(3);
	// inert after close: no leaked subscriptions
	expect(host.frameSubCount()).toBe(0);
	expect(host.statusSubCount()).toBe(0);
});

test('hostSocket: created while host down stays pending (no onclose spin), opens on recover', async () => {
	const host = makeHost(); // host down
	const socket = hostSocket(host.handle)('');
	let opened = false;
	let closeCount = 0;
	socket.onopen = () => (opened = true);
	socket.onclose = () => closeCount++;
	await flush();
	// Pending: neither opened nor closed while merely waiting for the host.
	expect(opened).toBe(false);
	expect(closeCount).toBe(0);

	host.setOpen(true);
	expect(opened).toBe(true);
	expect(closeCount).toBe(0);
});

test('hostSocket: explicit close() is inert and unsubscribes without onclose', async () => {
	const host = makeHost();
	host.setOpen(true);
	const socket = hostSocket(host.handle)('');
	let closed = false;
	socket.onclose = () => (closed = true);
	socket.close();
	expect(closed).toBe(false); // close() does not synthesize an onclose
	expect(host.frameSubCount()).toBe(0);
	expect(host.statusSubCount()).toBe(0);
	expect(socket.readyState).toBe(3);
});
