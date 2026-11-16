<script lang="ts">
	import { navigate } from '../lib/router.svelte.js';
	import { reveal } from '../lib/reveal.js';
	import CodeWindow from '../components/CodeWindow.svelte';
	import BenchChart from '../components/BenchChart.svelte';

	const heroCode = `// Server
import { PtyKitManager, createPtyKitServer } from '@myrialabs/ptykit';

const manager = new PtyKitManager();
const server = createPtyKitServer(manager, {
  path: '/pty',
  authorize: (ctx) => ctx.conn.data.user?.canAccess(ctx.namespace) ?? false,
});

Bun.serve({ port: 3000, fetch: server.fetch, websocket: server.websocket });

// Browser
import { PtyKitClient } from '@myrialabs/ptykit/client';

const client = new PtyKitClient({ url: '/pty', namespace: 'project-42' });
const session = await client.attach('project-42-terminal-1');
session.onData((chunk) => term.write(chunk));
term.onData((data) => session.write(data));`;

	const chartBars = [
		{ label: 'Raw bun-pty', value: 5.0, display: '5.0' },
		{ label: 'PtyKit-wrapped', value: 4.7, display: '4.7', highlight: true }
	];

	const timeline = [
		{
			title: 'N clients, one session',
			body: 'Output broadcasts to a room (default = the namespace); any number of clients attach to the same sessionId and watch the exact same live terminal. Room-level onSessionCreated/onSessionClosed let a UI mirror the live session set as teammates open their own.',
			file: 'collaborative.ts',
			code: `import { PtyKitClient } from '@myrialabs/ptykit/client';

const alice = new PtyKitClient({ url, namespace: 'team' });
const bob = new PtyKitClient({ url, namespace: 'team' });

// Both attach to the SAME sessionId — only one shell is spawned.
const a = await alice.create({ sessionId: 'team-terminal-1' });
const b = await bob.attach('team-terminal-1');

a.onData((c) => renderFor('alice', c));
b.onData((c) => renderFor('bob', c));   // sees alice's output too`
		},
		{
			title: 'Reattach that just works',
			body: 'Scrollback lives server-side in a headless xterm and replays as one serialized frame — resized to the attaching viewport first, so even full-screen TUIs (vim, htop, coding agents) restore un-garbled. A refresh, a dropped connection, or a second viewer never lose a byte and never double-print.',
			file: 'reattach.ts',
			code: `// First client runs a command, then disconnects (e.g. a browser refresh).
const s1 = await client.create({ sessionId: 'demo-1' });
s1.write('npm run build\\r');
client.disconnect();

// A fresh client attaches to the SAME session later.
const fresh = new PtyKitClient({ url, namespace: 'demo' });
const s2 = await fresh.attach('demo-1');

// Replays the serialized screen — zero data loss, no double output —
// then input keeps working.
s2.onData((c) => term.write(c));
s2.write('npm test\\r');`
		},
		{
			title: 'Resilient by default',
			body: 'Reconnect with exponential backoff, heal-reconnect for sockets that are "open but dead", and idempotency-aware resend are all on by default. On reconnect, every known session is re-attached automatically — the room subscription and scrollback recover without any app code.',
			file: 'resilient.ts',
			code: `import { PtyKitClient } from '@myrialabs/ptykit/client';

const client = new PtyKitClient({
  url: '/pty',
  namespace: 'project-42',
  reconnect: { enabled: true, baseDelayMs: 1000, maxDelayMs: 30_000, maxAttempts: 5 },
});

client.onStatus((s) => render(s)); // 'connected' | 'reconnecting' | 'disconnected'

// Every known session re-attaches automatically on reconnect.`
		}
	];

	const features = [
		{
			title: 'Batteries-included client',
			desc: 'mountTerminal / <PtyTerminal> ship xterm, fit, clipboard, web-links, unicode11, ligatures, a right-click copy/paste menu, a loading spinner, and 7 theme presets on by default — all opt-out.'
		},
		{
			title: 'Auto-detected backend',
			desc: 'bun-pty on Bun (tested), node-pty on Node (experimental). Both optional and lazily loaded via dynamic import — you never build the one you don’t use.'
		},
		{
			title: 'Bring your own auth',
			desc: 'An authorize hook enforces namespace access with anti-hijack ownership checks derived from the session itself. The library ships no auth of its own.'
		},
		{
			title: 'Official Svelte adapter',
			desc: '<PtyTerminal/> wraps the client + xterm + FitAddon into one SSR-safe, fully configurable component with reactive theme and font props.'
		},
		{
			title: 'Quiet, typed core',
			desc: 'No stdout/stderr writes, sideEffects: false, JSDoc on every export. Diagnostics route through an injectable logger, off by default.'
		},
		{
			title: 'Ride a socket you own',
			desc: 'Already run one multiplexed app WebSocket? hostSocket adapts it so PtyKit keeps reconnect/heal/resend without opening a second connection.'
		}
	];

	function goDocs(): void {
		navigate('/docs/getting-started/quick-start');
	}
