// Entry of the web demo's Mac view (/example): the Mac app's own interface with a browser bridge and made-up data.
// On a phone-sized screen it goes straight to the phone view.
import './bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from '../store';
import App from '../App';
import { mountDemoBar } from './bar';
import { isFreshDemo } from './storage';
import '../styles.css';
import './demo.css';

const fresh = isFreshDemo();
if (window.matchMedia('(max-width: 700px)').matches) location.replace('phone/');
else {
  document.documentElement.classList.add('web-demo');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <StoreProvider>
        <App />
      </StoreProvider>
    </StrictMode>,
  );
  mountDemoBar('mac');
  // The demo day is already under way, so the morning welcome wouldn't come up by itself: play it once as a preview.
  if (fresh) setTimeout(() => window.dispatchEvent(new Event('gnomon:morning-preview')), 700);
}
