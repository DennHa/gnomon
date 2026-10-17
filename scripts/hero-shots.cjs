// Turns the README screenshots into close-up marketing shots: tilted in 3D, zoomed in on one detail, with a
// depth-of-field blur that keeps only the focus area sharp. Output: docs/hero/*.jpg
// Usage: sh scripts/screenshots.sh (and the phone script) first, then
//        node node_modules/electron/cli.js scripts/hero-shots.cjs
// The first-launch tour uses smaller copies in src/assets/tour/ (sips -Z 1200); refresh them after re-rendering.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const shots = path.join(root, 'docs', 'screenshots');
const out = path.join(root, 'docs', 'hero');
const W = 1600, H = 900; // captured at 2x

// focus: the point to keep sharp, as a fraction of the screenshot; tilt in degrees; zoom; sharp: radius of the sharp area.
const SHOTS = [
  { file: 'hero-start-day.jpg', img: 'morning-dark.png', theme: 'dark', focus: [0.12, 0.76], tilt: [22, 28, -6], zoom: 2.1, sharp: 0.24 },
  { file: 'hero-timer.jpg', img: 'track.png', theme: 'dark', focus: [0.68, 0.2], tilt: [16, -20, 4], zoom: 1.45, sharp: 0.45 },
  { file: 'hero-week.jpg', img: 'week-dark.png', theme: 'dark', focus: [0.55, 0.38], tilt: [26, -18, 6], zoom: 1.6, sharp: 0.32 },
  { file: 'hero-balance.jpg', img: 'reports.png', theme: 'dark', focus: [0.7, 0.4], tilt: [20, 26, -5], zoom: 1.7, sharp: 0.3 },
];

const BG = {
  dark: 'radial-gradient(1200px 700px at 70% 30%, rgba(245,180,0,0.22), transparent 60%), radial-gradient(900px 600px at 10% 90%, rgba(120,140,255,0.10), transparent 60%), #0d0f12',
  light: 'radial-gradient(1200px 700px at 30% 20%, rgba(245,180,0,0.25), transparent 60%), linear-gradient(160deg, #fbfbfd, #e9ecf1)',
};

function macHtml(s) {
  const src = `file://${path.join(shots, s.img)}`;
  const iw = 1400; // displayed screenshot width in CSS px
  const ih = Math.round(iw * (1560 / 2240));
  const [fx, fy] = s.focus;
  const [rx, ry, rz] = s.tilt;
  const left = W / 2 - fx * iw, top = H / 2 - fy * ih;
  const mask = `radial-gradient(ellipse ${s.sharp * 100}% ${s.sharp * 140}% at ${fx * 100}% ${fy * 100}%, #000 45%, transparent 100%)`;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${BG[s.theme]}; }
    .scene { position: absolute; inset: 0; perspective: 1600px; }
    .shot { position: absolute; left: ${left}px; top: ${top}px; width: ${iw}px; height: ${ih}px;
      transform-origin: ${fx * 100}% ${fy * 100}%;
      transform: rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s.zoom}); transform-style: preserve-3d; }
    .shot img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 22px; }
    .far { filter: blur(7px) saturate(1.05); box-shadow: 0 60px 120px rgba(0,0,0,${s.theme === 'dark' ? 0.6 : 0.22}); }
    .near { -webkit-mask-image: ${mask}; mask-image: ${mask}; }
    .vignette { position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse at 50% 50%, transparent 55%, ${s.theme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)'}); }
  </style></head><body><div class="scene"><div class="shot">
    <img class="far" src="${src}"><img class="near" src="${src}">
  </div></div><div class="vignette"></div></body></html>`;
}

// Two phones: the time clock (Stempeln) in front and sharp, the week behind and out of focus.
function phoneHtml() {
  const a = `file://${path.join(shots, 'phone-clock-dark.png')}`;
  const b = `file://${path.join(shots, 'phone-week.png')}`;
  const phone = (src, cls) => `<div class="phone ${cls}"><img src="${src}"></div>`;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${BG.dark}; }
    .scene { position: absolute; inset: 0; perspective: 1800px; }
    .phone { position: absolute; width: 390px; height: 844px; border-radius: 58px; padding: 14px; background: #1c1f23;
      box-shadow: inset 0 0 0 2px #3a3f46, 0 50px 100px rgba(0,0,0,0.6); }
    .phone img { width: 100%; height: 100%; border-radius: 44px; display: block; }
    .back { left: 860px; top: 40px; transform: rotateY(-28deg) rotateX(10deg) rotateZ(6deg) scale(1.05); filter: blur(6px) brightness(0.85); }
    .front { left: 420px; top: 120px; transform: rotateY(24deg) rotateX(14deg) rotateZ(-8deg) scale(1.25); }
  </style></head><body><div class="scene">${phone(b, 'back')}${phone(a, 'front')}</div></body></html>`;
}

async function render(win, html, file) {
  const tmp = path.join(os.tmpdir(), `gnomon-hero-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await win.webContents.executeJavaScript('Promise.all([...document.images].map((i) => i.decode()))');
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, file), img.toJPEG(88));
  fs.rmSync(tmp, { force: true });
  console.log(`✓ docs/hero/${file}`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { webSecurity: true } });
  try {
    for (const s of SHOTS) await render(win, macHtml(s), s.file);
    await render(win, phoneHtml(), 'hero-phone.jpg');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  app.quit();
});
