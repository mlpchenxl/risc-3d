/**
 * When to start a heavy viewer panel.
 *
 * The two panels in "Explore the scene" pull 22 MB between them, so they do not
 * start with the page. They start when the reader actually reaches them — which
 * is free for anyone who reads the abstract and leaves, and invisible to anyone
 * who scrolls down.
 *
 * The button stays as the fallback path: on a metered connection the reader
 * should be the one deciding to spend the megabytes.
 */

/** Would auto-starting a several-megabyte download be rude here? */
function metered() {
  const c = navigator.connection;
  return Boolean(c && c.saveData);
}

/**
 * Run `start` once, when `el` first comes near the viewport.
 *
 * @param {Element} el      the panel
 * @param {Function} start  idempotent; safe to call from the button too
 * @param {Element} button  fallback trigger, left in place when metered
 */
export function autoStart(el, start, button) {
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    start();
  };
  button?.addEventListener('click', once);

  if (metered() || !('IntersectionObserver' in window)) return;

  // A whole viewport of lead time: the download and the WASM compile want a
  // head start, so the panel is live by the time it is actually looked at.
  const io = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    once();
  }, {rootMargin: '100% 0px'});
  io.observe(el);
}
