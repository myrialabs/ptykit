<script>
	import { PtyTerminal } from 'ptykit/svelte';

	let status = $state('connecting');
	const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty`;
</script>

<main>
	<header>
		<strong>ptykit</strong> · svelte — &lt;PtyTerminal/&gt;
		<span class="status" data-status={status}>{status}</span>
	</header>
	<div class="term">
		<PtyTerminal
			sessionId="svelte-terminal-1"
			url={wsUrl}
			namespace="demo"
			create
			showStatus={false}
			fontSize={14}
			cursorStyle="bar"
			theme={{ background: '#0f172a', foreground: '#e2e8f0', cursor: '#22c55e' }}
			onstatus={(s) => (status = s)}
			onerror={(e) => (status = `error: ${e instanceof Error ? e.message : e}`)}
		/>
	</div>
</main>

<style>
	main { display: flex; flex-direction: column; height: 100%; }
	header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; font: 12px ui-monospace, monospace; border-bottom: 1px solid #1e293b; }
	.status { margin-left: auto; text-transform: uppercase; opacity: 0.8; }
	.status[data-status='connected'] { color: #4ade80; }
	.status[data-status='reconnecting'] { color: #fde047; }
	.status[data-status='disconnected'] { color: #f87171; }
	.term { flex: 1; min-height: 0; padding: 6px; }
</style>
