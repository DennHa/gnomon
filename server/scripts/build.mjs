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
// The version people see (gnomon-admin status, the setup page) is the app's, from the repository's package.json.
const version = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8')).version;
const node = {
  bundle: true,
  define: { __GNOMON_VERSION__: JSON.stringify(version) },
  platform: 'node',
  format: 'esm',
  target: 'node20',
  nodePaths,
  external: ['better-sqlite3-multiple-ciphers'],
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
  // The setup wizard and Admin page (/setup, /admin).
  await esbuild.build({
    entryPoints: [path.join(root, 'web/admin.tsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['safari16', 'chrome110'],
    jsx: 'automatic',
    nodePaths,
    loader: { '.svg': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(out, 'web/admin.js'),
    logLevel: 'warning',
  });
  // Everyone's own account and registration (/account, /account/register).
  await esbuild.build({
    entryPoints: [path.join(root, 'web/account.tsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['safari16', 'chrome110'],
    jsx: 'automatic',
    nodePaths,
    loader: { '.svg': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(out, 'web/account.js'),
    logLevel: 'warning',
  });
  // The web app (/app): the Mac app's own interface (../src) with a bridge to this server (src/web/bridge.ts).
  // Vite-style `?raw` imports (icons, the changelog) become text; a changelog that isn't there is left empty.
  const raw = {
    name: 'raw',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, async (a) => {
        const file = a.path.slice(0, -4);
        if (file.startsWith('.')) return { path: path.resolve(a.resolveDir, file), namespace: 'raw' };
        const r = await build.resolve(file, { resolveDir: a.resolveDir, kind: a.kind });
        return r.errors.length ? { errors: r.errors } : { path: r.path, namespace: 'raw' };
      });
      build.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.existsSync(a.path) ? fs.readFileSync(a.path, 'utf8') : '', loader: 'text' }));
    },
  };
  const appOut = path.join(out, 'web/app');
  await esbuild.build({
    entryPoints: { app: path.join(root, '../src/web/main.tsx') },
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['safari16', 'chrome110'],
    jsx: 'automatic',
    nodePaths,
    plugins: [raw],
    loader: { '.png': 'file', '.jpg': 'file', '.svg': 'text', '.json': 'json' },
    assetNames: 'assets/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
    outdir: appOut,
    logLevel: 'warning',
  });
  fs.copyFileSync(path.join(root, '../src/web/index.html'), path.join(appOut, 'index.html'));
  // Static files; the service worker gets a build id so a new deploy replaces the cached app.
  for (const f of fs.readdirSync(path.join(root, 'web/public'))) fs.copyFileSync(path.join(root, 'web/public', f), path.join(out, 'web', f));
  const sw = path.join(out, 'web/sw.js');
  fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replaceAll('__BUILD__', Date.now().toString(36)));
  // The public roadmap (/roadmap) from docs/ROADMAP.md; without that file, /roadmap isn't served.
  const roadmap = path.join(root, '../docs/ROADMAP.md');
  if (fs.existsSync(roadmap)) {
    const { roadmapPage } = await import('../roadmap/render.mjs');
    fs.mkdirSync(path.join(out, 'roadmap'));
    fs.writeFileSync(path.join(out, 'roadmap/index.html'), roadmapPage(fs.readFileSync(roadmap, 'utf8')));
    fs.copyFileSync(path.join(root, 'roadmap/roadmap.css'), path.join(out, 'roadmap/roadmap.css'));
    // The Markdown too, for the board in the app (votes and comments per item, src/roadmap.ts).
    fs.copyFileSync(roadmap, path.join(out, 'roadmap/ROADMAP.md'));
  }
}
