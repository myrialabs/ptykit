/**
 * Shared wire-protocol types and primitives used across the core engine, the
 * WebSocket transport, and the browser client.
 *
 * The transport is a single multiplexed WebSocket. Two planes ride it:
 *  - **Control plane** — RPC request/response keyed by `requestId`.
 *  - **Data plane** — broadcast events fanned out to a room and filtered
 *    client-side by `sessionId`.
 */

/** PtyKit package version. */
export const PTYKIT_VERSION = '0.1.0';

/**
 * Monotonic sequence number stamped on every output event so clients can
 * deduplicate replayed-vs-live output after a reattach (R5).
 */
export type Seq = number;

// ============================================================================
// Wire frame
// ============================================================================

/**
 * Every WebSocket message is a JSON frame `{ action, payload }`. RPC requests
 * carry `payload = { requestId, data }`; RPC responses use action
 * `${action}:response` with `payload = { requestId, success, data?, error? }`;
 * events carry their event payload directly.
 */
export interface WireFrame {
	action: string;
	payload: unknown;
}

/** RPC request payload. */
export interface RpcRequest<D = unknown> {
	requestId: string;
	data: D;
}

/** RPC response payload. The client unwraps `data` on success, throws on failure. */
export interface RpcResponse<D = unknown> {
	requestId: string;
	success: boolean;
	data?: D;
	error?: string;
}

// ============================================================================
// Control-plane operations (RPC)
// ============================================================================

/** Operation names (control plane). */
export const RPC_ACTIONS = [
	'create-session',
	'resize',
	'cancel',
	'kill-session',
	'clear',
	'check-shell',
	'pty-status',
	'list-sessions',
	'stream-status',
	'missed-output',
	'reconnect',
] as const;
export type RpcAction = (typeof RPC_ACTIONS)[number];

/** Fire-and-forget client→server events (data plane in). */
export const CLIENT_EVENTS = ['input'] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/** Server→client broadcast events (data plane out). */
export const SERVER_EVENTS = [
	'ready',
	'output',
	'directory',
	'exit',
	'error',
	'session-created',
	'session-closed',
] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];

// ---- Request/response shapes ----------------------------------------------

export interface CreateSessionRequest {
	sessionId: string;
	namespace: string;
	streamId?: string;
	shell?: string;
	cwd?: string;
	cols?: number;
	rows?: number;
}
export interface CreateSessionResponse {
	sessionId: string;
	streamId: string;
	pid: number;
	currentDirectory: string;
	cols: number;
	rows: number;
}

export interface ResizeRequest {
	sessionId: string;
	cols: number;
	rows: number;
}
export interface ResizeResponse {
	sessionId: string;
	cols: number;
	rows: number;
}

export interface CancelRequest {
	sessionId: string;
}
export interface CancelResponse {
	sessionId: string;
	pid: number;
}

export interface KillSessionRequest {
	sessionId: string;
}
export interface KillSessionResponse {
	sessionId: string;
	pid?: number;
}

export interface ClearRequest {
	sessionId: string;
}
export interface ClearResponse {
	sessionId: string;
}

export interface CheckShellRequest {
	namespace?: string;
}
export interface CheckShellResponse {
	available: boolean;
	path: string | null;
	platform: string;
	isWindows: boolean;
	shellType: string;
}

export interface PtyStatusRequest {
	sessionId: string;
}
export interface PtyStatusResponse {
	isActive: boolean;
	sessionId: string;
	pid?: number;
	message?: string;
}

export interface ListSessionsRequest {
	namespace: string;
}
export interface ListedSession {
	sessionId: string;
	pid: number;
	cwd: string;
	createdAt: string;
	lastActivityAt: string;
}
export interface ListSessionsResponse {
	sessions: ListedSession[];
}

export interface StreamStatusRequest {
	sessionId: string;
}
export interface StreamStatusResponse {
	status: string;
	bufferLength: number;
	startedAt: string;
	processId?: number;
}

export interface MissedOutputRequest {
	sessionId: string;
}
export interface MissedOutputResponse {
	sessionId: string;
	output: string;
	status: string;
	timestamp: string;
}

export interface ReconnectRequest {
	sessionId: string;
}
export interface ReconnectResponse {
	sessionId: string;
	output: string;
	status: string;
}

