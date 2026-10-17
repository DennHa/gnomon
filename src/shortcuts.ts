import type React from 'react';

// Global keyboard shortcuts: defaults, how they're shown (⌃⌥P) and how a key press becomes an Electron accelerator.

export type ShortcutConfig = {
  /** Open the quick switcher (start / switch). */
  quick: string;
  /** Stop the running timer, or resume the last entry. */
  stopResume: string;
  /** Start or end a break. */
  breakToggle: string;
  /** Modifier for "start project 1–9" (e.g. "Control+Alt"); empty turns them off. */
  projects: string;
};

// ⌃⌥Space is avoided on purpose: macOS uses it to switch keyboard input sources.
export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  quick: 'Control+Alt+P',
  stopResume: 'Control+Alt+S',
  breakToggle: 'Control+Alt+B',
  projects: 'Control+Alt',
};

const SYMBOLS: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Space: 'Space', Plus: '+', Up: '↑', Down: '↓', Left: '←', Right: '→', Return: '↩', Tab: '⇥' };

/** "Control+Alt+P" → "⌃⌥P" */
export function prettyAccel(accel: string): string {
  if (!accel) return '';
  const parts = accel.split('+');
  const key = parts.pop()!;
  return parts.map((p) => SYMBOLS[p] ?? p).join('') + (SYMBOLS[key] && key.length > 1 && !['Up', 'Down', 'Left', 'Right', 'Plus'].includes(key) ? ` ${SYMBOLS[key]}` : SYMBOLS[key] ?? key);
}

/** The project shortcut for position i (0-based), e.g. "Control+Alt+1". */
export const projectAccel = (mod: string, i: number) => (mod && i < 9 ? `${mod}+${i + 1}` : '');

/** Punctuation Electron accepts as an accelerator key ("+" is written "Plus"). */
const ACCEL_PUNCT = new Set([')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '=', '<', ',', '_', '-', '>', '.', '?', '/', '~', '`', '{', ']', '[', '|', '\\', '}', '"', "'"]);

/** The character a physical key types on the current layout (e.g. KeyZ → "y" on German QWERTZ), if the browser knows it. */
export type LayoutMap = { get(code: string): string | undefined };

/**
 * Turn a keydown into an accelerator. Uses e.code, because ⌥ changes e.key on a Mac (⌥P gives "π"), and translates it
 * through the keyboard layout so German QWERTZ records Z as Z (not Y) and the key right of Ü as "+".
 * Returns null while only modifiers are held, 'needs-modifier' when no ⌃/⌥/⌘ is involved (a plain letter would block
 * typing everywhere), and 'unsupported' for keys macOS shortcuts can't use (ö, ä, ü, ß…).
 */
export function accelFromEvent(e: KeyboardEvent | React.KeyboardEvent, layout?: LayoutMap): string | null | 'needs-modifier' | 'unsupported' {
  const code = e.code;
  let key: string | null = null;
  const typed = layout?.get(code);
  if (/^F\d{1,2}$/.test(code)) key = code;
  else if (typed && typed.length === 1 && (/^[\p{L}\p{N}]$/u.test(typed) || ACCEL_PUNCT.has(typed) || typed === '+')) {
    if (/^[a-z0-9]$/i.test(typed)) key = typed.toUpperCase();
    else if (typed === '+') key = 'Plus';
    else if (ACCEL_PUNCT.has(typed)) key = typed;
    else key = 'unsupported';
  } else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else key = ({ Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Comma: ',', Period: '.', Minus: '-', Equal: '=', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`' } as Record<string, string>)[code] ?? null;
  if (!key) return null;
  if (key === 'unsupported') return 'unsupported';
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean) as string[];
  const isFn = /^F\d{1,2}$/.test(key);
  if (!isFn && !(e.ctrlKey || e.altKey || e.metaKey)) return 'needs-modifier';
  return [...mods, key].join('+');
}
