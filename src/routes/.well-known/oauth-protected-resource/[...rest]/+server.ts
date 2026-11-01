import { oAuthProtectedResourceMetadata } from 'better-auth/plugins';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// Tells MCP clients which server issues tokens for /api/mcp. The rest param
// also answers the path-suffixed form (/.well-known/oauth-protected-resource/api/mcp).
const handler = oAuthProtectedResourceMetadata(auth);
export const GET: RequestHandler = ({ request }) => handler(request);
