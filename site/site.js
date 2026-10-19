// Gnomon's site: things rise in as they come into view, the nav gets a line once you scroll, and the clock in the hero
// ticks like your work time in the app's sidebar. No tracking, no cookies, no third-party anything.
document.documentElement.classList.add('js');

const reveal = new IntersectionObserver(
  (items) => {
    for (const item of items) {
      if (!item.isIntersecting) continue;
      item.target.classList.add('in');
      reveal.unobserve(item.target);
    }
  },
  { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
);
document.querySelectorAll('.reveal:not(.hero .reveal)').forEach((el) => reveal.observe(el));

const nav = document.querySelector('.nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// The hero's work time: 5:30:02 like the screenshot's day, and it keeps going.
const clock = document.getElementById('clock');
const started = Date.now() - (5 * 3600 + 30 * 60 + 2) * 1000;
const pad = (n) => String(n).padStart(2, '0');
setInterval(() => {
  const s = Math.floor((Date.now() - started) / 1000);
  clock.textContent = `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}, 1000);
