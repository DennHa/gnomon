// First-launch guide (desktop only): Float, Personio and Weblog, one step each, every step skippable.
// Opened on request: from the tour's last step or Settings → "Set up integrations" (both set onboardingDone to false).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon, type IconName } from '../icons';
import { t, type MsgKey } from '../i18n';
import { FloatConnect, PersonioConnect, WeblogInfo } from './integrations';

const STEPS: { title: MsgKey; icon: IconName }[] = [
  { title: 'onb.floatTitle', icon: 'event_note' },
  { title: 'onb.personioTitle', icon: 'beach_access' },
  { title: 'onb.weblogTitle', icon: 'send' },
];

/** The step to open with, e.g. "#onboarding@2" for screenshots. */
const initialStep = () => {
  const m = /onboarding@(\d)/.exec(window.location.hash);
  return m ? Math.min(STEPS.length - 1, Math.max(0, Number(m[1]) - 1)) : 0;
};

export default function Onboarding() {
  const { data, update } = useStore();
  const s = data.settings;
  const [step, setStep] = useState(initialStep);
  const finish = () => update((d) => ({ ...d, settings: { ...d.settings, onboardingDone: true } }));
  const last = step === STEPS.length - 1;
  const next = () => (last ? finish() : setStep(step + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const connected = step === 0 ? Boolean(s.floatPersonId) : step === 1 ? Boolean(s.personioPersonId) : false;

  return (
    <div className="modal-backdrop">
      <div className="modal onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">
        <div className="onb-top">
          <span className="muted small">{t('onb.step', { n: step + 1, total: STEPS.length })}</span>
          <button className="icon-btn" title={t('close')} onClick={finish}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="onb-head">
          <span className="onb-icon">
            <Icon name={STEPS[step].icon} size={28} />
          </span>
          <h2 id="onb-title">{t(STEPS[step].title)}</h2>
        </div>

        <div className="onb-body">
          {step === 0 && (
            <>
              <p>{t('onb.floatWhat')}</p>
              {!connected && <p className="muted small">{t('onb.floatToken')}</p>}
              {connected && <p className="onb-ok"><Icon name="check_circle" size={18} /> {t('onb.floatConnected')}</p>}
              <FloatConnect showIntro={false} />
            </>
          )}
          {step === 1 && (
            <>
              <p>{t('personio.intro')}</p>
              {connected && <p className="onb-ok"><Icon name="check_circle" size={18} /> {t('onb.personioConnected')}</p>}
              <PersonioConnect showIntro={false} />
            </>
          )}
          {step === 2 && (
            <>
              <p>{t('onb.weblogWhat')}</p>
              <WeblogInfo />
            </>
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
          {/* Every step can be skipped: until it's connected, the main button says so. */}
          <button className="btn primary" onClick={next}>
            {last ? t('onb.done') : connected ? t('onb.next') : t('onb.skip')} {!last && <Icon name="arrow_forward" size={18} />}
          </button>
        </div>
        {last && <p className="muted small onb-later">{t('onb.later')}</p>}
      </div>
    </div>
  );
}
