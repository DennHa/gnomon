// The public roadmap (/roadmap): docs/ROADMAP.md turned into one static page at build time, so the server only serves
// files. Just the Markdown the roadmap uses: headings, paragraphs, lists (with wrapped lines), **bold**, `code`, links.
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Returns { title, html }: the first heading is the page title, each ## a section of its own. */
export function renderRoadmap(md) {
  // Comments (the file's top note, `<!-- id: … -->` after a bullet) aren't shown; a line that is only a comment goes.
  md = md.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n/gm, '').replace(/\s*<!--[\s\S]*?-->/g, '');
  let title = 'Roadmap';
  const out = [];
  let list = null; // items of the list being read
  let para = null; // lines of the paragraph being read
  let inSection = false;
  const flush = () => {
    if (list) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
    if (para) out.push(`<p>${inline(para.join(' '))}</p>`);
    list = para = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^# (.+)/))) {
      flush();
      title = m[1].trim();
    } else if ((m = line.match(/^#{2,3} (.+)/))) {
      flush();
      if (inSection) out.push('</section>');
      const h = m[1].trim();
      out.push(`<section id="${slug(h)}"><h2>${inline(h)}</h2>`);
      inSection = true;
    } else if ((m = line.match(/^[-*] (.+)/))) {
      if (para) flush();
      (list ??= []).push(m[1].trim());
    } else if (!line.trim()) {
      flush();
    } else if (list && /^\s+/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      (para ??= []).push(line.trim());
    }
  }
  flush();
  if (inSection) out.push('</section>');
  return { title, html: out.join('\n') };
}

export function roadmapPage(md) {
  const { title, html } = renderRoadmap(md);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0d0f12">
<title>Gnomon · ${esc(title)}</title>
<link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="/roadmap/roadmap.css">
</head>
<body>
<main>
<header><img src="/icon-192.png" alt="" width="40" height="40"><span>Gnomon</span></header>
<h1>${esc(title)}</h1>
${html}
</main>
<footer><a href="/latest">Download for Mac</a></footer>
</body>
</html>
`;
}
