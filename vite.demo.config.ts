// The web demo's Mac view (/example on a Gnomon server): the app's own interface with a browser bridge (src/demo).
// npm run build:demo builds it, and the phone view next to it, into dist-demo/.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'demo',
  base: './',
  publicDir: false,
  plugins: [react()],
  build: { outDir: '../dist-demo', emptyOutDir: true, rollupOptions: { input: 'demo/index.html' } },
});