</script>

<div class="glow-orb glow-orb-1"></div>
<div class="glow-orb glow-orb-2"></div>
<div class="glow-orb glow-orb-3"></div>

<!-- HERO -->
<section class="hero">
	<div class="container">
		<div class="hero-badge">Open Source &middot; WebSocket Only &middot; TypeScript</div>
		<h1>Terminals in the browser.<br /><span class="grad-text">Reattached.</span></h1>
		<p class="hero-desc">
			PtyKit serves interactive shell sessions over a single WebSocket — with
			<strong>collaborative rooms</strong>, serialized-scrollback reattach that loses
			<strong>zero bytes</strong>, and a resilient client. Node 18+ and Bun, bring your own auth.
		</p>
		<div class="hero-cta">
			<button class="btn-primary" onclick={goDocs}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
				Get Started
			</button>
			<a href="https://github.com/myrialabs/ptykit" class="btn-secondary">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
				View on GitHub
			</a>
		</div>
		<div class="hero-mockup-wrap">
			<CodeWindow title="quick-start.ts" code={heroCode} lang="typescript" />
		</div>
	</div>
</section>

<!-- PROOF: real benchmark chart -->
<section class="proof-section">
	<div class="container">
		<div class="section-header">
			<div class="section-tag">Not a Synthetic Benchmark</div>
			<h2 class="section-title">The cost of persist-first,<br /><span class="grad-text">batched, collaborative output</span></h2>
			<p class="section-desc">Throughput piping <code>seq 1 1000000</code> through an interactive shell, raw bun-pty vs the PtyKit-wrapped pipeline — higher is faster.</p>
		</div>
		<div class="proof-card" use:reveal>
			<BenchChart bars={chartBars} unit="MB/s" />
			<p class="proof-footnote">
				<strong>5.3%</strong> overhead (target &lt;10%) for persisting every chunk to a
				headless terminal first, then micro-task batching — the price of reattach and
				collaborative rooms working the way they do. Measured on Apple M2, Bun 1.3.14 —
				full methodology and reattach-latency/idle-memory tables in
				<a href="https://github.com/myrialabs/ptykit/blob/main/bench-results.md">bench-results.md</a>.
			</p>
		</div>
	</div>
</section>

