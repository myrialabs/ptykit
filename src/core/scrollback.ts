/**
 * Scrollback persistence (R6).
 *
 * Scrollback lives in a headless xterm per session, serialized on demand via
 * `@xterm/addon-serialize`. Replay is therefore a single structured ANSI frame
 * (grid + scrollback + attributes), not a raw byte history — so it is correct
 * after `clear`, compact, and immune to partial-byte corruption.
 *
 * `BufferStore` is the seam that lets a disk-backed strategy be added later
 * WITHOUT changing the public API. Only `MemoryBufferStore` ships in v1; build a
 * disk-backed store only if real memory footprint data demands it.
 */

// @xterm/headless and @xterm/addon-serialize are CJS/UMD packages. Node's ESM
// `cjs-module-lexer` fails to detect their named exports, so a plain
// `import { Terminal }` throws under Node ("does not provide an export named
// 'Terminal'"). Default-import the module object and destructure — this is the
// only form that works on BOTH Node ESM and Bun.
import headlessPkg from '@xterm/headless';
import serializePkg from '@xterm/addon-serialize';

const { Terminal } = headlessPkg;
const { SerializeAddon } = serializePkg;
type Terminal = InstanceType<typeof Terminal>;
type SerializeAddon = InstanceType<typeof SerializeAddon>;

/** Per-session scrollback store. Implementations must be persist-first safe. */
export interface BufferStore {
	/** Allocate a buffer for a session (idempotent). */
	create(sessionId: string, cols: number, rows: number): void;
	/** Append raw PTY output to the session's buffer. */
	write(sessionId: string, data: string): void;
	/** Serialize the session's current screen + scrollback to a replayable frame. */
	serialize(sessionId: string): string;
	/** Clear the session's buffer (sync with a client-side clear). */
	clear(sessionId: string): void;
	/** Resize the session's buffer to match the PTY. */
	resize(sessionId: string, cols: number, rows: number): void;
	/** Number of lines currently held (for status reporting). */
	length(sessionId: string): number;
	/** Dispose the session's buffer and free memory. */
	dispose(sessionId: string): void;
}

interface HeadlessEntry {
	terminal: Terminal;
	serialize: SerializeAddon;
}

/** In-memory scrollback via `@xterm/headless` + `@xterm/addon-serialize`. */
export class MemoryBufferStore implements BufferStore {
	private readonly entries = new Map<string, HeadlessEntry>();
	private readonly scrollback: number;

	constructor(scrollback = 5000) {
		this.scrollback = scrollback;
	}

	create(sessionId: string, cols: number, rows: number): void {
		if (this.entries.has(sessionId)) return;
		const terminal = new Terminal({
			scrollback: this.scrollback,
			cols,
			rows,
			allowProposedApi: true,
		});
		const serialize = new SerializeAddon();
		// @xterm/headless and the serialize addon are versioned independently;
		// their addon interfaces are structurally compatible at runtime.
		terminal.loadAddon(serialize as any);
		this.entries.set(sessionId, { terminal, serialize });
	}

	write(sessionId: string, data: string): void {
		this.entries.get(sessionId)?.terminal.write(data);
	}

	serialize(sessionId: string): string {
		return this.entries.get(sessionId)?.serialize.serialize() ?? '';
	}

	clear(sessionId: string): void {
		this.entries.get(sessionId)?.terminal.clear();
	}

	resize(sessionId: string, cols: number, rows: number): void {
		this.entries.get(sessionId)?.terminal.resize(cols, rows);
	}

	length(sessionId: string): number {
		const entry = this.entries.get(sessionId);
		return entry ? entry.terminal.buffer.active.length : 0;
	}

	dispose(sessionId: string): void {
		const entry = this.entries.get(sessionId);
		if (!entry) return;
		try {
			entry.serialize.dispose();
		} catch {
			// addon already disposed
		}
		try {
			entry.terminal.dispose();
		} catch {
			// terminal already disposed
		}
		this.entries.delete(sessionId);
	}
}
