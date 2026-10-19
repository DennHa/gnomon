// Where the web demo keeps its data: this browser's localStorage, shared by the Mac view (/example) and the phone view
// (/example/phone), so a timer started on one shows up on the other. Starts from fresh made-up data.
import { demoData } from './data';
import type { Data } from '../types';

const KEY = 'gnomon-demo-data';

export const demoLanguage = (): 'en' | 'de' => (navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en');

/** Whether this visit starts from fresh data (nothing saved yet). */
export const isFreshDemo = () => {
  try {
    return !localStorage.getItem(KEY);
  } catch {
    return true;
  }
};

export function readDemo(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Data;
  } catch {
    /* fall through to fresh data */
  }
  return demoData(new Date(), demoLanguage());
}

export function writeDemo(data: unknown): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // private window or full storage: the demo still works until the page is closed
  }
}

/** Throw away this browser's changes and start over with fresh demo data. */
export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('gnomon-demo-clock');
  } catch {
    /* storage unavailable: a reload starts fresh anyway */
  }
  location.reload();
}
