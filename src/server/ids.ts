/** Monotonic connection-id generator (process-local). */
let counter = 0;

export function nextConnectionId(): string {
	counter += 1;
	return `conn-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
