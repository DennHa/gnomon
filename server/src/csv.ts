// CSV as Excel and others write it: fields separated by a comma, semicolon or tab, quoted with "…" when they hold the
// separator, a quote ("" inside) or a line break. No node imports: the Admin page uses it in the browser too.

export type Separator = ',' | ';' | '\t';

/** The separator of a list: the one found most often outside quotes in its first line that has any. */
export function guessSeparator(text: string): Separator {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const count = { '\t': 0, ';': 0, ',': 0 };
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch in count) count[ch as Separator]++;
    }
    // A tab is never part of a name; a semicolon wins over a comma ("Doe, Jane; jane@example.com").
    if (count['\t']) return '\t';
    if (count[';']) return ';';
    if (count[',']) return ',';
  }
  return ',';
}

/** Rows of fields. A leading byte order mark is dropped; a quoted field may span lines. Each row has its line number. */
export function parseCsv(text: string, sep: Separator = guessSeparator(text)): { line: number; fields: string[] }[] {
  const s = text.replace(/^﻿/, '');
  const rows: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRow = () => {
    fields.push(field);
    rows.push({ line: start, fields });
    fields = [];
    field = '';
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (ch === sep) {
      fields.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      endRow();
      start = ++line;
    } else field += ch;
  }
  if (field || fields.length) endRow();
  return rows;
}

/** A CSV file with a byte order mark (so Excel reads it as UTF-8). Cells that Excel would run as a formula get a '. */
export function toCsv(rows: string[][], sep: Separator = ','): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /["\r\n]/.test(safe) || safe.includes(sep) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(sep)).join('\r\n') + '\r\n';
}
