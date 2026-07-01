<!--
  PtyTerminal — official Svelte component for `@myrialabs/ptykit/svelte`.

  A thin reactive shell over `mountTerminal` from `@myrialabs/ptykit/client`, which owns all
  the xterm.js + FitAddon + session wiring. xterm is imported dynamically there,
  so the component is SSR-safe (it only touches the DOM in the browser).

  Peer deps (provided by the consuming app): svelte, @xterm/xterm, @xterm/addon-fit.
-->
<script>
	import { mountTerminal } from '@myrialabs/ptykit/client';

	let {
		// --- connection ---
		sessionId,
		url,
		namespace = undefined,
		create = false,
		client = undefined,
		reconnect = undefined,
		persistence = undefined,
		requestTimeoutMs = undefined,

		// --- session (used when creating) ---
		cols = undefined,
		rows = undefined,
		cwd = undefined,
		shell = undefined,

		// --- terminal appearance ---
		scrollback = 5000,
		fontSize = 13,
		fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace',
		lineHeight = 1.0,
		cursorBlink = true,
		cursorStyle = 'block',
		theme = undefined,
		terminalOptions = {},

		// --- behavior ---
		fit = true,
		fitDebounceMs = 100,
		showStatus = true,

		// --- styling ---
		class: className = '',

		// --- lifecycle callbacks ---
		onready = undefined,
		ondata = undefined,
		onexit = undefined,
		onstatus = undefined,
		onerror = undefined,
		ondirectory = undefined,
	} = $props();

	/** @type {'connected' | 'reconnecting' | 'disconnected'} */
	let status = $state('reconnecting');
	/** @type {HTMLDivElement | undefined} */
	let container = $state();

	$effect(() => {
		if (!container) return;
		let cancelled = false;
		/** @type {import('@myrialabs/ptykit/client').TerminalHandle | undefined} */
		let handle;

		mountTerminal(container, {
			url,
			sessionId,
			namespace,
			create,
			client,
			reconnect,
			persistence,
			requestTimeoutMs,
			cols,
			rows,
			cwd,
			shell,
			scrollback,
			fontSize,
			fontFamily,
			lineHeight,
			cursorBlink,
			cursorStyle,
			theme,
			terminalOptions,
			fit,
			fitDebounceMs,
			onData: ondata,
			onExit: onexit,
			onError: onerror,
			onDirectory: ondirectory,
			onStatus: (s) => {
				status = s;
				onstatus?.(s);
			},
		})
			.then((h) => {
				if (cancelled) {
					h.dispose();
					return;
				}
				handle = h;
				onready?.({ client: h.client, session: h.session, terminal: h.terminal });
			})
			.catch(() => {
				/* onError (if provided) was already invoked inside mountTerminal */
			});

		return () => {
			cancelled = true;
			handle?.dispose();
		};
	});
</script>

<div class="ptykit-terminal {className}" data-status={status}>
	{#if showStatus}
		<div class="ptykit-terminal__status">{status}</div>
	{/if}
	<div class="ptykit-terminal__screen" bind:this={container}></div>
</div>

<style>
	.ptykit-terminal {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.ptykit-terminal__screen {
		width: 100%;
		height: 100%;
	}
	.ptykit-terminal__status {
		position: absolute;
		top: 4px;
		right: 8px;
		z-index: 1;
		font: 11px/1.4 ui-monospace, monospace;
		opacity: 0.6;
		pointer-events: none;
		text-transform: uppercase;
	}
</style>
