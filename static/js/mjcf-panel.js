/**
 * The click-to-load gate and asset picker around the live MJCF panel.
 *
 * The engine is a 9.7 MB WebAssembly binary. Nobody who came to read the
 * abstract should pay for it, so the panel stays a poster until asked; after
 * that the engine is kept and only the model is swapped.
 */
import {autoStart} from './viewer-gate.js';

const PANEL = 'mujoco-viewer';

/**
 * Every articulated asset the pipeline emitted for this room.
 *
 * The notes say how far each one actually travels when its actuators are driven
 * to their limits — measured in MuJoCo, not guessed. Several assets have a
 * joint that never leaves zero because the parts collide; raising the actuator
 * gain does not help, so the honest thing is to say which ones move.
 */
const ASSETS = [
  {id: 'sink_1', label: 'Sink', note: '2 joints, both travel their full range'},
  {id: 'microwave_1', label: 'Microwave', note: 'door opens to 100°'},
  {id: 'electric_food_steamer_1', label: 'Food steamer', note: 'lid lifts 15 cm; its hinge is blocked'},
  {id: 'desk_lamp', label: 'Desk lamp', note: 'arm swings 90°; the base joint is blocked'},
  {id: 'humidifier_1', label: 'Humidifier', note: 'tank lifts 6 cm; its hinge is blocked'},
  {id: 'rice_cooker', label: 'Rice cooker', note: 'lid hinge is blocked by contact'},
  {id: 'air_fryer_1', label: 'Air fryer', note: 'drawer is blocked by contact'},
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

document.addEventListener('DOMContentLoaded', () => {
  const host = document.getElementById(PANEL);
  if (!host) return;
  const stub = host.querySelector('.risc-viewer-stub');
  const btn = host.querySelector('[data-mjcf-load]');
  const picker = document.getElementById('mjcf-picker');
  if (!btn) return;

  let view = null;
  let current = null;
  let mjcf = null;
  let busy = false;
  let playing = true;

  const bar = el('div', 'risc-viewer-bar');
  const play = el('button', 'risc-viewer-btn', 'Pause');
  const reset = el('button', 'risc-viewer-btn', 'Reset');
  const stats = el('span', 'risc-viewer-stats');
  bar.append(play, reset, stats);

  play.addEventListener('click', () => {
    playing = !playing;
    view?.setPlaying(playing);
    play.textContent = playing ? 'Pause' : 'Play';
  });
  reset.addEventListener('click', () => view?.reset());

  const chips = () => picker ? [...picker.querySelectorAll('button')] : [];

  async function show(asset) {
    if (busy || asset.id === current) return;
    busy = true;
    chips().forEach(b => {
      b.classList.toggle('is-active', b.dataset.asset === asset.id);
      b.disabled = true;
    });
    stats.textContent = `loading ${asset.label.toLowerCase()}…`;

    try {
      // Tear down the scene and the model, never the engine.
      view?.dispose();
      view = null;
      view = await mjcf.mount(host, {base: `assets/mjcf/${asset.id}`});
      current = asset.id;
      playing = true;
      play.textContent = 'Pause';
      const {bodies, joints, actuators} = view.stats;
      stats.textContent =
        `${bodies} bodies · ${joints} joints · ${actuators} actuators · MuJoCo 3.11 WASM`;
    } catch (err) {
      stats.textContent = `failed: ${err.message || err}`;
      console.error('[mjcf]', err);
    } finally {
      chips().forEach(b => { b.disabled = false; });
      busy = false;
    }
  }

  autoStart(host, async () => {
    btn.disabled = true;
    btn.textContent = 'Loading engine…';
    try {
      mjcf = await import('./mjcf-viewer.js');
      await mjcf.loadEngine();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Retry';
      const msg = host.querySelector('[data-mjcf-error]');
      if (msg) msg.textContent = String(err.message || err);
      console.error('[mjcf]', err);
      return;
    }

    stub?.remove();
    host.appendChild(bar);

    if (picker) {
      for (const a of ASSETS) {
        const b = el('button', 'mjcf-chip', a.label);
        b.dataset.asset = a.id;
        b.title = a.note;
        b.addEventListener('click', () => show(a));
        picker.appendChild(b);
      }
      picker.hidden = false;
    }
    await show(ASSETS[0]);
  }, btn);
});
