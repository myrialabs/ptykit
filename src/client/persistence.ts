/**
 * sessionId persistence (R13, Recommendation 2).
 *
 * Default: the active session id is stored in `sessionStorage`, scoped per
 * namespace, with an in-memory fallback when storage is unavailable (SSR / Node).
 * Callers that own the authoritative tab list (e.g. a server DB) override via the
 * `persistence` hook.
 */

export interface SessionPersistence {
	load(namespace: string): string | null;
	save(namespace: string, sessionId: string): void;
}

const storageKey = (namespace: string) => `ptykit-active-session-${namespace}`;

/** The default sessionStorage-backed persistence (with in-memory fallback). */
export function defaultPersistence(): SessionPersistence {
	const hasStorage = (() => {
		try {
			return typeof sessionStorage !== 'undefined' && sessionStorage !== null;
		} catch {
			return false;
		}
	})();
	const memory = new Map<string, string>();

	return {
		load(namespace) {
			if (hasStorage) {
				try {
					return sessionStorage.getItem(storageKey(namespace));
				} catch {
					return null;
				}
			}
			return memory.get(namespace) ?? null;
		},
		save(namespace, sessionId) {
			if (hasStorage) {
				try {
					sessionStorage.setItem(storageKey(namespace), sessionId);
					return;
				} catch {
					/* fall through to memory */
				}
			}
			memory.set(namespace, sessionId);
		},
	};
}
