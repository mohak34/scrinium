import type { PageServerLoad } from './$types';
import { openShare } from '$lib/server/shares';

// Open links arrive drawn, so the note shows at once and chat apps can
// preview its title. A password link sends nothing about the note until
// it is unlocked.
export const load: PageServerLoad = async ({ params }) => {
	try {
		return { state: 'ready' as const, share: await openShare(params.id, null), message: '' };
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } };
		if (err.status === 401) return { state: 'locked' as const, share: null, message: '' };
		if (err.status === 404 || err.status === 410) {
			return { state: 'error' as const, share: null, message: err.body?.message ?? '' };
		}
		throw e;
	}
};
