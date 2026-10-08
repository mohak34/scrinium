// See https://svelte.dev/docs/kit/types#app.d.ts
import type { auth } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			// Browser session only; null for API-token requests.
			session: Awaited<ReturnType<typeof auth.api.getSession>>;
			// Who the request is for: the session's email or the API token's.
			email: string | null;
		}
	}
}

export {};
