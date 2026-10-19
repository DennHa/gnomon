// The web demo plays on Wednesday of the current week at 14:35, with the clock ticking on from there, so the week is
// always well filled, a timer is running and the reports have something to show, whenever someone visits.
// Like the screenshot clock (electron/preload.cjs --fake-now). Must be imported before anything reads the time.
const KEY = 'gnomon-demo-clock';
const Real = Date;

/** Offset from the real clock to the demo's, kept for a few hours so a visit stays consistent across reloads. */
function offset(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { offset: number; at: number } | null;
    if (saved && Real.now() - saved.at < 6 * 3_600_000) return saved.offset;
  } catch {
    /* start a new demo day */
  }
  const now = new Real();
  const wednesday = new Real(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 2, 14, 35);
  const value = wednesday.getTime() - now.getTime();
  try {
    localStorage.setItem(KEY, JSON.stringify({ offset: value, at: Real.now() }));
    localStorage.removeItem('gnomon-demo-data'); // a new demo day starts with fresh data
  } catch {
    /* storage unavailable: this page view only */
  }
  return value;
}

const shift = offset();
function DemoDate(this: unknown, ...a: unknown[]) {
  if (!new.target) return new Real(Real.now() + shift).toString();
  return a.length ? new (Real as unknown as new (...x: unknown[]) => Date)(...a) : new Real(Real.now() + shift);
}
DemoDate.prototype = Real.prototype;
DemoDate.now = () => Real.now() + shift;
DemoDate.parse = Real.parse;
DemoDate.UTC = Real.UTC;
window.Date = DemoDate as unknown as DateConstructor;

export {};
