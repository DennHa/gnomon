import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The production bundle is loaded from file:// and talks to Clockify only via the main process,
// so it can run under a strict CSP. Dev mode skips it because React refresh injects inline scripts.
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" />`,
    ),
};

export default defineConfig({
  base: './',
  plugins: [react(), csp],
  server: { port: 5173, strictPort: true },
});
