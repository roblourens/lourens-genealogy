import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Vite root is the `site/` folder. The Mapbox token is read from `.env.local`
// at the repository root (one level up) so secrets stay out of `site/`.
export default defineConfig({
	root: 'site',
	publicDir: 'public',
	envDir: resolve(__dirname),
	server: { port: 5180, open: true },
	build: { outDir: '../dist', emptyOutDir: true },
});
