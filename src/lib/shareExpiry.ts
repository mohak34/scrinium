// Lifetimes offered when a share link is made (days; null never expires).
export const SHARE_LIFETIMES: { label: string; days: number | null }[] = [
	{ label: 'Never expires', days: null },
	{ label: 'Expires in 1 day', days: 1 },
	{ label: 'Expires in 7 days', days: 7 },
	{ label: 'Expires in 30 days', days: 30 }
];

export const MAX_SHARE_DAYS = 365;

// "expires in 3 days", "expires in 5 hours", "expired"; '' for never.
export function expiryLabel(expiresAt: number | null, now = Date.now()): string {
	if (expiresAt === null) return '';
	const hours = (expiresAt - now) / 3_600_000;
	if (hours <= 0) return 'expired';
	if (hours < 1) return 'expires within the hour';
	const [n, unit] = hours < 23 ? [Math.round(hours), 'hour'] : [Math.round(hours / 24), 'day'];
	return `expires in ${n} ${unit}${n === 1 ? '' : 's'}`;
}