/** Maps each RPC action to its `{ data, response }` contract. */
export interface RpcMap {
	'create-session': { data: CreateSessionRequest; response: CreateSessionResponse };
	resize: { data: ResizeRequest; response: ResizeResponse };
	cancel: { data: CancelRequest; response: CancelResponse };
	'kill-session': { data: KillSessionRequest; response: KillSessionResponse };
	clear: { data: ClearRequest; response: ClearResponse };
	'check-shell': { data: CheckShellRequest; response: CheckShellResponse };
	'pty-status': { data: PtyStatusRequest; response: PtyStatusResponse };
	'list-sessions': { data: ListSessionsRequest; response: ListSessionsResponse };
	'stream-status': { data: StreamStatusRequest; response: StreamStatusResponse };
	'missed-output': { data: MissedOutputRequest; response: MissedOutputResponse };
	reconnect: { data: ReconnectRequest; response: ReconnectResponse };
}

// ---- Event shapes ----------------------------------------------------------

export interface InputEvent {
	sessionId: string;
	data: string;
}

export interface ReadyEvent {
	sessionId: string;
	streamId: string;
	pid: number;
	cols: number;
	rows: number;
}
export interface OutputEvent {
	sessionId: string;
	content: string;
	seq?: Seq;
	timestamp: string;
}
export interface DirectoryEvent {
	sessionId: string;
	newDirectory: string;
}
export interface ExitEvent {
	sessionId: string;
	exitCode: number;
}
export interface ErrorEvent {
	sessionId: string;
	error: string;
}
/** A session appeared in a room (created by any client, or re-attached). */
export interface SessionCreatedEvent {
	sessionId: string;
	namespace: string;
	streamId: string;
	pid: number;
	currentDirectory: string;
	cols: number;
	rows: number;
}
/** A session was removed from a room (killed). */
export interface SessionClosedEvent {
	sessionId: string;
	namespace: string;
}

/** Maps each server→client event to its payload. */
export interface ServerEventMap {
	ready: ReadyEvent;
	output: OutputEvent;
	directory: DirectoryEvent;
	exit: ExitEvent;
	error: ErrorEvent;
	'session-created': SessionCreatedEvent;
	'session-closed': SessionClosedEvent;
}

// ============================================================================
// Replay hygiene (R17)
// ============================================================================

/**
 * Escape sequences that ask the terminal to *report back* (color, cursor
 * position, device attributes, mode/status). They are emitted by shells and
 * TUI apps (powerlevel10k, starship, vim) and get captured raw into stored
 * session output.
 *
 * During live output these must reach xterm so it can answer the program
 * waiting to read the reply. But when REPLAYING stored history no program is
 * waiting — xterm still answers via `onData`, and that answer gets forwarded to
 * the live PTY and printed at the idle shell prompt. So we strip these requests
 * from replayed content only.
 */
/* eslint-disable no-control-regex -- these patterns deliberately match ANSI escape (ESC) sequences */
const REPORT_REQUEST_PATTERNS: RegExp[] = [
	// OSC color query: ESC ] <ps> ; ? (BEL | ST)
	/\x1b\][0-9;]*\?(?:\x07|\x1b\\)/g,
	// Device Status Report / cursor position request: ESC [ ?? <ps> n
	/\x1b\[\??[0-9;]*n/g,
	// Device Attributes: ESC [ [<=>]? <ps> c
	/\x1b\[[<=>]?[0-9;]*c/g,
	// DECRQM mode query: ESC [ ? <ps> $ p
	/\x1b\[\?[0-9;]*\$p/g,
	// DECRQSS status string request (DCS): ESC P <ps> $ q ... ESC \
	/\x1bP[0-9;]*\$q[\s\S]*?\x1b\\/g,
];
/* eslint-enable no-control-regex */

/** Strip terminal report-request sequences from replayed content (R17). */
export function stripReportRequests(content: string): string {
	let result = content;
	for (const pattern of REPORT_REQUEST_PATTERNS) {
		pattern.lastIndex = 0;
		result = result.replace(pattern, '');
	}
	return result;
}

// ============================================================================
// Logger (injectable, off by default — the core stays silent)
// ============================================================================

/** Minimal logger interface. The library never writes to stdout/stderr itself. */
export interface Logger {
	log(scope: string, ...args: unknown[]): void;
	warn(scope: string, ...args: unknown[]): void;
	error(scope: string, ...args: unknown[]): void;
}

/** A logger that discards everything — the default. */
export const silentLogger: Logger = {
	log() {},
	warn() {},
	error() {},
};
