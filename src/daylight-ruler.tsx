// The Daylight ruler: hour marks along the top of the content. Drag along it (or swipe sideways on the trackpad over
// it) to scrub the light through the day; shortly after you let go, the time glides back to now.
import { useEffect, useRef } from 'react';
import { fmtTime, useNow } from './time';

const DAY = 24 * 60;
const BACK_AFTER_MS = 1500;
const GLIDE_MS = 1100;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const minuteOf = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function DaylightRuler({ preview, onPreview }: { preview: number | null; onPreview: (at: number | null) => void }) {
  const now = useNow(60_000);
  const bar = useRef<HTMLDivElement>(null);
  const latest = useRef(preview);
  latest.current = preview;
  const dragging = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef(0);

  const stopGlide = () => cancelAnimationFrame(frame.current);
  const glideBack = () => {
    const from = latest.current;
    if (from === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return onPreview(null);
    const start = performance.now();
    const step = (t: number) => {
      const k = clamp((t - start) / GLIDE_MS, 0, 1);
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      if (k >= 1) return onPreview(null);
      onPreview(from + (Date.now() - from) * ease);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  const backLater = () => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => !dragging.current && glideBack(), BACK_AFTER_MS);
  };
  const setMinute = (min: number) => {
    stopGlide();
    onPreview(startOfDay(Date.now()) + clamp(min, 0, DAY - 1) * 60_000);
    backLater();
  };
  const minuteAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * DAY;
  };
  useEffect(() => () => (clearTimeout(idle.current), stopGlide()), []);

  const nowMin = minuteOf(now);
  const shown = preview === null ? null : minuteOf(preview);
  return (
    <div
      className={`daylight-ruler ${preview !== null ? 'scrubbing' : ''}`}
      ref={bar}
      role="slider"
      aria-label="Daylight"
      aria-valuemin={0}
      aria-valuemax={DAY - 1}
      aria-valuenow={Math.round(shown ?? nowMin)}
      aria-valuetext={fmtTime(new Date(preview ?? now).toISOString())}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId); // keep scrubbing when the pointer leaves the ruler
        } catch {
          /* not a real pointer */
        }
        setMinute(minuteAt(e.clientX));
      }}
      onPointerMove={(e) => dragging.current && setMinute(minuteAt(e.clientX))}
      onPointerUp={() => {
        dragging.current = false;
        backLater();
      }}
      onWheel={(e) => {
        // Sideways swipes scrub; up and down still scroll the page.
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        setMinute((latest.current === null ? nowMin : minuteOf(latest.current)) + e.deltaX * 1.5);
      }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowLeft' ? -15 : e.key === 'ArrowRight' ? 15 : 0;
        if (d) setMinute((latest.current === null ? nowMin : minuteOf(latest.current)) + d);
      }}
    >
      {Array.from({ length: 25 }, (_, h) => (
        <i key={h} className={h % 6 === 0 ? 'major' : ''} style={{ left: `${(h / 24) * 100}%` }} />
      ))}
      <b className="now" style={{ left: `${(nowMin / DAY) * 100}%` }} />
      {shown !== null && (
        <span className="scrub" style={{ left: `${(shown / DAY) * 100}%` }}>
          <em>{fmtTime(new Date(preview!).toISOString())}</em>
        </span>
      )}
    </div>
  );
}
