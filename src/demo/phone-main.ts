// Entry of the phone view of the web demo: answer requests locally first, then start the real phone app and add the
// demo bar on top.
import './phone-setup';
import '../../server/web/main';
import { mountDemoBar } from './bar';
import './demo.css';

// Inside the phone frame on a computer, the frame page shows the bar; on a real phone, the app shows it itself.
if (window === window.top) mountDemoBar('phone');
