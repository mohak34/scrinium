import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';
import { toSvelteKitHandler } from 'better-auth/svelte-kit';

const authHandler = toSvelteKitHandler(auth);

export const GET: RequestHandler = authHandler;
export const POST: RequestHandler = authHandler;
