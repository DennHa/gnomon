// First-launch tour of the key features: clock in/out, tracking projects, catching up later, the overtime balance.
// Shown while settings.tourDone is unset; Settings → General → "Show the tour" reopens it. Connecting Float and
// Personio is a separate guide, opened from the last step or from Settings → Connections.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon, type IconName } from '../icons';
import { t, type MsgKey } from '../i18n';
import { prettyAccel } from '../shortcuts';
// Close-ups rendered from the demo screenshots (scripts/hero-shots.cjs), scaled down for the app.
import imgTimer from '../assets/tour/timer.jpg';
import imgStartDay from '../assets/tour/start-day.jpg';
import imgSwitcher from '../assets/tour/switcher.png';
import imgWeek from '../assets/tour/week.jpg';
import imgBalance from '../assets/tour/balance.jpg';

const STEPS: { icon: IconName; title: MsgKey; text: MsgKey; img: string }[] = [
  { icon: 'waving_hand', title: 'tour.welcomeTitle', text: 'tour.welcomeText', img: imgTimer },
  { icon: 'login', title: 'tour.dayTitle', text: 'tour.dayText', img: imgStartDay },
  { icon: 'timer', title: 'tour.trackTitle', text: 'tour.trackText', img: imgSwitcher },
  { icon: 'calendar_view_week', title: 'tour.laterTitle', text: 'tour.laterText', img: imgWeek },
  { icon: 'savings', title: 'tour.balanceTitle', text: 'tour.balanceText', img: imgBalance },
];

/** The step to open with, e.g. "#tour@3" for screenshots. */
const initialStep = () => {
  const m = /tour@(\d)/.exec(window.location.hash);
  return m ? Math.min(STEPS.length - 1, Math.max(0, Number(m[1]) - 1)) : 0;
};

export default function Tour() {
  const { data, update } = useStore();
  const [step, setStep] = useState(initialStep);
  const last = step === STEPS.length - 1;
  const finish = (openGuide = false) =>
    update((d) => ({ ...d, settings: { ...d.settings, tourDone: true, ...(openGuide && { onboardingDone: false }) } }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' && !last) setStep(step + 1);
      if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const s = STEPS[step];
  return (
    <div className="modal-backdrop">
      <div className="modal onb tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div className="onb-top">
          <span className="muted small">{t('onb.step', { n: step + 1, total: STEPS.length })}</span>
          <button className="icon-btn" title={t('close')} onClick={() => finish()}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="onb-head">
          <span className="onb-icon">
            <Icon name={s.icon} size={28} />
          </span>
          <h2 id="tour-title">{t(s.title)}</h2>
        </div>

        <img className="tour-img" src={s.img} alt="" />

        <div className="onb-body">
          <p>{t(s.text, { key: prettyAccel(data.settings.shortcuts.quick) || '⌃⌥P' })}</p>
          {last && (
            <div className="tour-connect">
              <span className="muted small">{t('tour.connectHint')}</span>
              <button className="btn" onClick={() => finish(true)}>
                <Icon name="link" size={18} /> {t('onb.open')}
              </button>
            </div>
          )}
        </div>

        <div className="onb-foot">
          <span className="onb-dots" aria-hidden="true">
            {STEPS.map((x, i) => (
              <button key={x.title} className={`onb-dot ${i === step ? 'active' : ''} ${i < step ? 'past' : ''}`} onClick={() => setStep(i)} tabIndex={-1} />
            ))}
          </span>
          <span className="spacer" />
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              <Icon name="arrow_back" size={18} /> {t('onb.back')}
            </button>
          )}
          <button className="btn primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? t('tour.start') : t('onb.next')} {!last && <Icon name="arrow_forward" size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
