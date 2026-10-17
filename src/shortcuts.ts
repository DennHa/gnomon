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

const SYMBOLS: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Space: 'Space', Up: '↑', Down: '↓', Left: '←', Right: '→', Return: '↩', Tab: '⇥' };

/** "Control+Alt+P" → "⌃⌥P" */
export function prettyAccel(accel: string): string {
  if (!accel) return '';
  const parts = accel.split('+');
  const key = parts.pop()!;
  return parts.map((p) => SYMBOLS[p] ?? p).join('') + (SYMBOLS[key] && key.length > 1 && !['Up', 'Down', 'Left', 'Right'].includes(key) ? ` ${SYMBOLS[key]}` : SYMBOLS[key] ?? key);
}

/** The project shortcut for position i (0-based), e.g. "Control+Alt+1". */
export const projectAccel = (mod: string, i: number) => (mod && i < 9 ? `${mod}+${i + 1}` : '');

/**
 * Turn a keydown into an accelerator. Uses e.code, because ⌥ changes e.key on a Mac (⌥P gives "π").
 * Returns null while only modifiers are held, or when no ⌃/⌥/⌘ is involved (a plain letter would block typing everywhere).
 */
export function accelFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null | 'needs-modifier' {
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else key = ({ Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Comma: ',', Period: '.', Minus: '-', Equal: '=', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`' } as Record<string, string>)[code] ?? null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean) as string[];
  const isFn = /^F\d{1,2}$/.test(key);
  if (!isFn && !(e.ctrlKey || e.altKey || e.metaKey)) return 'needs-modifier';
  return [...mods, key].join('+');
}
