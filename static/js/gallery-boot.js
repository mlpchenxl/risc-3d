/**
 * Start the asset gallery when the reader reaches it.
 *
 * Same policy as the capture panel: the first tab pulls a 1-2 MB glTF and the
 * articulated tab pulls the 9.7 MB MuJoCo engine, so none of it belongs in the
 * initial page load, and none of it should need a click either.
 */
import {autoStart} from './viewer-gate.js';

document.addEventListener('DOMContentLoaded', () => {
  const host = document.querySelector('.gal');
  if (!host) return;

  const stub = document.createElement('button');
  stub.className = 'risc-viewer-cta gal-start';
  stub.textContent = 'Load the assets';
  host.querySelector('[data-stage]').appendChild(stub);

  autoStart(host, async () => {
    stub.disabled = true;
    stub.textContent = 'Loading…';
    try {
      const {mountGallery} = await import('./gallery.js?v=9');
      stub.remove();
      await mountGallery(host);
    } catch (err) {
      stub.disabled = false;
      stub.textContent = 'Retry';
      console.error('[gallery]', err);
    }
  }, stub);
});
