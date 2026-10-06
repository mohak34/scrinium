import { error } from '@sveltejs/kit';

// A timestamp from an API client (due_at, remind_at): null/'' clears it,
// otherwise finite non-negative milliseconds or an ISO date-time string.
// A bare date ("2026-10-10") is refused: the server can't know whose
// midnight it means, and Date.parse would pick UTC (the evening before in
// the Americas).
export function parseStamp(v: unknown, what: string): number | null {
	if (v === null || v === '') return null;
	let n = NaN;
	if (typeof v === 'number') n = v;
	else if (typeof v === 'string' && /\dT\d/.test(v)) n = Date.parse(v);
	if (!Number.isFinite(n) || n < 0) throw error(400, `Bad ${what}: use milliseconds or an ISO date-time`);
	return Math.round(n);
}
