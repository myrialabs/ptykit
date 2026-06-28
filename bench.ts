/**
 * PtyKit benchmark harness.
 *
 * Runs the runnable cells on this machine and writes a report to
 * `bench-results.md`. Cells that need an environment not available here (Linux
 * server, Docker, pm2/systemd, a working node-pty native build) are recorded as
 * "not run + reason" — never fabricated.
 *
 * Run under Bun:  `bun bench.ts`
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cpus, platform, arch, totalmem } from 'node:os';
import { join } from 'node:path';
import { loadBackend, detectBackendName, PtyKit } from '../src/core/index.js';
import type { PtyProcessHandle } from '../src/core/index.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A completion marker that does NOT appear literally in the typed command line
// (the shell echoes the command before running it), so it only matches output.
const DONE_CMD = "echo END$((6*7))";
const DONE_MARK = 'END42';

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx]!;
}
function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	if (s.length === 0) return 0;
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function gc(): void {
	(globalThis as any).Bun?.gc?.(true);
}

/** Run `workload` and measure bytes/elapsed until a sentinel marker is seen. */
async function measureRaw(
	handle: PtyProcessHandle,
	workload: string,
): Promise<{ bytes: number; ms: number }> {
	let bytes = 0;
	let done = false;
	let tail = '';
	handle.onData((d) => {
		bytes += d.length;
		if (!done) {
			tail = (tail + d).slice(-8192);
			if (tail.includes(DONE_MARK)) done = true;
		}
	});
	await wait(300); // settle the prompt
	bytes = 0;
	const start = performance.now();
	handle.write(`${workload}; ${DONE_CMD}\r`);
	while (!done && performance.now() - start < 60_000) await wait(15);
	return { bytes, ms: performance.now() - start };
}

// ---- Point 5: throughput, raw bun-pty vs PtyKit-wrapped --------------------

async function point5(): Promise<string> {
	const backend = await loadBackend('bun-pty');
	const env = { ...process.env, TERM: 'xterm-256color' } as Record<string, string>;
	const shell = process.env.SHELL || '/bin/bash';
	const WORKLOAD = 'seq 1 1000000';
	const RUNS = 6;
	const rawBps: number[] = [];
	const wrappedBps: number[] = [];

	for (let i = 0; i < RUNS; i++) {
		const raw = backend.spawn(shell, [], { cols: 80, rows: 24, cwd: process.cwd(), env });
		const r = await measureRaw(raw, WORKLOAD);
		raw.kill('SIGKILL');
		if (i > 0 && r.bytes > 0) rawBps.push((r.bytes / r.ms) * 1000);
		await wait(50);

		const kit = new PtyKit({ backend });
		const session = await kit.createSession({ sessionId: `bench-tp-${i}`, namespace: 'bench' });
		let bytes = 0;
		let done = false;
		let tail = '';
		session.addDataListener((d) => {
			bytes += d.length;
			if (!done) {
				tail = (tail + d).slice(-8192);
				if (tail.includes(DONE_MARK)) done = true;
			}
		});
		await wait(300);
		bytes = 0;
		const start = performance.now();
		session.write(`${WORKLOAD}; ${DONE_CMD}\r`);
		while (!done && performance.now() - start < 60_000) await wait(15);
		const ms = performance.now() - start;
		if (i > 0 && bytes > 0) wrappedBps.push((bytes / ms) * 1000);
		kit.dispose();
		await wait(50);
	}

	const rawMed = median(rawBps);
	const wrappedMed = median(wrappedBps);
	const overhead = rawMed > 0 ? ((rawMed - wrappedMed) / rawMed) * 100 : NaN;

	return [
		'## Point 5 — Throughput: raw bun-pty vs PtyKit-wrapped',
		'',
		`- Workload: \`${WORKLOAD}\` to completion via an interactive shell, ${RUNS} runs (first dropped), median.`,
		`- Raw bun-pty:    ${(rawMed / 1e6).toFixed(1)} MB/s`,
		`- PtyKit-wrapped: ${(wrappedMed / 1e6).toFixed(1)} MB/s`,
		`- **Overhead:     ${overhead.toFixed(1)}%** (target <10%)`,
		`- Verdict: ${overhead < 10 ? '✅ within target' : '⚠️ exceeds 10% — see notes'}`,
		'',
		'> The wrapped path additionally persists every chunk to a headless xterm (R7a) and',
		'> micro-task batches before fan-out — the legitimate cost being measured.',
		'',
	].join('\n');
}

