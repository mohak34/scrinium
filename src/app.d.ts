// See https://svelte.dev/docs/kit/types#app.d.ts
import type { auth } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			session: Awaited<ReturnType<typeof auth.api.getSession>>;
		}
	}
}

export {};