<!-- TIMELINE -->
<section id="showcase" class="timeline-section">
	<div class="container">
		<div class="section-header">
			<div class="section-tag">See It In Action</div>
			<h2 class="section-title">Three things a plain<br /><span class="grad-text">xterm-over-websocket can’t do</span></h2>
		</div>

		<div class="timeline">
			{#each timeline as row, i (row.title)}
				<div class="timeline-row" use:reveal={{ delay: (i % 3) * 100 }}>
					<div class="timeline-marker">
						<div class="dot"></div>
						{#if i < timeline.length - 1}<div class="line"></div>{/if}
					</div>
					<div class="timeline-content">
						<div class="timeline-text">
							<h3>{row.title}</h3>
							<p>{row.body}</p>
						</div>
						<div class="timeline-code">
							<CodeWindow title={row.file} code={row.code} lang="typescript" />
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- FEATURES -->
<section id="features" class="features-section">
	<div class="container">
		<div class="section-header">
			<div class="section-tag">Everything Else</div>
			<h2 class="section-title">The rest of the<br /><span class="grad-text">typed surface</span></h2>
		</div>
		<div class="features-grid">
			{#each features as f, i (f.title)}
				<div class="feature-card" use:reveal={{ delay: (i % 3) * 60 }}>
					<div class="feature-title">{f.title}</div>
					<div class="feature-desc">{f.desc}</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- INSTALL + CTA -->
<section id="install" class="install-section">
	<div class="container">
		<div class="section-header">
			<div class="section-tag">Installation</div>
			<h2 class="section-title">Install &amp; <span class="grad-text">mount a session</span></h2>
			<p class="section-desc">Requires Node.js 18+ or Bun. The PTY backend (bun-pty / node-pty) is an optional dependency resolved at runtime.</p>
		</div>
		<CodeWindow title="terminal" lang="bash" code={`$ bun add @myrialabs/ptykit

> const server = createPtyKitServer(manager, { path: '/pty' });`} />
		<p class="install-footnote">
			npm and pnpm work too: <code>npm i @myrialabs/ptykit</code> &middot; <code>pnpm add @myrialabs/ptykit</code>
		</p>
		<div class="install-cta">
			<button class="btn-primary" onclick={goDocs}>Read the docs</button>
			<a href="https://github.com/myrialabs/ptykit" class="btn-secondary">Star on GitHub</a>
		</div>
	</div>
</section>

<style>
	.hero {
		min-height: 100vh;
		display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		text-align: center;
		padding: 120px 24px 80px;
		position: relative;
	}
	.hero-badge {
		display: inline-flex; align-items: center; gap: 8px;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		border-radius: 100px;
		padding: 6px 16px;
		font-size: 12px; font-weight: 500;
		color: var(--accent-2);
		margin-bottom: 32px;
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}
	.hero h1 { font-size: clamp(42px, 7vw, 80px); font-weight: 700; line-height: 1.08; letter-spacing: -2px; margin-bottom: 24px; max-width: 900px; margin-left: auto; margin-right: auto; }
	.hero-desc { font-size: clamp(16px, 2vw, 20px); color: var(--text-1); max-width: 640px; margin: 0 auto 40px; line-height: 1.7; text-align: center; }
	.hero-desc strong { color: var(--text-0); font-weight: 600; }

	.hero-cta { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; margin-bottom: 64px; }
	.hero-mockup-wrap { width: 100%; max-width: 880px; position: relative; min-width: 0; margin: 0 auto; }

	/* ---- PROOF ---- */
	.proof-section { padding: 0 0 100px; }
	.proof-card {
		background: var(--bg-1); border: 1px solid var(--border-bright); border-radius: var(--radius-lg);
		padding: 36px 40px; max-width: 780px; margin: 0 auto;
	}
	.proof-footnote { text-align: center; font-size: 13.5px; color: var(--text-2); margin-top: 24px; line-height: 1.6; }
	.proof-footnote strong { color: var(--accent-2); }
	.proof-footnote a { color: var(--accent-2); }

	/* ---- TIMELINE ---- */
	.timeline-section { padding: 0 0 100px; }
	.timeline { display: flex; flex-direction: column; }
	.timeline-row { display: flex; gap: 24px; }
	.timeline-marker { width: 20px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }
	.dot { width: 14px; height: 14px; border-radius: 50%; background: var(--accent-1); box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.15); flex-shrink: 0; margin-top: 6px; }
	.line { width: 2px; flex: 1; background: var(--border-bright); margin: 4px 0; min-height: 40px; }
	.timeline-content { flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; align-items: start; padding-bottom: 56px; }
	.timeline-text { min-width: 0; }
	.timeline-text h3 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 14px; }
	.timeline-text p { font-size: 15px; color: var(--text-1); line-height: 1.7; }
	.timeline-code { min-width: 0; }

	/* ---- FEATURES ---- */
	.features-section { padding: 0 0 100px; }
	.features-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
	.feature-card {
		background: var(--bg-1); border: 1px solid var(--border); border-radius: 16px;
		padding: 24px; transition: border-color 0.25s, background 0.25s; min-width: 0;
	}
	.feature-card:hover { border-color: rgba(34, 197, 94, 0.38); background: var(--bg-2); }
	.feature-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
	.feature-desc { font-size: 13px; color: var(--text-1); line-height: 1.65; }

	/* ---- INSTALL + CTA ---- */
	.install-section { padding: 0 0 120px; }
	.install-section .container { max-width: 780px; }
	.install-footnote { text-align: center; margin-top: 24px; font-size: 14px; color: var(--text-2); }
	.install-footnote code { color: var(--accent-2); font-family: 'JetBrains Mono', monospace; font-size: 13px; }
	.install-cta { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-top: 40px; }

	@media (max-width: 900px) {
		.features-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.timeline-content { grid-template-columns: minmax(0, 1fr); gap: 20px; }
	}
	@media (max-width: 640px) {
		.hero { padding: 110px 16px 60px; }
		.hero h1 { font-size: 36px; letter-spacing: -1px; }
		.features-grid { grid-template-columns: minmax(0, 1fr); }
		.timeline-row { gap: 14px; }
		.proof-card { padding: 28px 20px; }
	}
</style>
