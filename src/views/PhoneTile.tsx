// "Connect your phone": a small tile in the sidebar while this Mac is connected to a Gnomon server and no phone is yet.
// A click shows a QR code; scanning it signs the phone into the same account, and the tile says so and goes away.
// The × closes it for good (Settings → Connections can still connect a phone).
import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { useStore } from '../store';
import { Icon } from '../icons';
import { Burst } from '../motion';
import { locale, t } from '../i18n';

type Mine = { id: string; name: string; client: string | null; current: boolean };
const isPhone = (d: Mine) => !d.current && (d.client === 'phone' || /iphone|ipad|android|phone|handy/i.test(d.name));

/** Whether to offer it: connected to a server, and none of this account's other devices is a phone. */
async function phoneMissing(): Promise<boolean> {
  const st = await window.api.serverStatus();
  if (!st.connected) return false;
  const r = await window.api.serverMyDevices();
  return r.ok && !r.devices.some(isPhone);
}

function PairDialog({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [invite, setInvite] = useState<{ code: string; expiresAt: string; svg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  useEffect(() => {
    window.api.serverPairCode('').then((r) => {
      if (!r.ok) return setError(r.error);
      const qr = qrcode(0, 'M');
      qr.addData(r.link);
      qr.make();
      setInvite({ code: r.code, expiresAt: r.expiresAt, svg: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) });
    });
  }, []);
  // While the code is shown, look every few seconds whether the phone has arrived.
  useEffect(() => {
    if (!invite || done) return;
    const id = setInterval(async () => {
      if (!(await phoneMissing())) {
        setDone(Date.now());
        setTimeout(onConnected, 1800);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [invite, done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal phone-pair" role="dialog" aria-labelledby="phone-pair-title">
        <header className="modal-head">
          <span className="modal-title" id="phone-pair-title">
            <strong>{t('phone.title')}</strong>
          </span>
          <button className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <Icon name="close" size={20} />
          </button>
        </header>
        {done ? (
          <div className="phone-done pop-in">
            <Burst trigger={done} rays={14} style={{ left: '50%', top: 34 }} />
            <Icon name="check_circle" size={44} />
            <strong>{t('phone.connected')}</strong>
          </div>
        ) : (
          <>
            <p className="muted">{t('phone.intro')}</p>
            {error && <p className="error small">{error}</p>}
            {invite && (
              <div className="server-invite">
                <div className="qr" dangerouslySetInnerHTML={{ __html: invite.svg }} />
                <div>
                  <ol className="phone-steps">
                    <li>{t('phone.step1')}</li>
                    <li>{t('phone.step2')}</li>
                    <li>{t('phone.step3')}</li>
                  </ol>
                  <p className="invite-code">{invite.code}</p>
                  <p className="muted small">{t('srv.scan', { time: new Date(invite.expiresAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function PhoneTile() {
  const { data, update } = useStore();
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const dismissed = data.settings.phoneTileDismissed;
  useEffect(() => {
    if (dismissed) return;
    const check = () => void phoneMissing().then(setShow, () => setShow(false));
    check();
    const id = setInterval(check, 10 * 60_000);
    return () => clearInterval(id);
  }, [dismissed]);
  if (dismissed || !show) return null;
  const dismiss = () => update((d) => ({ ...d, settings: { ...d.settings, phoneTileDismissed: true } }));
  return (
    <>
      <div className="phone-tile">
        <button className="phone-tile-main" onClick={() => setOpen(true)}>
          <Icon name="mobile" size={22} />
          <span>
            <strong>{t('phone.tile')}</strong>
            <span className="muted small">{t('phone.tileText')}</span>
          </span>
        </button>
        <button className="icon-btn phone-tile-close" onClick={dismiss} aria-label={t('phone.dismiss')} title={t('phone.dismiss')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {open && <PairDialog onClose={() => setOpen(false)} onConnected={() => (setOpen(false), setShow(false))} />}
    </>
  );
}
