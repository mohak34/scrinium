// API tokens as listed by /api/tokens, shared by the Devices page (phone
// tokens, no label) and the Agents page (labeled MCP tokens).
export type Token = { token_hash: string; created_at: number; last_used_at: number | null; label: string | null };

export async function listTokens(): Promise<Token[]> {
	const res = await fetch('/api/tokens');
	return res.ok ? res.json() : [];
}

export async function revokeToken(hash: string): Promise<boolean> {
	const res = await fetch('/api/tokens', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token_hash: hash })
	});
	return res.ok;
}

export const day = (ms: number) =>
	new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
