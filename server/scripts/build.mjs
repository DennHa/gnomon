// Builds the server (dist/server.mjs, dist/admin.mjs), the web app (dist/web/) and, with --tests, the tests.
// The server bundles the Mac app's own API logic from ../src, so both answer API.md the same way.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
// ../src imports react (for hooks the server never calls); resolve it from server/node_modules.
const nodePaths = [path.join(root, 'node_modules')];
const node = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  nodePaths,
  external: ['better-sqlite3'],
  logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};

if (process.argv.includes('--tests')) {
  const tests = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.ts'));
  fs.rmSync(path.join(root, 'dist-test'), { recursive: true, force: true });
  await esbuild.build({ ...node, entryPoints: tests.map((f) => path.join(root, 'tests', f)), outdir: path.join(root, 'dist-test'), outExtension: { '.js': '.mjs' } });
} else {
  fs.rmSync(out, { recursive: true, force: true });
  await esbuild.build({ ...node, entryPoints: { server: 'src/server.ts', admin: 'src/admin.ts' }, absWorkingDir: root, outdir: out, outExtension: { '.js': '.mjs' } });
  await esbuild.build({
    entryPoints: [path.join(root, 'web/main.tsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['safari16', 'chrome110'],
    jsx: 'automatic',
    nodePaths,
    loader: { '.svg': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(out, 'web/app.js'),
    logLevel: 'warning',
  });
  // Static files; the service worker gets a build id so a new deploy replaces the cached app.
  for (const f of fs.readdirSync(path.join(root, 'web/public'))) fs.copyFileSync(path.join(root, 'web/public', f), path.join(out, 'web', f));
  const sw = path.join(out, 'web/sw.js');
  fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replaceAll('__BUILD__', Date.now().toString(36)));
}
