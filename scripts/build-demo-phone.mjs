// The web demo's phone view (dist-demo/phone/): the real phone app (server/web) answering itself in the browser
// (src/demo/phone-setup.ts), in a phone-shaped frame on computers. Run after the Vite build: npm run build:demo.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-demo/phone');
fs.mkdirSync(out, { recursive: true });
const common = {
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['safari16', 'chrome110'],
  jsx: 'automatic',
  nodePaths: [path.join(root, 'server/node_modules'), path.join(root, 'node_modules')],
  loader: { '.svg': 'text', '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
};
await esbuild.build({ ...common, entryPoints: [path.join(root, 'src/demo/phone-main.ts')], outfile: path.join(out, 'app.js') });
await esbuild.build({ ...common, entryPoints: [path.join(root, 'src/demo/frame.ts')], outfile: path.join(out, 'frame.js') });
fs.copyFileSync(path.join(root, 'demo/phone.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(root, 'demo/phone-app.html'), path.join(out, 'app.html'));
for (const f of ['icon-192.png']) fs.copyFileSync(path.join(root, 'server/web/public', f), path.join(root, 'dist-demo', f));
console.log('built dist-demo/phone');
