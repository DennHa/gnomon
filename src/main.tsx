import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store';
import App from './App';
import Quick from './views/Quick';
import './styles.css';

// The same bundle serves the main window and the quick switcher (#quick-start / #quick-note).
const isQuick = window.location.hash.startsWith('#quick');
if (isQuick) document.documentElement.classList.add('quick-window');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isQuick ? (
      <Quick />
    ) : (
      <StoreProvider>
        <App />
      </StoreProvider>
    )}
  </StrictMode>,
);
