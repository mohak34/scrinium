import type { PageServerLoad } from './$types';
import { listTree } from '$lib/server/vault';
import { listProjects } from '$lib/server/db';

// The sidebar's data rides with the page, so it never waits for the
// client to boot and ask.
export const load: PageServerLoad = async () => ({ tree: await listTree(), projects: listProjects() });
