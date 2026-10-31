// Renders the picture behind the install window from build/dmg-background.svg:
//   build/dmg-background.png (660×452) and build/dmg-background@2x.png (Retina, 1320×904)
// electron-builder joins the two into one image for Finder and sizes the window from it (dmg.window is ignored when
// there is a background). Text in the SVG uses the Mac's system fonts.
// Run with: npm run dmg-background
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');

// Runs in the page: draws the SVG onto a canvas and returns a PNG data URL.
async function render(url, scale) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth * scale;
  c.height = img.naturalHeight * scale;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// A throwaway profile: this script never needs the app's own data folder.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-dmg-')));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const url = `data:image/svg+xml;base64,${fs.readFileSync(path.join(build, 'dmg-background.svg')).toString('base64')}`;
  for (const [suffix, scale] of [['', 1], ['@2x', 2]]) {
    const dataUrl = await win.webContents.executeJavaScript(`(${render})(${JSON.stringify(url)}, ${scale})`);
    fs.writeFileSync(path.join(build, `dmg-background${suffix}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote build/dmg-background${suffix}.png`);
  }
  app.quit();
});
