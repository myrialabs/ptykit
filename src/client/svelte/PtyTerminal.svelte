<!--
  PtyTerminal — official Svelte component for `@myrialabs/ptykit/svelte`.

  A thin reactive shell over `mountTerminal` from `@myrialabs/ptykit/client`, which owns all
  the xterm.js + FitAddon + session wiring. xterm is imported dynamically there,
  so the component is SSR-safe (it only touches the DOM in the browser).

  Peer deps (provided by the consuming app): svelte, @xterm/xterm, @xterm/addon-fit.
-->
<script>
	import { mountTerminal } from '@myrialabs/ptykit/client';
	import { untrack } from 'svelte';
	// PtyKit's stylesheet (xterm base + chrome defaults: height fill + slim scrollbar).
	import '../xterm.css';

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
		WebSocketImpl = undefined,

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
		padding = undefined,
		terminalOptions = {},
		addons = undefined,
		// Addons + context menu default ON in mountTerminal; leave undefined here to
		// inherit that default, pass `false` to opt out.
		clipboard = undefined,
		webLinks = undefined,
		unicode11 = undefined,
		ligatures = undefined,
		contextMenu = undefined,

		// --- behavior ---
		fit = true,
		fitDebounceMs = 100,
		loading = undefined,
		loadingText = undefined,
		onTerminalReady = undefined,
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
	/** @type {import('@myrialabs/ptykit/client').TerminalHandle | undefined} */
	let handle = $state();

	// (Re)mount only when the connection identity or container changes — appearance
	// (theme/fontSize) is applied reactively below, so toggling dark/light or the
	// font size never tears down and re-attaches the session.
	$effect(() => {
		// Tracked deps: the only things that should force a fresh mount.
		void sessionId; void namespace; void create; void client; void url;
		const target = container;
		if (!target) return;
		let cancelled = false;
		/** @type {import('@myrialabs/ptykit/client').TerminalHandle | undefined} */
		let local;

		untrack(() =>
			mountTerminal(target, {
				url,
				sessionId,
				namespace,
				create,
				client,
				reconnect,
				persistence,
				requestTimeoutMs,
				WebSocketImpl,
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
				padding,
				terminalOptions,
				addons,
				clipboard,
				webLinks,
				unicode11,
				ligatures,
				contextMenu,
				fit,
				fitDebounceMs,
				loading,
				loadingText,
				onReady: onTerminalReady,
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
					local = h;
					handle = h;
					onready?.({ client: h.client, session: h.session, terminal: h.terminal });
				})
				.catch(() => {
					/* onError (if provided) was already invoked inside mountTerminal */
				}),
		);

		return () => {
			cancelled = true;
			local?.dispose();
			handle = undefined;
		};
	});

	// Apply appearance changes to the live terminal without a remount.
	$effect(() => {
		if (handle && theme !== undefined) handle.setTheme(theme);
	});
	$effect(() => {
		if (handle) handle.terminal.options.fontSize = fontSize;
	});
	$effect(() => {
		if (handle) handle.setPadding(padding);
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
