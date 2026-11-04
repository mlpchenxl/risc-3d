/**
 * Three-column side-by-side asset gallery:
 *   Column 1 (rigid):       RigidViewer (glTF + convex decomposition hulls toggle)
 *   Column 2 (articulated): MjcfViewer (live MuJoCo physics + Play/Pause + joint sliders)
 *   Column 3 (builtin):     Turntable MP4 clips with controls
 *
 * All three columns initialize simultaneously when #assets enters the viewport,
 * and each column independently manages its own item index, prev/next arrows,
 * and title & metadata chips.
 */

/** Articulated assets, with how far each one's joints actually travel. */
const ARTICULATED = [
  {id: 'sink_1', label: 'Sink', note: 'both joints travel their full range', thumb: '2 DOF'},
  {id: 'microwave_1', label: 'Microwave', note: 'door opens to 100°', poster: 'static/images/posters/manip_microwave.jpg', thumb: 'Hinge'},
  {id: 'electric_food_steamer_1', label: 'Food steamer', note: 'lid lifts 15 cm; its hinge is blocked', poster: 'static/images/posters/manip_steamer.jpg', thumb: 'Slide+Hinge'},
  {id: 'desk_lamp', label: 'Desk lamp', note: 'arm swings 90°; the base joint is blocked', thumb: 'Revolute'},
  {id: 'humidifier_1', label: 'Humidifier', note: 'tank lifts 6 cm; its hinge is blocked', poster: 'static/images/posters/manip_humidifier.jpg', thumb: 'Prismatic'},
  {id: 'rice_cooker', label: 'Rice cooker', note: 'lid hinge is blocked by contact', thumb: 'Hinge'},
  {id: 'air_fryer_1', label: 'Air fryer', note: 'drawer is blocked by contact', poster: 'static/images/posters/manip_airfly.jpg', thumb: 'Drawer'},
];

const BUILTIN = [
  {id: 'builtin_cabinet', label: 'TV wall cabinet', note: '6 leaves, 3 motion groups', thumb: '6 leaves'},
  {id: 'builtin_wardrobe', label: 'Wardrobe', note: 'full-height doors', thumb: 'Full-height'},
  {id: 'builtin_room_d', label: 'Wall cabinets', note: '14 hinged doors, dual runs', thumb: '14 doors'},
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderFacts(container, bits) {
  if (!container) return;
  container.textContent = '';
  for (const b of bits) {
    container.appendChild(el('span', 'gal-fact', b));
  }
}

async function mountRigidColumn(col, list) {
  if (!col || !list?.length) return;
  const stage = col.querySelector('[data-stage]');
  const prev = col.querySelector('[data-prev]');
  const next = col.querySelector('[data-next]');
  const title = col.querySelector('[data-title]');
  const meta = col.querySelector('[data-meta]');
  const modes = col.querySelector('[data-modes]');

  let idx = 0;
  let view = null;
  let busy = false;
  let rigidMode = 'visual';

  if (modes) {
    modes.textContent = '';
    for (const [modeKey, modeLabel] of [['visual', 'Appearance'], ['hulls', 'Collision hulls']]) {
      const b = el('button', 'gal-mode', modeLabel);
      b.type = 'button';
      b.dataset.mode = modeKey;
      if (modeKey === rigidMode) b.classList.add('is-active');
      b.addEventListener('click', () => {
        rigidMode = modeKey;
        [...modes.children].forEach(x => x.classList.toggle('is-active', x.dataset.mode === modeKey));
        view?.setMode?.(modeKey);
      });
      modes.appendChild(b);
    }
  }

  async function show(i) {
    if (busy) return;
    busy = true;
    idx = (i + list.length) % list.length;
    const item = list[idx];

    stage.classList.add('is-busy');
    view?.dispose?.();
    view = null;
    stage.querySelectorAll('canvas, video').forEach(n => n.remove());

    title.textContent = item.label;
    const bits = [];
    if (item.mass_kg != null) bits.push(`${item.mass_kg} kg`);
    if (item.hulls != null) bits.push(`${item.hulls} ${item.hulls === 1 ? 'hull' : 'hulls'}`);
    if (item.friction != null) bits.push(`μ ${item.friction}`);
    if (item.tris) bits.push(`${(item.tris / 1000).toFixed(0)}k tris`);
    renderFacts(meta, bits);

    try {
      const {mount} = await import('./rigid-viewer.js?v=3');
      view = await mount(stage, {base: `assets/rigid/${item.id}`});
      view.setMode(rigidMode);
    } catch (err) {
      title.textContent = `${item.label} — failed to load`;
      console.error('[gallery:rigid]', err);
    } finally {
      stage.classList.remove('is-busy');
      busy = false;
    }
  }

  prev?.addEventListener('click', () => show(idx - 1));
  next?.addEventListener('click', () => show(idx + 1));
  col.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });

  await show(0);
}

