// The roadmap (docs/ROADMAP.md) as data, for the "What's coming" board in Info & feedback and for the server, which
// keeps votes and comments per item. Each bullet "- **Title.** Text" is an item; its id is a slug of the title, or
// the explicit `<!-- id: some-id -->` after it, so a renamed item keeps its votes.

export type RoadmapSectionKey = 'now' | 'next' | 'later' | 'done' | 'out';
export type RoadmapItem = { id: string; title: string; text: string };
export type RoadmapSection = { key: RoadmapSectionKey | string; title: string; intro: string; items: RoadmapItem[] };

/** Sections people can vote in; "What Gnomon does today" and "Left out on purpose" are only shown. */
export const VOTABLE = new Set<string>(['now', 'next', 'later']);

const KEYS: Record<string, RoadmapSectionKey> = { now: 'now', next: 'next', later: 'later', 'what gnomon does today': 'done', 'left out on purpose': 'out' };

export const roadmapSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Ids from the title: "A drafted day." → "a-drafted-day". Duplicates get -2, -3. */
export function parseRoadmap(md: string): RoadmapSection[] {
  const sections: RoadmapSection[] = [];
  const seen = new Set<string>();
  let sec: RoadmapSection | null = null;
  let item: string | null = null;
  const flushItem = () => {
    if (!sec || item === null) return;
    const explicit = item.match(/<!--\s*id:\s*([a-z0-9-]+)\s*-->/i)?.[1]?.toLowerCase();
    const clean = item.replace(/<!--[\s\S]*?-->/g, '').trim();
    const m = clean.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    const title = (m ? m[1] : clean).replace(/[.:]\s*$/, '').trim();
    let id = explicit || roadmapSlug(title) || 'item';
    for (let n = 2; seen.has(id); n++) id = `${explicit || roadmapSlug(title)}-${n}`;
    seen.add(id);
    sec.items.push({ id, title, text: (m ? m[2] : '').trim() });
    item = null;
  };
  // Comments that span lines (the file's top note) go; one-line id comments stay with their bullet.
  const text = md.replace(/<!--(?![^\n]*?-->)[\s\S]*?-->/g, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^#{2,3} (.+)/))) {
      flushItem();
      const title = m[1].trim();
      sec = { key: KEYS[title.toLowerCase()] ?? roadmapSlug(title), title, intro: '', items: [] };
      sections.push(sec);
    } else if (!sec) continue;
    else if ((m = line.match(/^[-*] (.+)/))) {
      flushItem();
      item = m[1].trim();
    } else if (item !== null && /^\s+\S/.test(line)) item += ` ${line.trim()}`;
    else if (!line.trim()) flushItem();
    else if (item === null && !line.startsWith('#')) sec.intro = `${sec.intro} ${line.trim()}`.trim();
  }
  flushItem();
  return sections;
}

// ---- The board as the server hands it out (server/src/roadmap.ts): counts, never who voted --------------------------

export type RoadmapComment = { id: number; name: string; text: string; at: string; mine: boolean };
type Voting = { votes: number; voted: boolean; comments: RoadmapComment[] };
export type RoadmapBoard = {
  sections: (Omit<RoadmapSection, 'items'> & { votable: boolean; items: (RoadmapItem & Voting)[] })[];
  suggestions: (RoadmapItem & Voting & { name: string; status: 'waiting' | 'approved'; mine: boolean })[];
};
