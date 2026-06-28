import { expect, test } from 'bun:test';
import { defaultPersistence } from './persistence.js';

test('persists and loads an active session id per namespace (in-memory fallback)', () => {
	// In bun/node there is no sessionStorage, so this exercises the fallback.
	const p = defaultPersistence();
	expect(p.load('ns1')).toBeNull();
	p.save('ns1', 's1');
	p.save('ns2', 's2');
	expect(p.load('ns1')).toBe('s1');
	expect(p.load('ns2')).toBe('s2');
});

test('a custom persistence hook can fully own storage', () => {
	const store = new Map<string, string>();
	const custom = {
		load: (ns: string) => store.get(ns) ?? null,
		save: (ns: string, id: string) => void store.set(ns, id),
	};
	custom.save('ns1', 'server-owned');
	expect(custom.load('ns1')).toBe('server-owned');
});
