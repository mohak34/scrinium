import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		// Tailnet previews: `VITE_ALLOWED_HOSTS=myhost.example.ts.net bun run dev`
		allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean)
	}
});
