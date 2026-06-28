/**
 * Browser side of the basic example.
 *
 * `mountTerminal` is the ready-to-use helper from `ptykit/client`: hand it a
 * container and a url and it creates the xterm terminal, attaches the FitAddon,
 * opens the session, and wires output⇄input for you — no manual xterm plumbing.
 *
 * In-repo it imports from `../../src/client/...`; a published app would import
 * from `ptykit/client`.
 */

import { mountTerminal } from '../../src/client/index.js';

const statusEl = document.getElementById('status')!;
const screenEl = document.getElementById('screen') as HTMLDivElement;

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty`;

await mountTerminal(screenEl, {
	url: wsUrl,
	namespace: 'demo',
	sessionId: 'demo-terminal-1',
	create: true,
	fontSize: 13,
	onStatus: (s) => {
		statusEl.textContent = s;
		statusEl.dataset.status = s;
	},
});
