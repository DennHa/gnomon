// Votes, comments and suggestions on the roadmap (Info & feedback → What's coming in the app, Roadmap on the Admin
// page). Only signed-in people take part; others see counts, never who voted. Suggestions wait for an admin's OK.
// The items come from docs/ROADMAP.md as built into dist/roadmap (src/roadmap.ts gives them their ids).
import fs from 'node:fs';
import path from 'node:path';
import { parseRoadmap, VOTABLE, type RoadmapSection } from '../../src/roadmap';
import type { Store } from './store';

type Fail = (status: number, code: string, message: string) => Error;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function roadmapFeedback(store: Store, roadmapDir: string | undefined, version: string, fail: Fail) {
  // Read once per change of the file (a deploy replaces it), not per request.
  let cache: { mtime: number; sections: RoadmapSection[] } | null = null;
  function sections(): RoadmapSection[] {
    const file = roadmapDir && path.join(roadmapDir, 'ROADMAP.md');
    if (!file || !fs.existsSync(file)) return [];
    const mtime = fs.statSync(file).mtimeMs;
    if (cache?.mtime !== mtime) cache = { mtime, sections: parseRoadmap(fs.readFileSync(file, 'utf8')) };
    return cache.sections;
  }

  /** What a person sees: counts, their own votes and comments, approved suggestions and their own waiting ones. */
  function board(personId: string) {
    const { counts, mine } = store.roadmapVotes(personId);
    const comments = store.roadmapComments();
    const commentsOf = (target: string) => comments.filter((c) => c.target === target).map((c) => ({ id: c.id, name: c.name, text: c.text, at: c.at, mine: c.personId === personId }));
    const voting = (id: string) => ({ votes: counts.get(id) ?? 0, voted: mine.has(id), comments: commentsOf(id) });
    return {
      sections: sections().map((s) => ({ key: s.key, title: s.title, intro: s.intro, votable: VOTABLE.has(s.key), items: s.items.map((it) => ({ ...it, ...(VOTABLE.has(s.key) ? voting(it.id) : { votes: 0, voted: false, comments: [] }) })) })),
      suggestions: store
        .roadmapSuggestions()
        .filter((x) => x.status === 'approved' || (x.personId === personId && x.status === 'waiting'))
        .map((x) => ({ id: x.id, title: x.title, text: x.text, name: x.name, status: x.status, mine: x.personId === personId, ...(x.status === 'approved' ? voting(x.id) : { votes: 0, voted: false, comments: [] }) })),
    };
  }

  /** Items and approved suggestions can be voted on and commented. */
  function open(target: string): boolean {
    if (sections().some((s) => VOTABLE.has(s.key) && s.items.some((it) => it.id === target))) return true;
    return store.roadmapSuggestions().some((x) => x.id === target && x.status === 'approved');
  }

  /** The routes for signed-in devices and the web app, under /api/v1/roadmap. */
  function route(method: string, p: string, body: unknown, personId: string): { status: number; body: unknown } | undefined {
    if (!p.startsWith('/roadmap/')) return undefined;
    if (method === 'GET' && p === '/roadmap/board') return { status: 200, body: board(personId) };
    const vote = p.match(/^\/roadmap\/votes\/([\w-]{1,80})$/);
    if (vote && method === 'PUT') {
      if (!open(vote[1])) throw fail(404, 'not_found', 'No such roadmap item');
      store.setRoadmapVote(vote[1], personId, !(isObj(body) && body.on === false));
      return { status: 200, body: board(personId) };
    }
    if (method === 'POST' && p === '/roadmap/comments') {
      const target = isObj(body) ? str(body.target) : '';
      const text = isObj(body) ? str(body.text) : '';
      if (!open(target)) throw fail(404, 'not_found', 'No such roadmap item');
      if (!text || text.length > 1000) throw fail(422, 'invalid', 'Write between 1 and 1000 characters');
      if (store.roadmapComments().filter((c) => c.personId === personId && Date.now() - Date.parse(c.at) < 3_600_000).length >= 30) throw fail(429, 'too_many', 'Too many comments at once. Please try again in an hour.');
      store.addRoadmapComment(target, personId, text, isObj(body) && body.anonymous === true);
      return { status: 201, body: board(personId) };
    }
    const del = p.match(/^\/roadmap\/comments\/(\d{1,12})$/);
    if (del && method === 'DELETE') {
      const c = store.roadmapComment(Number(del[1]));
      if (!c || c.personId !== personId) throw fail(404, 'not_found', 'No such comment');
      store.deleteRoadmapComment(c.id);
      return { status: 200, body: board(personId) };
    }
    if (method === 'POST' && p === '/roadmap/suggestions') {
      const title = isObj(body) ? str(body.title) : '';
      const text = isObj(body) ? str(body.text) : '';
      if (!title || title.length > 80) throw fail(422, 'invalid', 'Give the idea a title of up to 80 characters');
      if (text.length > 500) throw fail(422, 'invalid', 'Describe it in up to 500 characters');
      if (store.roadmapSuggestions().filter((x) => x.personId === personId && x.status === 'waiting').length >= 10) throw fail(429, 'too_many', 'You have 10 ideas waiting for approval already.');
      store.addRoadmapSuggestion(personId, title, text, isObj(body) && body.anonymous === true);
      return { status: 201, body: board(personId) };
    }
    throw fail(404, 'not_found', 'Not found');
  }

  /** Everything for the Admin page: all items and suggestions with counts and comments, plus orphaned ids. */
  function adminView() {
    const { counts, people } = store.roadmapVotes();
    const comments = store.roadmapComments().map(({ personId: _p, ...c }) => c);
    const commentsOf = (target: string) => comments.filter((c) => c.target === target);
    const secs = sections();
    const known = new Set([...secs.flatMap((s) => s.items.map((it) => it.id)), ...store.roadmapSuggestions().map((x) => x.id)]);
    const orphanIds = [...new Set([...counts.keys(), ...comments.map((c) => c.target)])].filter((id) => !known.has(id));
    return {
      people,
      sections: secs.map((s) => ({ key: s.key, title: s.title, votable: VOTABLE.has(s.key), items: s.items.map((it) => ({ ...it, votes: counts.get(it.id) ?? 0, comments: commentsOf(it.id) })) })),
      suggestions: store.roadmapSuggestions().map(({ personId: _p, ...x }) => ({ ...x, votes: counts.get(x.id) ?? 0, comments: commentsOf(x.id) })),
      orphans: orphanIds.map((id) => ({ id, votes: counts.get(id) ?? 0, comments: commentsOf(id) })),
    };
  }

  /** One plain Markdown text for the product owner's planning chat: stable ids, sorted by votes, no names or emails. */
  function exportText(today = new Date().toISOString().slice(0, 10)): string {
    const v = adminView();
    const byVotes = <T extends { votes: number; comments: unknown[] }>(list: T[]) => list.map((x, i) => ({ x, i })).sort((a, b) => b.x.votes - a.x.votes || b.x.comments.length - a.x.comments.length || a.i - b.i).map(({ x }) => x);
    const one = (s: string) => s.replace(/\s+/g, ' ').trim();
    const votes = (n: number) => `${n} vote${n === 1 ? '' : 's'}`;
    const lines = (id: string, title: string, extra: string, n: number, text: string, cs: { text: string }[]) => [
      `- [${id}] ${one(title)}${extra} · ${votes(n)}`,
      ...(text ? [`  ${one(text)}`] : []),
      ...cs.map((c) => `  - "${one(c.text)}"`),
    ];
    const out = [
      '# Gnomon roadmap feedback',
      `Server ${version} · ${today} · ${v.people} ${v.people === 1 ? 'person' : 'people'} voted · ids in [brackets] are stable · comments are anonymous`,
      '',
      '## Roadmap items (by votes)',
    ];
    const items = v.sections.flatMap((s) => s.items.filter((it) => s.votable || it.votes || it.comments.length).map((it) => ({ ...it, section: s.title })));
    for (const it of byVotes(items)) out.push(...lines(it.id, it.title, ` (${it.section})`, it.votes, '', it.comments));
    const group = (title: string, status: string) => {
      const list = byVotes(v.suggestions.filter((x) => x.status === status));
      out.push('', `## ${title}`);
      if (!list.length) out.push('- none');
      for (const x of list) out.push(...lines(x.id, x.title, '', x.votes, x.text, x.comments));
    };
    group('Suggestions by people, approved (by votes)', 'approved');
    group('Suggestions by people, waiting for approval', 'waiting');
    const hidden = v.suggestions.filter((x) => x.status === 'hidden').length;
    if (hidden) out.push('', `(${hidden} hidden suggestion${hidden === 1 ? '' : 's'} left out.)`);
    if (v.orphans.length) {
      out.push('', '## Votes and comments for ids no longer on the roadmap');
      for (const o of byVotes(v.orphans)) out.push(...lines(o.id, '(renamed or removed)', '', o.votes, '', o.comments));
    }
    return `${out.join('\n')}\n`;
  }

  /** The Admin page's routes, under /api/v1/admin/roadmap (the caller checks the admin session). */
  function adminRoute(method: string, p: string, body: unknown): [number, unknown] | undefined {
    if (method === 'GET' && p === '/admin/roadmap') return [200, adminView()];
    if (method === 'GET' && p === '/admin/roadmap/export') return [200, { text: exportText() }];
    const sug = p.match(/^\/admin\/roadmap\/suggestions\/(idea-\d{1,12})$/);
    if (sug && method === 'PUT') {
      const status = isObj(body) ? body.status : undefined;
      if (status !== 'approved' && status !== 'hidden' && status !== 'waiting') throw fail(422, 'invalid', 'status must be approved, hidden or waiting');
      if (!store.setRoadmapSuggestionStatus(sug[1], status)) throw fail(404, 'not_found', 'No such suggestion');
      return [200, adminView()];
    }
    const del = p.match(/^\/admin\/roadmap\/comments\/(\d{1,12})$/);
    if (del && method === 'DELETE') {
      store.deleteRoadmapComment(Number(del[1]));
      return [200, adminView()];
    }
    return undefined;
  }

  const waiting = () => store.roadmapSuggestions().filter((x) => x.status === 'waiting').length;
  return { route, adminRoute, exportText, waiting };
}
