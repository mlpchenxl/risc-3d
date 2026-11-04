/**
 * The asset gallery: one object at a time, arrows to move along the row.
 *
 * Three classes, three ways of showing them, because the pipeline produces three
 * genuinely different things:
 *
 *   rigid       glTF + its convex decomposition, toggled. There are no joints to
 *               simulate, so the interesting pair is shape against collision.
 *   articulated the emitted MJCF, stepping live in MuJoCo. These have joints,
 *               and a joint you can watch move is worth more than a render of one.
 *   built-in    a turntable clip. The built-in branch reconstructs facade leaves
 *               and leaves the carcass to the background asset, so one of these
 *               on its own is a set of loose boards until it is back in its room.
 */
const TABS = [
  {id: 'rigid', label: 'Rigid', kind: 'rigid',
   blurb: 'Reconstructed shape, and the convex decomposition that lets it be simulated.'},
  {id: 'articulated', label: 'Articulated', kind: 'mjcf',
   blurb: 'The emitted MJCF, stepping live in MuJoCo. Drag to orbit.'},
  {id: 'builtin', label: 'Built-in', kind: 'video',
   blurb: 'Cabinet runs, whose leaves are reconstructed from a rectified elevation.'},
];

/** Articulated assets, with how far each one's joints actually travel. */
const ARTICULATED = [
  {id: 'sink_1', label: 'Sink', note: 'both joints travel their full range'},
  {id: 'microwave_1', label: 'Microwave', note: 'door opens to 100°'},
  {id: 'electric_food_steamer_1', label: 'Food steamer', note: 'lid lifts 15 cm; its hinge is blocked'},
  {id: 'desk_lamp', label: 'Desk lamp', note: 'arm swings 90°; the base joint is blocked'},
  {id: 'humidifier_1', label: 'Humidifier', note: 'tank lifts 6 cm; its hinge is blocked'},
  {id: 'rice_cooker', label: 'Rice cooker', note: 'lid hinge is blocked by contact'},
  {id: 'air_fryer_1', label: 'Air fryer', note: 'drawer is blocked by contact'},
];

const BUILTIN = [
  {id: 'builtin_cabinet', label: 'TV wall cabinet', note: '6 leaves, 3 motion groups'},
  {id: 'builtin_wardrobe', label: 'Wardrobe', note: 'full-height doors'},
  {id: 'builtin_room_d', label: 'Wall cabinets', note: '14 hinged doors, dual runs'},
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export async function mountGallery(host) {
  const stage = host.querySelector('[data-stage]');
  const tabBar = host.querySelector('[data-tabs]');
  const prev = host.querySelector('[data-prev]');
  const next = host.querySelector('[data-next]');
  const title = host.querySelector('[data-title]');
  const facts = host.querySelector('[data-facts]');
  const dots = host.querySelector('[data-dots]');
  const modes = host.querySelector('[data-modes]');

  const rigid = await fetch('assets/rigid/index.json?v=5').then(r => r.json());
  const items = {rigid, articulated: ARTICULATED, builtin: BUILTIN};

  let tab = TABS[0];
  let index = 0;
  let view = null;          // whatever the current tab mounted
  let busy = false;
  let rigidMode = 'visual';

  const teardown = () => {
    view?.dispose?.();
    view = null;
    stage.querySelectorAll('canvas, video').forEach(n => n.remove());
  };

  function setFacts(item) {
    facts.textContent = '';
    const bits = [];
    if (item.mass_kg != null) bits.push(`${item.mass_kg} kg`);
    if (item.hulls != null) bits.push(`${item.hulls} ${item.hulls === 1 ? 'hull' : 'hulls'}`);
    if (item.friction != null) bits.push(`μ ${item.friction}`);
    if (item.tris) bits.push(`${(item.tris / 1000).toFixed(0)}k tris`);
    if (item.note) bits.push(item.note);
    for (const b of bits) facts.appendChild(el('span', 'gal-fact', b));
  }

  async function show(i) {
    if (busy) return;
    busy = true;
    const list = items[tab.id];
    index = (i + list.length) % list.length;
    const item = list[index];

    stage.classList.add('is-busy');
    teardown();
    title.textContent = item.label;
    setFacts(item);
    [...dots.children].forEach((d, k) => d.classList.toggle('is-active', k === index));

    try {
      if (tab.kind === 'rigid') {
        const {mount} = await import('./rigid-viewer.js?v=3');
        view = await mount(stage, {base: `assets/rigid/${item.id}`});
        view.setMode(rigidMode);
      } else if (tab.kind === 'mjcf') {
        const {mount} = await import('./mjcf-viewer.js');
        view = await mount(stage, {base: `assets/mjcf/${item.id}`});
      } else {
        const v = el('video');
        Object.assign(v, {src: `static/videos/turntable/${item.id}.mp4`,
                          muted: true, loop: true, autoplay: true, playsInline: true});
        v.className = 'gal-video';
        stage.appendChild(v);
        view = {dispose: () => v.remove()};
      }
    } catch (err) {
      title.textContent = `${item.label} — failed to load`;
      console.error('[gallery]', err);
    } finally {
      stage.classList.remove('is-busy');
      busy = false;
    }
  }

  function buildDots(n) {
    dots.textContent = '';
    for (let i = 0; i < n; i++) {
      const d = el('button', 'gal-dot');
      d.setAttribute('aria-label', `item ${i + 1}`);
      d.addEventListener('click', () => show(i));
      dots.appendChild(d);
    }
  }

  function selectTab(t) {
    tab = t;
    [...tabBar.children].forEach(b => b.classList.toggle('is-active', b.dataset.tab === t.id));
    host.querySelector('[data-blurb]').textContent = t.blurb;
    modes.hidden = t.kind !== 'rigid';
    buildDots(items[t.id].length);
    show(0);
  }

  for (const t of TABS) {
    const b = el('button', 'gal-tab', t.label);
    b.dataset.tab = t.id;
    b.addEventListener('click', () => selectTab(t));
    tabBar.appendChild(b);
  }

  for (const m of [['visual', 'Appearance'], ['hulls', 'Collision hulls']]) {
    const b = el('button', 'gal-mode', m[1]);
    b.dataset.mode = m[0];
    b.addEventListener('click', () => {
      rigidMode = m[0];
      [...modes.children].forEach(x => x.classList.toggle('is-active', x.dataset.mode === m[0]));
      view?.setMode?.(m[0]);
    });
    modes.appendChild(b);
  }
  modes.firstChild.classList.add('is-active');

  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  host.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });

  selectTab(TABS[0]);
}