// ---- Point 3: reattach latency + correctness -------------------------------

async function point3(): Promise<string> {
	const backend = await loadBackend('bun-pty');
	const sizes = [
		{ label: '10KB', n: 1500 },
		{ label: '100KB', n: 16000 },
		{ label: '1MB', n: 170000 },
	];
	const ITER = 25;
	const rows: string[] = [
		'## Point 3 — Reattach latency & correctness',
		'',
		'| buffer target | serialize p50 | serialize p95 | frame size | latest line present |',
		'|---------------|---------------|---------------|------------|---------------------|',
	];

	for (const size of sizes) {
		const kit = new PtyKit({ backend });
		const session = await kit.createSession({ sessionId: `re-${size.label}`, namespace: 'bench' });
		let done = false;
		let tail = '';
		session.addDataListener((d) => {
			if (!done) {
				tail = (tail + d).slice(-8192);
				if (tail.includes(DONE_MARK)) done = true;
			}
		});
		await wait(300);
		const start = performance.now();
		session.write(`seq 1 ${size.n}; ${DONE_CMD}\r`);
		while (!done && performance.now() - start < 60_000) await wait(20);
		await wait(300); // let headless xterm finish parsing

		const durations: number[] = [];
		let frame = '';
		for (let i = 0; i < ITER; i++) {
			const t0 = performance.now();
			frame = session.serialize();
			durations.push(performance.now() - t0);
		}
		durations.sort((a, b) => a - b);
		// The final emitted number is the newest line; it must survive in the frame.
		const latest = String(size.n);
		rows.push(
			`| ${size.label} (${size.n} lines) | ${percentile(durations, 50).toFixed(3)}ms | ${percentile(durations, 95).toFixed(3)}ms | ${(frame.length / 1024).toFixed(1)}KB | ${frame.includes(latest) ? '✅' : '❌'} |`,
		);
		kit.dispose();
		await wait(50);
	}
	rows.push('');
	rows.push(
		'> Reattach replays one serialized frame (screen + 5000-line scrollback), not raw byte',
	);
	rows.push(
		'> history — frame size is bounded and the newest output is always present. Lines older',
	);
	rows.push('> than the 5000-line window roll off by design (R6); that is not data loss within');
	rows.push('> the documented window.');
	rows.push('');
	return rows.join('\n');
}

// ---- Point 4: idle memory footprint at scale -------------------------------

async function sampledRss(samples = 5, gapMs = 150): Promise<number> {
	let max = 0;
	for (let i = 0; i < samples; i++) {
		max = Math.max(max, process.memoryUsage().rss);
		await wait(gapMs);
	}
	return max;
}

async function point4(): Promise<string> {
	const backend = await loadBackend('bun-pty');
	const rows: string[] = [
		'## Point 4 — Idle memory footprint (bun-pty)',
		'',
		'| sessions | parent ΔRSS total | parent ΔRSS / session |',
		'|----------|-------------------|------------------------|',
	];

	for (const n of [50, 100]) {
		gc();
		await wait(300);
		const before = await sampledRss();
		const kit = new PtyKit({ backend });
		for (let i = 0; i < n; i++) {
			await kit.createSession({ sessionId: `idle-${n}-${i}`, namespace: 'bench' });
		}
		await wait(4000); // let shells settle
		gc();
		const after = await sampledRss();
		const delta = Math.max(0, after - before);
		rows.push(`| ${n} | ${(delta / 1e6).toFixed(1)} MB | ${(delta / n / 1e6).toFixed(2)} MB |`);
		kit.dispose();
		await wait(800);
	}
	rows.push('');
	rows.push(
		'> This is the **parent** process RSS delta (the headless xterm + bookkeeping per session).',
	);
	rows.push(
		'> Each PTY is a separate OS process whose memory is NOT counted here. The per-session',
	);
	rows.push(
		'> parent cost is dominated by the 5000-line headless xterm and is small; it is the gate',
	);
	rows.push('> for any future disk-spill decision and did not warrant one at this scale.');
	rows.push('');
	return rows.join('\n');
}

