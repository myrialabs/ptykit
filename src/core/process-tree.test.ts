/**
 * Closing a session ends everything its shell started, over a REAL bun-pty
 * shell. Before 0.1.1 none of these survived-cases were handled: the shell
 * itself outlived `killSession` (its pending SIGKILL was cancelled by the
 * immediate dispose), and so did its background job, a `setsid()` child and a
 * program that ignores SIGHUP.
 */

import { afterEach, expect, test } from 'bun:test';
import { PtyKitManager } from './pty-kit.js';
import { collectProcessTree, isAlive } from './process-tree.js';

const POSIX = process.platform !== 'win32';
const managers: PtyKitManager[] = [];
afterEach(() => {
	while (managers.length) managers.pop()!.dispose();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pids of `sleep <seconds>` processes, found by their unusual argument. */
function sleepers(seconds: number[]): number[] {
	const out = new TextDecoder().decode(Bun.spawnSync(['ps', '-A', '-o', 'pid=,command=']).stdout);
	return out
		.split('\n')
		.filter((line) => seconds.some((s) => new RegExp(`(^|/)sleep ${s}$`).test(line.trim().split(/\s+/).slice(1).join(' '))))
		.map((line) => Number(line.trim().split(/\s+/)[0]));
}

test.skipIf(!POSIX)('collectProcessTree finds descendants in other process groups and sessions', async () => {
	const tag = 7000 + Math.floor(Math.random() * 900);
	// A child that starts a detached (setsid) grandchild, then waits.
	const child = Bun.spawn(['bun', '-e', `Bun.spawn(['sleep', '${tag}'], { detached: true, stdio: ['ignore','ignore','ignore'] }); setInterval(() => {}, 1000);`]);
	try {
		let grandchild: number[] = [];
		for (let i = 0; i < 50 && grandchild.length === 0; i++) {
			await sleep(100);
			grandchild = sleepers([tag]);
		}
		expect(grandchild).toHaveLength(1);
		expect(collectProcessTree(child.pid)).toContain(grandchild[0]);
	} finally {
		for (const pid of sleepers([tag])) process.kill(pid, 'SIGKILL');
		child.kill('SIGKILL');
	}
});

test.skipIf(!POSIX)('killSession ends the shell and everything it started', async () => {
	const base = 8000 + Math.floor(Math.random() * 900);
	const [bg, detached, stubborn] = [base, base + 1, base + 2];
	const manager = new PtyKitManager({ killGraceMs: 300, retainExitedMs: null });
	managers.push(manager);
	const session = await manager.createSession({ sessionId: 'tree', namespace: 'tree', cwd: '/tmp', shell: '/bin/sh' });
	const shellPid = session.pid;
	await sleep(400);

	manager.write('tree', `sleep ${bg} &\n`);
	manager.write('tree', `perl -MPOSIX -e 'POSIX::setsid(); exec "sleep", ${detached}' &\n`);
	manager.write('tree', `perl -e '$SIG{HUP}="IGNORE"; $SIG{INT}="IGNORE"; $SIG{TERM}="IGNORE"; exec "sleep", ${stubborn}'\n`);

	let started: number[] = [];
	for (let i = 0; i < 50 && started.length < 3; i++) {
		await sleep(100);
		started = sleepers([bg, detached, stubborn]);
	}
	expect(started).toHaveLength(3);

	try {
		manager.killSession('tree');
		// Ctrl+C, then SIGHUP/SIGTERM after one grace, then SIGKILL after another.
		for (let i = 0; i < 40 && (sleepers([bg, detached, stubborn]).length > 0 || isAlive(shellPid)); i++) await sleep(100);
		expect(sleepers([bg, detached, stubborn])).toEqual([]);
		expect(isAlive(shellPid)).toBe(false);
	} finally {
		for (const pid of sleepers([bg, detached, stubborn])) process.kill(pid, 'SIGKILL');
		if (isAlive(shellPid)) process.kill(shellPid, 'SIGKILL');
	}
});
