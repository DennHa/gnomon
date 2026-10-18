// The morning welcome: the first time Gnomon is opened on a workday before clocking in, a short greeting and a line
// from a Greek philosopher, then the way to get going: the "Start day" button when you clock in and fill in later, the
// tracker itself (prefilled with today's first planned item) when you track live. Once a day; also the last page of
// the first-launch tour. Settings → Tracking switches it off.
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { startDay, startTimer, type TimerInput } from '../actions';
import { targetHoursOn } from '../schedule';
import { quoteFor } from '../quotes';
import { Burst } from '../motion';
import { Icon } from '../icons';
import { ProjectSelect } from '../components';
import { dayKey, useNow } from '../time';
import { t } from '../i18n';
import type { Data } from '../types';

/** Whether to greet now: tour done, not switched off, not yet today, not clocked in, and a workday (or the very first time). */
export function morningDue(d: Data, now = Date.now()): boolean {
  const s = d.settings;
  if (!s.tourDone || s.onboardingDone === false || s.morningWelcome === false) return false;
  const today = dayKey(now);
  if (s.welcomedDay === today) return false;
  if (d.workdays.some((w) => w.date === today)) return false;
  return !s.welcomedDay || targetHoursOn(d, today) > 0;
}

/** What the tracker starts prefilled with: today's first planned item, else what you worked on last. */
function firstUp(d: Data, today: string): TimerInput {
  const planned = d.plan.filter((p) => p.days.includes(today)).sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'))[0];
  if (planned) return { description: planned.name, projectId: planned.projectId, taskId: planned.floatId, taskName: planned.name || undefined };
  const last = [...d.entries].sort((a, b) => b.start.localeCompare(a.start))[0];
  if (last) return { description: last.description, projectId: last.projectId, activityId: last.activityId };
  return { description: '' };
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** `preview` (from Settings → Labs) plays it all without clocking in or starting anything, and doesn't count as today's. */
export default function Morning({ preview, onClose }: { preview?: boolean; onClose?: () => void } = {}) {
  const { data, update } = useStore();
  const now = useNow(60_000);
  const today = dayKey(now);
  const live = data.settings.workStyle === 'live';
  // Prefilled once; you can change it before starting, like the tracker on the Track page.
  const [input, setInput] = useState<TimerInput>(() => firstUp(data, today));
  const quote = useMemo(() => quoteFor(today), [today]);
  const card = useRef<HTMLDivElement>(null);
  const [cheer, setCheer] = useState(0);

  const hour = new Date(now).getHours();
  // The first word only: "Alex Müller" in the CSV, "Good morning, Alex!" here.
  const name = data.settings.userName?.trim().split(/\s+/)[0];
  const greeting = t(hour < 12 ? 'morning.morning' : hour < 18 ? 'morning.afternoon' : 'morning.evening');

  const done = () => (preview ? onClose?.() : update((d) => ({ ...d, settings: { ...d.settings, welcomedDay: today } })));

  // Off it goes: a little cheer on the button, then the card flies to where the day now lives (the "At work" status,
  // or the running timer) and the page underneath is already updated.
  const go = () => {
    if (!preview)
      update((d) => {
        const day = startDay(d);
        return live ? startTimer(day, input) : day;
      });
    setCheer(Date.now());
    if (reduceMotion()) return void setTimeout(done, 250);
    setTimeout(() => {
      const el = card.current;
      const target = (document.querySelector(live ? '.hero-clock' : '.att-status') ?? document.querySelector('.att-status'))?.getBoundingClientRect();
      if (!el || !target) return done();
      const box = el.getBoundingClientRect();
      const dx = target.left + target.width / 2 - (box.left + box.width / 2);
      const dy = target.top + target.height / 2 - (box.top + box.height / 2);
      el.parentElement?.classList.add('leaving');
      const anim = el.animate(
        [
          { transform: 'none', opacity: 1, borderRadius: '20px' },
          { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.2, borderRadius: '60px' },
        ],
        { duration: 520, easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)', fill: 'forwards' },
      );
      anim.onfinish = done;
    }, 700);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !cheer && done();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="modal-backdrop morning-backdrop">
      <div ref={card} className={`modal morning ${cheer ? 'cheering' : ''}`} role="dialog" aria-modal="true" aria-labelledby="morning-title">
        {/* A sunrise in one second: the sky warms from dawn violet to gold, the sun comes up with slowly turning rays,
            a few motes of light drift upwards. */}
        <div className="morning-sky" aria-hidden="true">
          <span className="morning-rays" />
          <span className="morning-sun" />
          {[12, 27, 41, 58, 69, 84].map((x, i) => (
            <i key={x} className="morning-mote" style={{ left: `${x}%`, animationDelay: `${0.6 + i * 0.7}s` } as React.CSSProperties} />
          ))}
        </div>
        <button className="icon-btn morning-close" onClick={done} aria-label={t('close')} title={t('close')} disabled={Boolean(cheer)}>
          <Icon name="close" size={20} />
        </button>
        <div className="morning-body">
          <h2 id="morning-title" key={cheer ? 'go' : 'hi'} className={cheer ? 'pop-in' : ''}>
            {cheer
              ? t('morning.letsGo')
              : // Word by word, like someone saying it.
                (name ? t('morning.helloName', { greeting, name }) : t('morning.hello', { greeting })).split(' ').map((w, i) => (
                  <span key={i} className="morning-word" style={{ '--i': i } as React.CSSProperties}>
                    {w}{' '}
                  </span>
                ))}
          </h2>
          <p className="morning-sub">{t('morning.haveAGreatOne')}</p>
          <blockquote className="morning-quote">
            <p>{quote.text}</p>
            <cite>{quote.by}</cite>
          </blockquote>
        </div>

        <div className="morning-actions">
          {live ? (
            // The tracker, as on the Track page: what, which project, start.
            <div className="hero morning-tracker">
              <div className="hero-bar">
                <div className="hero-field">
                  <input
                    className="hero-input"
                    autoFocus
                    placeholder={t('today.whatNow')}
                    value={input.description}
                    disabled={Boolean(cheer)}
                    onChange={(e) => setInput({ ...input, description: e.target.value, taskId: undefined, taskName: undefined })}
                    onKeyDown={(e) => e.key === 'Enter' && !cheer && go()}
                  />
                  <div className="hero-meta">
                    <ProjectSelect value={input.projectId} onChange={(projectId) => setInput({ ...input, projectId, taskId: undefined, taskName: undefined })} />
                  </div>
                </div>
                <button className="hero-btn start" onClick={go} disabled={Boolean(cheer)} title={t('morning.startTimer')} aria-label={t('morning.startTimer')}>
                  <Burst trigger={cheer} rays={14} style={{ left: '50%', top: '50%' }} />
                  <Burst trigger={cheer && cheer + 1} rays={22} style={{ left: '50%', top: '50%', animationDelay: '120ms' }} />
                  <Icon name="play_arrow" size={28} />
                </button>
              </div>
            </div>
          ) : (
            <button className="btn primary morning-go" onClick={go} disabled={Boolean(cheer)} autoFocus>
              <Burst trigger={cheer} rays={14} style={{ left: '50%', top: '50%' }} />
              <Burst trigger={cheer && cheer + 1} rays={22} style={{ left: '50%', top: '50%' }} />
              <Icon name="login" size={20} /> {t('morning.startDay')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