async function mountArticulatedColumn(col, list) {
  if (!col || !list?.length) return;
  const stage = col.querySelector('[data-stage]');
  const prev = col.querySelector('[data-prev]');
  const next = col.querySelector('[data-next]');
  const title = col.querySelector('[data-title]');
  const meta = col.querySelector('[data-meta]');
  const controlsBar = col.querySelector('[data-artic-controls]');

  let idx = 0;
  let view = null;
  let busy = false;
  let sliderInputs = [];
  let playBtn = null;

  function buildArticOverlay(mountedView) {
    if (!controlsBar) return;
    controlsBar.textContent = '';
    sliderInputs = [];

    playBtn = el('button', 'gal-mode is-active gal-play-btn', 'Pause');
    playBtn.type = 'button';
    playBtn.addEventListener('click', () => {
      if (!view) return;
      const nextState = !view.isPlaying?.();
      view.setPlaying(nextState);
      playBtn.textContent = nextState ? 'Pause' : 'Play';
      playBtn.classList.toggle('is-active', nextState);
    });
    controlsBar.appendChild(playBtn);

    const acts = mountedView?.actuators || [];
    if (acts.length > 0) {
      const slidersWrap = el('div', 'gal-sliders');
      acts.forEach((act, k) => {
        const row = el('label', 'gal-slider-item');
        const tag = el('span', 'gal-slider-label', acts.length > 1 ? `J${k + 1}` : 'Joint');
        const input = el('input', 'gal-slider-input');
        input.type = 'range';
        input.min = String(act.min);
        input.max = String(act.max);
        input.step = String(Math.max((act.max - act.min) / 120, 0.001));
        input.value = String(mountedView.getCtrl?.(act.index) ?? act.min);
        input.addEventListener('input', () => {
          mountedView.setCtrl?.(act.index, parseFloat(input.value));
          if (playBtn) {
            playBtn.textContent = 'Play';
            playBtn.classList.remove('is-active');
          }
        });
        row.append(tag, input);
        slidersWrap.appendChild(row);
        sliderInputs.push({input, index: act.index});
      });
      controlsBar.appendChild(slidersWrap);
    }
  }

  async function show(i) {
    if (busy) return;
    busy = true;
    idx = (i + list.length) % list.length;
    const item = list[idx];

    stage.classList.add('is-busy');
    view?.dispose?.();
    view = null;
    stage.querySelectorAll('canvas, video').forEach(n => n.remove());

    title.textContent = item.label;
    renderFacts(meta, item.note ? [item.note] : []);

    try {
      const {mount} = await import('./mjcf-viewer.js?v=2');
      view = await mount(stage, {
        base: `assets/mjcf/${item.id}`,
        onUpdate(ctrl, _range, isPlaying) {
          if (isPlaying && sliderInputs.length) {
            for (const {input, index} of sliderInputs) {
              input.value = String(ctrl[index]);
            }
          }
        },
      });
      buildArticOverlay(view);
      const bits = [];
      if (view.stats?.bodies != null) bits.push(`${view.stats.bodies} bodies`);
      if (view.stats?.joints != null) {
        bits.push(`${view.stats.joints} ${view.stats.joints === 1 ? 'joint' : 'joints'}`);
      }
      if (item.note) bits.push(item.note);
      renderFacts(meta, bits);
    } catch (err) {
      title.textContent = `${item.label} — failed to load`;
      console.error('[gallery:articulated]', err);
    } finally {
      stage.classList.remove('is-busy');
      busy = false;
    }
  }

  prev?.addEventListener('click', () => show(idx - 1));
  next?.addEventListener('click', () => show(idx + 1));
  col.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });

  await show(0);
}

async function mountBuiltinColumn(col, list) {
  if (!col || !list?.length) return;
  const stage = col.querySelector('[data-stage]');
  const prev = col.querySelector('[data-prev]');
  const next = col.querySelector('[data-next]');
  const title = col.querySelector('[data-title]');
  const meta = col.querySelector('[data-meta]');

  let idx = 0;
  let view = null;

  function show(i) {
    idx = (i + list.length) % list.length;
    const item = list[idx];

    view?.dispose?.();
    view = null;
    stage.querySelectorAll('canvas, video').forEach(n => n.remove());

    title.textContent = item.label;
    renderFacts(meta, item.note ? [item.note] : []);

    const v = el('video', 'gallery-video gal-video');
    v.src = `static/videos/turntable/${item.id}.mp4`;
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.controls = true;
    v.disablePictureInPicture = true;
    v.disableRemotePlayback = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('controlslist', 'nodownload noplaybackrate');
    v.setAttribute('disablepictureinpicture', '');
    v.setAttribute('disableremoteplayback', '');
    v.setAttribute('oncontextmenu', 'return false;');
    v.oncontextmenu = () => false;
    stage.appendChild(v);
    v.play?.().catch(() => {});
    view = {dispose: () => v.remove()};
  }

  prev?.addEventListener('click', () => show(idx - 1));
  next?.addEventListener('click', () => show(idx + 1));
  col.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });

  show(0);
}

export async function mountGallery(host) {
  const rigidCol = host.querySelector('[data-col="rigid"]');
  const articCol = host.querySelector('[data-col="articulated"]');
  const builtinCol = host.querySelector('[data-col="builtin"]');

  const rigidPromise = fetch('assets/rigid/index.json?v=5')
    .then(r => r.json())
    .then(rigidItems => mountRigidColumn(rigidCol, rigidItems));

  await Promise.all([
    rigidPromise,
    mountArticulatedColumn(articCol, ARTICULATED),
    mountBuiltinColumn(builtinCol, BUILTIN),
  ]);
}
