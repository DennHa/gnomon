// Small moments: the numbers behind the leave summary and the celebrations, and the "sun ray" burst. All motion lives
// in styles.css and is switched off by macOS "Reduce motion" (prefers-reduced-motion), which leaves only the text.
import { useEffect, useState } from 'react';
import type { Data } from './types';
import { targetFor } from './balance';
import { targetHoursOn } from './schedule';
import { addDays, dayKey, hoursToMs, startOfWeek, workdayMs } from './time';

/** Worked time on a day against its scheduled target. */
export function daySummary(d: Data, date: string, now = Date.now()) {
  const w = d.workdays.find((x) => x.date === date);
  const worked = w && !w.off ? workdayMs(w, now) : 0;
  const target = w ? targetFor(d, w) : hoursToMs(targetHoursOn(d, date));
  return { worked, target, diff: worked - target };
}

/**
 * The week so far (Monday up to `date`): worked time against the targets of the recorded days, and whether `date` is
 * the last scheduled workday of that week, so leaving is the start of the weekend.
 */
export function weekSummary(d: Data, date: string, now = Date.now()) {
  const monday = dayKey(startOfWeek(new Date(`${date}T12:00`)));
  const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(new Date(`${monday}T12:00`), i)));
  let worked = 0;
  let target = 0;
  for (const day of days.filter((x) => x <= date)) {
    const w = d.workdays.find((x) => x.date === day);
    if (!w) continue;
    worked += w.off ? 0 : workdayMs(w, now);
    target += targetFor(d, w);
  }
  const lastWorkday = !days.some((day) => day > date && targetHoursOn(d, day) > 0);
  return { worked, target, diff: worked - target, lastWorkday };
}

/** Sun rays bursting out of a point, once per change of `trigger` (0 = never). Place it in a positioned parent. */
export function Burst({ trigger, rays = 10, style }: { trigger: number; rays?: number; style?: React.CSSProperties }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    setShown(trigger);
    const t = setTimeout(() => setShown(0), 900);
    return () => clearTimeout(t);
  }, [trigger]);
  if (!shown) return null;
  return (
    <span className="burst" key={shown} style={style} aria-hidden="true">
      {Array.from({ length: rays }, (_, i) => (
        <i key={i} style={{ '--a': `${(i * 360) / rays}deg`, animationDelay: `${i % 2 ? 40 : 0}ms` } as React.CSSProperties} />
      ))}
    </span>
  );
}
