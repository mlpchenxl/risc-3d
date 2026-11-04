/**
 * Start all three asset gallery columns simultaneously when #assets enters view.
 */
import {autoStart} from './viewer-gate.js';

document.addEventListener('DOMContentLoaded', () => {
  const host = document.querySelector('#assets .gal') || document.querySelector('.gal');
  if (!host) return;

  const stages = [...host.querySelectorAll('[data-stage]')];
  const stubs = stages.map(stage => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'risc-viewer-cta gal-start';
    btn.textContent = 'Load assets';
    stage.appendChild(btn);
    return btn;
  });

  const primaryStub = stubs[0];
  if (!primaryStub) return;

  const triggerAll = async () => {
    stubs.forEach(s => {
      s.disabled = true;
      s.textContent = 'Loading…';
    });
    try {
      const {mountGallery} = await import('./gallery.js?v=10');
      stubs.forEach(s => s.remove());
      await mountGallery(host);
    } catch (err) {
      stubs.forEach(s => {
        s.disabled = false;
        s.textContent = 'Retry';
      });
      console.error('[gallery]', err);
    }
  };

  stubs.slice(1).forEach(s => s.addEventListener('click', () => primaryStub.click()));
  autoStart(host, triggerAll, primaryStub);
});
