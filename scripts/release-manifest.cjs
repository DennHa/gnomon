// Writes release/version.json for a Gnomon server's download page (/latest) and the app's update check:
// the version from package.json, today's date, the notes from that version's section in CHANGELOG.md, and the .dmg name.
// Usage: npm run dist && npm run release:manifest, then copy release/version.json and the .dmg into the server's
// releases folder (GNOMON_RELEASES_DIR, see server/README.md).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const file = `Gnomon-${version}-arm64.dmg`;
if (!fs.existsSync(path.join(root, 'release', file))) {
  console.error(`release/${file} is missing: run npm run dist first.`);
  process.exit(1);
}

// "## 0.1.0 · 2026-10-17" … up to the next "## ". Bullets may continue on indented lines.
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`)) ?? '';
const notes = [];
for (const line of section.split('\n').slice(1)) {
  if (line.startsWith('- ')) notes.push(line.slice(2));
  else if (/^\s+\S/.test(line) && notes.length) notes[notes.length - 1] += ` ${line.trim()}`;
}
const manifest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  notes: notes.map((n) => n.replace(/\*\*/g, '')),
  file,
};
fs.writeFileSync(path.join(root, 'release', 'version.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote release/version.json for ${version} (${notes.length} notes)`);
