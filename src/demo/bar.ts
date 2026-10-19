// The demo's small bar: what this is, a switch between the Mac and the phone view, reset, and the download.
// Plain DOM, so it works the same on top of both apps.
import { demoLanguage, resetDemo } from './storage';

const TEXT = {
  en: { demo: 'Demo with made-up data', mac: 'Mac view', phone: 'Phone view', reset: 'Reset', download: 'Download for Mac', note: 'Your changes stay in this browser.' },
  de: { demo: 'Demo mit erfundenen Daten', mac: 'Mac-Ansicht', phone: 'Handy-Ansicht', reset: 'Zurücksetzen', download: 'Für Mac laden', note: 'Deine Änderungen bleiben in diesem Browser.' },
};

export function mountDemoBar(view: 'mac' | 'phone') {
  const t = TEXT[demoLanguage()];
  const bar = document.createElement('div');
  bar.className = `demo-bar demo-bar-${view}`;
  bar.setAttribute('role', 'note');
  const link = (label: string, href: string, primary = false) => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    if (primary) a.className = 'primary';
    a.target = '_top'; // from inside the phone frame, leave the frame
    return a;
  };
  const strong = document.createElement('strong');
  strong.textContent = t.demo;
  strong.title = t.note;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = t.reset;
  reset.onclick = resetDemo;
  bar.append(strong, view === 'mac' ? link(t.phone, 'phone/') : link(t.mac, '../'), reset, link(t.download, '/latest', true));
  document.body.append(bar);
}
