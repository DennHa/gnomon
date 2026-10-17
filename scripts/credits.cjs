// Writes src/credits.json: the open-source projects Gnomon is built with, for Info & feedback.
// Run after updating dependencies: node scripts/credits.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// [package, where it's used, folder with its node_modules]
const LIST = [
  ['electron', 'app', root],
  ['react', 'app', root],
  ['react-dom', 'app', root],
  ['@material-symbols/svg-400', 'app', root],
  ['qrcode-generator', 'app', root],
  ['better-sqlite3', 'server', path.join(root, 'server')],
  ['vite', 'build', root],
  ['typescript', 'build', root],
  ['electron-builder', 'build', root],
];
const HOMEPAGES = { '@material-symbols/svg-400': 'https://github.com/marella/material-symbols' };

const credits = LIST.map(([name, use, dir]) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8'));
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const url = HOMEPAGES[name] ?? pkg.homepage ?? (repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://') : undefined);
  return { name: name === '@material-symbols/svg-400' ? 'Material Symbols' : name, version: pkg.version, license: pkg.license, use, url };
});
fs.writeFileSync(path.join(root, 'src', 'credits.json'), JSON.stringify(credits, null, 2) + '\n');
console.log(credits.map((c) => `${c.name} ${c.version} (${c.license})`).join('\n'));
