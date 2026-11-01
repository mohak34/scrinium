import { oAuthDiscoveryMetadata } from 'better-auth/plugins';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// OAuth server metadata for MCP clients. The rest param also answers the
// path-suffixed form (/.well-known/oauth-authorization-server/api/auth).
const handler = oAuthDiscoveryMetadata(auth);
export const GET: RequestHandler = ({ request }) => handler(request);