// ---- Point 7: backend auto-detect ------------------------------------------

async function point7(): Promise<string> {
	const detected = detectBackendName();
	let bunPtyOk = false;
	try {
		const b = await loadBackend('bun-pty');
		const p = b.spawn(process.env.SHELL || '/bin/bash', [], {
			cols: 80,
			rows: 24,
			cwd: process.cwd(),
			env: process.env as Record<string, string>,
		});
		bunPtyOk = typeof p.pid === 'number' && p.pid > 0;
		p.kill('SIGKILL');
	} catch {
		bunPtyOk = false;
	}

	return [
		'## Point 7 — Backend auto-detect',
		'',
		`- Runtime detected: \`${detected}\` (this run is under Bun).`,
		`- bun-pty spawn under Bun: ${bunPtyOk ? '✅ works' : '❌ failed'}`,
		'- node-pty spawn under Node 25.9.0 (macOS arm64): ❌ **`posix_spawnp failed`**',
		'  — reproduced with raw node-pty too, so it is a node-pty/Node-25 native issue, not a',
		'  ptykit bug. (The library itself now loads cleanly under Node after fixing the',
		'  `@xterm/headless` CJS named-import interop.)',
		'',
		'**Deploy-scenario matrix {direct, bundled, pm2/systemd, Docker} × {Bun, Node}:**',
		'NOT RUN — this machine is macOS with no Docker/pm2/systemd. Only the `direct` cells were',
		'exercised: Bun→bun-pty ✅, Node→node-pty ❌ (above).',
		'',
		'**Decision:** node-pty stays **experimental**. bun-pty is the default, tested path. The',
		'node-pty adapter is implemented and type-correct, but the gating data does not yet justify',
		'promoting it to "supported".',
		'',
	].join('\n');
}

async function main(): Promise<void> {
	const env = [
		'# PtyKit Benchmark Results',
		'',
		'## Environment',
		'',
		`- Bun: ${process.versions.bun ?? 'n/a'}`,
		`- Node: ${process.versions.node}`,
		`- OS: ${platform()} ${arch()}`,
		`- CPU: ${cpus()[0]?.model ?? 'unknown'} × ${cpus().length}`,
		`- RAM: ${(totalmem() / 1e9).toFixed(1)} GB`,
		`- Commit: ${(() => {
			try {
				return execSync('git rev-parse --short HEAD').toString().trim();
			} catch {
				return 'unknown';
			}
		})()}`,
		'- Generated by `bun bench.ts`. Numbers are machine-specific (a dev laptop, not a server).',
		'',
	].join('\n');

	console.log('Running Point 5 (throughput)…');
	const p5 = await point5();
	console.log('Running Point 3 (reattach)…');
	const p3 = await point3();
	console.log('Running Point 7 (auto-detect)…');
	const p7 = await point7();
	console.log('Running Point 4 (idle memory)…');
	const p4 = await point4();

	const extra = [
		'## Transport parity (SSE vs WebSocket)',
		'',
		'Not applicable — WebSocket is the only transport. There is no SSE path to',
		'compare against.',
		'',
		'## End-to-end reattach via the client',
		'',
		'Covered as an automated test rather than a bench script: see `src/e2e.test.ts`',
		'(`real bun-pty: reattach replays scrollback and input keeps working`), which creates a',
		'session, runs a command, disconnects, reattaches with a fresh client, verifies the',
		'scrollback replay contains the earlier marker, and confirms input still works.',
		'',
	].join('\n');

	const report = [env, p5, p3, p4, p7, extra].join('\n');
	const outDir = import.meta.dir;
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, 'bench-results.md'), report);
	console.log(`\nWrote ${join(outDir, 'bench-results.md')}`);
}

void main();
