/**
 * End-to-end integration over a REAL bun-pty shell and real WebSockets:
 * create → input → output → disconnect → reattach.
 *
 * Runs under `bun test` (Bun → bun-pty, the tested backend). Uses generous
 * waits because a real shell's prompt/echo timing is not deterministic.
 */

import { afterEach, expect, test } from 'bun:test';
import { PtyKit } from './core/pty-kit.js';
import { createPtyKitServer } from './server/pty-kit-server.js';
import { PtyKitClient } from './client/pty-kit-client.js';

interface Live {
	port: number;
	manager: PtyKit;
	stop: () => void;
}
const lives: Live[] = [];

function startReal(): Live {
	const manager = new PtyKit({ retainExitedMs: 60_000 });
	const server = createPtyKitServer(manager, { path: '/pty' });
	const bun = Bun.serve({ port: 0, fetch: server.fetch, websocket: server.websocket });
	const live: Live = { port: bun.port, manager, stop: () => bun.stop(true) };
	lives.push(live);
	return live;
}

afterEach(() => {
	let l: Live | undefined;
	while ((l = lives.pop())) {
		l.manager.dispose();
		l.stop();
	}
});

/** Accumulate output for a session until it contains `needle` or times out. */
function collectUntil(session: { onData(cb: (c: string) => void): () => void }, needle: string, timeout = 5000) {
	return new Promise<string>((resolve, reject) => {
		let buf = '';
		let off: () => void = () => {};
		let done = false;
		const finish = (fn: () => void) => {
			if (done) return;
			done = true;
			clearTimeout(t);
			off();
			fn();
		};
		const t = setTimeout(
			() => finish(() => reject(new Error(`timeout waiting for "${needle}"; got: ${JSON.stringify(buf.slice(-200))}`))),
			timeout,
		);
		// onData may flush buffered replay synchronously, so `off` is assigned
		// after the first delivery — guard with `done` and the noop default.
		off = session.onData((c) => {
			buf += c;
			if (buf.includes(needle)) finish(() => resolve(buf));
		});
		if (done) off();
	});
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('real bun-pty: create, run a command, see its output (R1/R5/R11)', async () => {
	const live = startReal();
	const client = new PtyKitClient({ url: `ws://localhost:${live.port}/pty`, namespace: 'ns1' });
	const session = await client.create({ sessionId: 'e2e-1', cols: 80, rows: 24 });

	const pending = collectUntil(session, 'PTYKIT_E2E_OK');
	await wait(150); // let the shell paint its first prompt
	session.write('echo PTYKIT_E2E_OK\r');
	const out = await pending;
	expect(out).toContain('PTYKIT_E2E_OK');

	client.disconnect();
}, 10_000);

test('real bun-pty: reattach replays scrollback and input keeps working (R6/R7/Point 8)', async () => {
	const live = startReal();

	// First client runs a command, then disconnects.
	const c1 = new PtyKitClient({ url: `ws://localhost:${live.port}/pty`, namespace: 'ns1' });
	const s1 = await c1.create({ sessionId: 'e2e-2', cols: 80, rows: 24 });
	const seen1 = collectUntil(s1, 'MARKER_BEFORE');
	await wait(150);
	s1.write('echo MARKER_BEFORE\r');
	await seen1;
	await wait(200); // let headless xterm parse before we reattach
	c1.disconnect();

	// Second client attaches to the same session — must see the replayed marker.
	const c2 = new PtyKitClient({ url: `ws://localhost:${live.port}/pty`, namespace: 'ns1' });
	const s2 = await c2.attach('e2e-2');
	const replay = collectUntil(s2, 'MARKER_BEFORE', 5000);
	expect(await replay).toContain('MARKER_BEFORE');

	// Input still works after reattach.
	const after = collectUntil(s2, 'MARKER_AFTER');
	s2.write('echo MARKER_AFTER\r');
	expect(await after).toContain('MARKER_AFTER');

	c2.disconnect();
}, 15_000);
