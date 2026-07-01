/**
 * A tabbed terminal manager: many sessions, one shared socket. Demonstrates
 * `create` / `attach` / `kill` and the session registry. On load it discovers
 * any sessions the server already has (via `listSessions`) and reattaches them —
 * so a refresh restores every tab.
 *
 * Each tab is a `mountTerminal` call from `@myrialabs/ptykit/client`, all sharing one
 * `PtyKitClient` (so a single socket multiplexes every tab). The returned handle
 * exposes the `terminal`/`fitAddon`/`session` we need for focus, fit, and close.
 *
 * In-repo this imports from `../../src/client`; a published app imports from
 * `@myrialabs/ptykit/client`.
 */

import { PtyKitClient, mountTerminal, type TerminalHandle } from '../../src/client/index.js';

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pty`;
const NS = 'workspace';
const client = new PtyKitClient({ url: wsUrl, namespace: NS });

const tabsEl = document.getElementById('tabs') as HTMLDivElement;
const screensEl = document.getElementById('screens') as HTMLDivElement;
const statusEl = document.getElementById('status')!;
client.onStatus((s) => {
	statusEl.textContent = s;
	statusEl.dataset.status = s;
});

interface Tab {
	sessionId: string;
	handle: TerminalHandle;
	tabBtn: HTMLButtonElement;
	screen: HTMLDivElement;
}

const tabs = new Map<string, Tab>();
let active: string | null = null;
let counter = 0;

function setActive(sessionId: string) {
	active = sessionId;
	for (const [id, tab] of tabs) {
		const on = id === sessionId;
		tab.screen.style.display = on ? 'block' : 'none';
		tab.tabBtn.classList.toggle('active', on);
		if (on) {
			tab.handle.fitAddon?.fit();
			tab.handle.terminal.focus();
		}
	}
}

async function openTab(sessionId: string, create: boolean) {
	const screen = document.createElement('div');
	screen.className = 'screen';
	screensEl.appendChild(screen);

	// Reuse the shared client so every tab rides one socket.
	const handle = await mountTerminal(screen, {
		url: wsUrl,
		client,
		sessionId,
		create,
		fontSize: 13,
		fitDebounceMs: 150,
	});

	// Tab button with a close affordance.
	const tabBtn = document.createElement('button');
	tabBtn.className = 'tab';
	const label = document.createElement('span');
	label.textContent = sessionId.replace(`${NS}-terminal-`, 'term ');
	const close = document.createElement('span');
	close.className = 'close';
	close.textContent = '×';
	tabBtn.append(label, close);
	tabsEl.insertBefore(tabBtn, addBtn);

	tabBtn.addEventListener('click', (e) => {
		if (e.target === close) void closeTab(sessionId);
		else setActive(sessionId);
	});

	tabs.set(sessionId, { sessionId, handle, tabBtn, screen });
	setActive(sessionId);
}

async function closeTab(sessionId: string) {
	const tab = tabs.get(sessionId);
	if (!tab) return;
	await tab.handle.session.kill().catch(() => {});
	tab.handle.dispose();
	tab.screen.remove();
	tab.tabBtn.remove();
	tabs.delete(sessionId);
	if (active === sessionId) {
		const next = tabs.keys().next().value;
		if (next) setActive(next);
		else active = null;
	}
}

const addBtn = document.createElement('button');
addBtn.className = 'tab add';
addBtn.textContent = '+';
addBtn.addEventListener('click', () => void openTab(`${NS}-terminal-${++counter}`, true));
tabsEl.appendChild(addBtn);

// Restore existing sessions on load (refresh-safe), else open the first tab.
const existing = await client.listSessions();
if (existing.sessions.length > 0) {
	for (const s of existing.sessions) {
		const n = Number(s.sessionId.split('-').pop());
		if (Number.isFinite(n)) counter = Math.max(counter, n);
		await openTab(s.sessionId, false);
	}
} else {
	await openTab(`${NS}-terminal-${++counter}`, true);
}
