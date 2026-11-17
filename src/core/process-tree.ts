/**
 * The processes a terminal session started, and ending them with it.
 *
 * Killing only the shell leaves everything it started running: a job sent to
 * the background (`cmd &`) sits in its own process group, a program that
 * called `setsid()` (a dev server's supervisor, a daemon) is in its own
 * session, and one that ignores SIGHUP survives the terminal closing. So the
 * tree is collected BEFORE the shell is signalled — once the shell is gone its
 * children are re-parented and can no longer be found by parent id — from two
 * sources: every descendant of the shell by parent id, and every process still
 * attached to the session's terminal.
 *
 * POSIX reads `ps` (or `/proc` where `ps` lacks the needed columns). Windows has
 * no process groups or signals to speak of; `taskkill /T` walks the tree there.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

interface ProcessRow {
	pid: number;
	ppid: number;
	/** Controlling terminal; null when the process has none. */
	tty: string | null;
}

const IS_WINDOWS = process.platform === 'win32';

function readPs(): ProcessRow[] {
	const output = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,tty='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	const rows: ProcessRow[] = [];
	for (const line of output.split('\n')) {
		const [pid, ppid, tty] = line.trim().split(/\s+/);
		if (!pid || !ppid) continue;
		rows.push({ pid: Number(pid), ppid: Number(ppid), tty: tty && tty !== '?' && tty !== '??' && tty !== '-' ? tty : null });
	}
	return rows;
}

/** Linux without a full `ps` (e.g. BusyBox): the same columns from /proc. */
function readProc(): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const entry of readdirSync('/proc')) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
			// Fields after the parenthesised command: state ppid pgrp session tty_nr …
			const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
			const ttyNr = Number(fields[4]);
			rows.push({ pid: Number(entry), ppid: Number(fields[1]), tty: ttyNr > 0 ? String(ttyNr) : null });
		} catch {
			// The process exited while we read.
		}
	}
	return rows;
}

function readProcessTable(): ProcessRow[] {
	try {
		return readPs();
	} catch {
		if (process.platform === 'linux') {
			try {
				return readProc();
			} catch {
				/* fall through */
			}
		}
		return [];
	}
}

/**
 * Every process started from the terminal whose shell is `rootPid` — its
 * descendants, and anything still attached to its terminal — excluding the
 * shell itself. Empty on Windows (see `killTreeWindows`) or when the process
 * table cannot be read.
 */
export function collectProcessTree(rootPid: number): number[] {
	if (IS_WINDOWS || !Number.isInteger(rootPid) || rootPid <= 0) return [];
	const rows = readProcessTable();
	const children = new Map<number, number[]>();
	for (const row of rows) {
		const list = children.get(row.ppid);
		if (list) list.push(row.pid);
		else children.set(row.ppid, [row.pid]);
	}

	const found = new Set<number>();
	const queue = [rootPid];
	while (queue.length > 0) {
		const pid = queue.pop()!;
		for (const child of children.get(pid) ?? []) {
			if (found.has(child) || child === rootPid) continue;
			found.add(child);
			queue.push(child);
		}
	}

	const tty = rows.find((row) => row.pid === rootPid)?.tty;
	if (tty) {
		for (const row of rows) {
			if (row.tty === tty && row.pid !== rootPid && row.pid !== process.pid) found.add(row.pid);
		}
	}
	found.delete(process.pid);
	return [...found];
}

/** Whether `pid` still exists (a process we may not signal counts as existing). */
export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Send `signal` to each pid; returns the ones that were still there. */
export function signalAll(pids: number[], signal: NodeJS.Signals): number[] {
	const signalled: number[] = [];
	for (const pid of pids) {
		try {
			process.kill(pid, signal);
			signalled.push(pid);
		} catch {
			// Already gone.
		}
	}
	return signalled;
}

/** Windows: end a process and everything below it. */
export function killTreeWindows(pid: number): void {
	try {
		execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
	} catch {
		// Already gone.
	}
}
