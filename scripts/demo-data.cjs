// Writes a made-up data.json for screenshots: the same data as the web demo (src/demo/data.ts), for a given moment.
// Usage: node scripts/demo-data.cjs <folder> <now as ISO, e.g. 2026-10-14T14:35:00> [en|de]
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const [dir, nowArg, language = 'en'] = process.argv.slice(2);
if (!dir || !nowArg) {
  console.error('Usage: node scripts/demo-data.cjs <folder> <now ISO> [en|de]');
  process.exit(1);
}

// Bundle the TypeScript generator on the fly and load it as a CommonJS module.
const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/demo/data.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
const data = mod.exports.demoData(new Date(nowArg), language);

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data, null, 2));
console.log(`wrote ${path.join(dir, 'data.json')}: ${data.entries.length} entries, ${data.workdays.length} days`);
