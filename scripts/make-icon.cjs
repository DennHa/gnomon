// Renders the icons from the SVGs in build/:
//   build/gnomon-app.svg  → build/icon.png (macOS app icon, via electron-builder) and the phone web app icons
//   build/gnomon-mark.svg → electron/assets/trayTemplate(@2x).png, the menu bar symbol
// Run with: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svgUrl = (file) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'build', file)).toString('base64')}`;

// Runs in the page: draws the SVG onto a canvas and returns a PNG data URL.
// mode "macos": the icon (already a rounded square) on the 824px macOS icon grid, centred in 1024 (scaled to size).
// mode "full": edge to edge on a dark fill (phones round the corners themselves).
// mode "template": black silhouette with the SVG's alpha, inset by `pad` pixels, for a menu bar template image.
async function render(url, size, mode, pad) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (mode === 'macos') {
    // The SVG is already the rounded square; place it on the 824px grid with the usual soft shadow.
    const k = size / 1024, m = 100 * k, s = 824 * k;
    g.shadowColor = 'rgba(0,0,0,0.3)';
    g.shadowBlur = 20 * k;
    g.shadowOffsetY = 10 * k;
    g.drawImage(img, m, m, s, s);
  } else if (mode === 'template') {
    g.drawImage(img, pad, pad, size - 2 * pad, size - 2 * pad);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
  } else {
    // Phones round the corners themselves and show transparency as black, so fill behind the rounded square.
    // Same gradient as the logo's background, so its edge doesn't show.
    const k = size / 1024;
    const bg = g.createLinearGradient(256 * k, 0, 911 * k, size);
    bg.addColorStop(0, '#282B30');
    bg.addColorStop(1, '#13181C');
    g.fillStyle = bg;
    g.fillRect(0, 0, size, size);
    // A little larger, so the rounded square's edge (with its inner shadow) falls outside the phone's own mask.
    const o = size * 0.06;
    g.drawImage(img, -o, -o, size + 2 * o, size + 2 * o);
  }
  return c.toDataURL('image/png');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const out = async (file, svg, size, mode, pad = 0) => {
    const dataUrl = await win.webContents.executeJavaScript(`(${render})(${JSON.stringify(svgUrl(svg))}, ${size}, '${mode}', ${pad})`);
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote ${file}`);
  };
  await out('build/icon.png', 'gnomon-app.svg', 1024, 'macos');
  await out('server/web/public/icon-512.png', 'gnomon-app.svg', 512, 'full');
  await out('server/web/public/icon-192.png', 'gnomon-app.svg', 192, 'full');
  await out('server/web/public/apple-touch-icon.png', 'gnomon-app.svg', 180, 'full');
  // Menu bar: 18 pt with 1 pt of air around the disc.
  await out('electron/assets/trayTemplate.png', 'gnomon-mark.svg', 18, 'template', 1);
  await out('electron/assets/trayTemplate@2x.png', 'gnomon-mark.svg', 36, 'template', 2);
  app.quit();
});
