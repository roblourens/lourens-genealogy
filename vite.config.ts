import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite root is the `site/` folder. The Mapbox token is read from `.env.local`
// at the repository root (one level up) so secrets stay out of `site/`.
export default defineConfig({
	root: 'site',
	publicDir: 'public',
	// Served from '/' locally; CI sets BASE_PATH to '/<repo>/' for GitHub Pages
	// project sites so the injected asset URLs resolve under the repo subpath.
	base: process.env.BASE_PATH || '/',
	envDir: resolve(__dirname),
	server: { port: 5180, open: true },
	build: { outDir: '../dist', emptyOutDir: true },
});
