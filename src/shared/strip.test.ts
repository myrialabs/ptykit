import { expect, test } from 'bun:test';
import { stripReportRequests } from './index.js';

test('strips OSC color queries but keeps surrounding text', () => {
	const input = 'before\x1b]11;?\x07after';
	expect(stripReportRequests(input)).toBe('beforeafter');
});

test('strips cursor-position / device-status reports (ESC[6n)', () => {
	expect(stripReportRequests('a\x1b[6nb')).toBe('ab');
});

test('strips device-attributes requests (ESC[c, ESC[>c)', () => {
	expect(stripReportRequests('x\x1b[cy\x1b[>0cz')).toBe('xyz');
});

test('strips DECRQM mode queries (ESC[?2026$p)', () => {
	expect(stripReportRequests('\x1b[?2026$pok')).toBe('ok');
});

test('leaves ordinary color/styling SGR sequences intact', () => {
	const colored = '\x1b[31mred\x1b[0m';
	expect(stripReportRequests(colored)).toBe(colored);
});

test('is idempotent and global (handles repeats)', () => {
	const input = '\x1b[6n\x1b[6ntext\x1b[6n';
	expect(stripReportRequests(input)).toBe('text');
	expect(stripReportRequests(stripReportRequests(input))).toBe('text');
});
