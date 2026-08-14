import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// adapter-node (not adapter-static!) on purpose - `deno desktop` needs
		// a real server entry point to detect and wrap later. See README.
		adapter: adapter(),
		csrf: {
			// Native mobile client sends no Origin header; the API is otherwise
			// gated by Bearer token / SameSite=Lax sessions in hooks.server.ts.
			checkOrigin: false
		}
	}
};

export default config;
