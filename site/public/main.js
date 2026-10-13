// Lowtide landing page. Loaded in <head> (not deferred) so <html class="js"> is set before the first paint;
// sections only start hidden when this script runs, so the page never depends on it.
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  // The header gets its glass once the page scrolls.
  const nav = document.querySelector('[data-nav]');
  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Sections fade in as they arrive.
  const reveals = document.querySelectorAll('.reveal');
  // A page opened in the background (prerender, link previews) shows everything at once.
  if (document.visibilityState === 'hidden') {
    reveals.forEach((el) => el.classList.add('shown'));
    return;
  }
  if ('IntersectionObserver' in window && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('shown');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    reveals.forEach((el) => observer.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('shown'));
  }
});
