// The phone view's page on a computer: the phone app in a phone-shaped frame, with the demo bar below it.
// On a phone-sized screen it goes straight to the app.
import { mountDemoBar } from './bar';
import './frame.css';
import './demo.css';

if (window.matchMedia('(max-width: 700px)').matches) location.replace('app.html');
else mountDemoBar('phone');
