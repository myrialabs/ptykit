/**
 * Two panes, one session: a live demo of the collaborative room model.
 * Both panes attach to the same `sessionId`; output broadcasts to the room and
 * each pane filters by it — so typing in either pane shows up in both.
 *
 * Each pane is a single `mountTerminal` call from `ptykit/client` — the helper
 * owns the xterm + FitAddon + session wiring, so the example is just two mounts.
 *
 * In-repo this imports from `../../src/client`; a published app imports from
 * `ptykit/client`.
 */

import { mountTerminal, type TerminalHandle } from '../../src/client/index.js';

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty`;
const SESSION = 'collab-terminal-1';

function mountPane(screenId: string, statusId: string, create: boolean): Promise<TerminalHandle> {
	const statusEl = document.getElementById(statusId)!;
	return mountTerminal(document.getElementById(screenId) as HTMLElement, {
		url: wsUrl,
		namespace: 'demo',
		sessionId: SESSION,
		create,
		fontSize: 13,
		fitDebounceMs: 150,
		onStatus: (s) => {
			statusEl.textContent = s;
			statusEl.dataset.status = s;
		},
	});
}

// Pane A creates the session; pane B attaches to the very same one.
const a = await mountPane('screen-a', 'status-a', true);
await mountPane('screen-b', 'status-b', false);

a.terminal.focus();
