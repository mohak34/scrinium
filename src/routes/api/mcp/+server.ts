import type { RequestHandler } from './$types';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { env } from '$env/dynamic/private';
import { createMcpServer } from '$lib/server/mcp';

// Remote MCP endpoint (streamable HTTP) for agents. Auth is the usual /api
// gate in hooks.server.ts: a bearer token from Settings > Devices and agents.
// Stateless: a fresh server per request, plain JSON responses, no sessions.
const handle: RequestHandler = async ({ request, fetch, url }) => {
	// Behind Caddy url.origin is plain http; the auth URL is the public one.
	const origin = (env.BETTER_AUTH_URL || url.origin).replace(/\/+$/, '');
	const server = createMcpServer(fetch, origin);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	return transport.handleRequest(request);
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
