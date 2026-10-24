// The web app (/app on a Gnomon server): the Mac app's own interface in the browser, on the signed-in person's data
// on the server. The bridge (./bridge) stands in for Electron's; without a session, the sign-in page comes first.
import './bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from '../store';
import App from '../App';
import { loadSession } from './bridge';
import SignIn from './SignIn';
import '../styles.css';
import './web.css';

document.documentElement.classList.add('web-app');
const root = createRoot(document.getElementById('root')!);

function start() {
  root.render(
    <StrictMode>
      <StoreProvider>
        <App />
      </StoreProvider>
    </StrictMode>,
  );
}

loadSession().then(
  (session) => (session ? start() : root.render(<SignIn onSignedIn={start} />)),
  () => root.render(<SignIn onSignedIn={start} unreachable />),
);
