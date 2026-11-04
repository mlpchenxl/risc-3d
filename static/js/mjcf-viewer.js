/**
 * Run one of the paper's emitted MJCF assets live in the page.
 *
 * MuJoCo compiled to WebAssembly (@mujoco/mujoco 3.11.0, the single-threaded
 * build so no cross-origin isolation headers are needed) steps the real
 * physics; three.js draws the result. Nothing here is a recording — the doors
 * swing because the hinges in the emitted model say they can.
 *
 * The engine is 9.7 MB, so nothing loads until the reader asks for it.
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const GEOM = {PLANE: 0, SPHERE: 2, CAPSULE: 3, ELLIPSOID: 4, CYLINDER: 5, BOX: 6, MESH: 7};

/**
 * Groups MuJoCo's own viewer shows by default. The pipeline is not consistent
 * about which one visual geometry lands in — built-in assets use 2, articulated
 * ones use 0 — but both put collision hulls in 3, so the rule that works for
 * every asset is "draw 0-2, never 3 and up".
 */
const isVisualGroup = g => g >= 0 && g <= 2;

/** Fetch the model and every asset it names into the WASM filesystem. */
async function stageFiles(mj, base, root) {
  const xml = await (await fetch(`${base}/model.xml`)).text();
  mj.FS.mkdirTree(`${root}/assets`);
  mj.FS.writeFile(`${root}/model.xml`, xml);

  // The compiler resolves mesh/texture paths itself, so the only way to know
  // what to stage is to read the same file="..." references it will.
  const files = [...xml.matchAll(/file="([^"]+)"/g)].map(m => m[1]);
  await Promise.all([...new Set(files)].map(async f => {
    const res = await fetch(`${base}/assets/${f}`);
    if (!res.ok) throw new Error(`asset ${f}: ${res.status}`);
    mj.FS.writeFile(`${root}/assets/${f}`, new Uint8Array(await res.arrayBuffer()));
  }));
  return files.length;
}

/** BufferGeometry for mesh index `id` out of the model's packed mesh arrays. */
function meshGeometry(model, id) {
  const v0 = model.mesh_vertadr[id], nv = model.mesh_vertnum[id];
  const f0 = model.mesh_faceadr[id], nf = model.mesh_facenum[id];

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(
    model.mesh_vert.slice(v0 * 3, (v0 + nv) * 3), 3));
  // Face indices are local to the mesh's own vertex block.
  g.setIndex(new THREE.BufferAttribute(
    Uint32Array.from(model.mesh_face.slice(f0 * 3, (f0 + nf) * 3)), 1));
  g.computeVertexNormals();
  return g;
}

/** three.js geometry for a primitive geom, from its MuJoCo size triple. */
function primitiveGeometry(type, s) {
  switch (type) {
    case GEOM.PLANE:    return new THREE.PlaneGeometry(20, 20);
    case GEOM.SPHERE:   return new THREE.SphereGeometry(s[0], 24, 16);
    case GEOM.CAPSULE:  return new THREE.CapsuleGeometry(s[0], s[1] * 2, 8, 16);
    case GEOM.ELLIPSOID: {
      const g = new THREE.SphereGeometry(1, 24, 16);
      g.scale(s[0], s[1], s[2]);
      return g;
    }
    case GEOM.CYLINDER: return new THREE.CylinderGeometry(s[0], s[0], s[1] * 2, 24)
      .rotateX(Math.PI / 2);   // MuJoCo cylinders run along local z, three's along y
    case GEOM.BOX:      return new THREE.BoxGeometry(s[0] * 2, s[1] * 2, s[2] * 2);
    default:            return null;
  }
}

function geomColor(model, i) {
  const mid = model.geom_matid ? model.geom_matid[i] : -1;
  const src = mid >= 0 ? model.mat_rgba : model.geom_rgba;
  const off = (mid >= 0 ? mid : i) * 4;
  return {rgb: new THREE.Color(src[off], src[off + 1], src[off + 2]), alpha: src[off + 3]};
}

/**
 * The engine is loaded once per page and kept. Switching assets tears down the
 * scene and the model, never the 9.7 MB module.
 */
let engine = null;
export function loadEngine() {
  if (!engine) {
    engine = import('../vendor/mujoco/mujoco.js').then(m => m.default());
  }
  return engine;
}

/** Distinct virtual-filesystem root per asset, so a reload never sees stale files. */
let mountCount = 0;

export async function mount(el, opts = {}) {
  const base = opts.base;
  const mj = await loadEngine();

  const root = `/m${mountCount++}`;
  await stageFiles(mj, base, root);
  const model = mj.MjModel.from_xml_path(`${root}/model.xml`);
  const data = new mj.MjData(model);
  mj.mj_forward(model, data);

  // ── scene ──────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  // Same backdrop as the gallery stage and the rigid viewer, so switching
  // tabs does not flash a different grey.
  scene.background = new THREE.Color(0x1b2227);

  // MuJoCo is z-up, three.js is y-up. Rotating one parent lets every child
  // take its MuJoCo pose verbatim, with no per-frame conversion.
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  scene.add(new THREE.HemisphereLight(0xbfd8e6, 0x20262b, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd6e6, 0.8);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  // ── one three.js mesh per visual geom ──────────────────────────────────
  const drawn = [];
  for (let i = 0; i < model.ngeom; i++) {
    if (!isVisualGroup(model.geom_group[i])) continue;
    const type = model.geom_type[i];
    const geometry = type === GEOM.MESH
      ? meshGeometry(model, model.geom_dataid[i])
      : primitiveGeometry(type, model.geom_size.slice(i * 3, i * 3 + 3));
    if (!geometry) continue;

    const {rgb, alpha} = geomColor(model, i);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: rgb,
      roughness: 0.72,
      metalness: 0.04,
      transparent: alpha < 1,
      opacity: alpha,
      side: THREE.DoubleSide,
    }));
    mesh.matrixAutoUpdate = false;
    world.add(mesh);
    drawn.push({i, mesh});
  }

  // ── frame the model ────────────────────────────────────────────────────
  const box = new THREE.Box3();
  const m4 = new THREE.Matrix4();
  const syncPoses = () => {
    for (const {i, mesh} of drawn) {
      const p = i * 3, r = i * 9;
      const x = data.geom_xpos, R = data.geom_xmat;   // R is row-major 3x3
      m4.set(R[r], R[r + 1], R[r + 2], x[p],
             R[r + 3], R[r + 4], R[r + 5], x[p + 1],
             R[r + 6], R[r + 7], R[r + 8], x[p + 2],
             0, 0, 0, 1);
      mesh.matrix.copy(m4);
      mesh.matrixWorld.multiplyMatrices(world.matrix, m4);
    }
  };
  syncPoses();
  world.updateMatrixWorld(true);
  drawn.forEach(({mesh}) => box.expandByObject(mesh));

  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.3);
  if (opts.debug) {
    console.log('[mjcf] bbox min', box.min.toArray().map(v => +v.toFixed(3)),
                'max', box.max.toArray().map(v => +v.toFixed(3)),
                'size', size.toArray().map(v => +v.toFixed(3)));
  }

  // Look down the shallowest horizontal axis. A run of wall cabinets is 5 m
  // wide and 0.3 m deep; approached along its length it is a slab, approached
  // along its depth every door faces the camera.
  const front = size.x <= size.z
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 0, 1);
  // Front-on but off-axis, so the doors read as volumes and not as a facade.
  front.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.42);

  // Fit the bounding sphere in the vertical field of view. The panel is wider
  // than it is tall, so vertical is always the binding axis, and the margin
  // leaves room for the doors and drawers to swing out past the rest pose.
  const FOV = 38;
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.01, radius * 60);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(FOV) / 2) * 1.15;
  camera.position.copy(centre)
    .add(front.multiplyScalar(dist))
    .add(new THREE.Vector3(0, radius * 0.35, 0));

  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(centre);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = radius * 0.6;
  controls.maxDistance = radius * 8;
  controls.update();

  const resize = () => {
    const {clientWidth: w, clientHeight: h} = el;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const onResize = new ResizeObserver(resize);
  onResize.observe(el);

  // ── actuation ──────────────────────────────────────────────────────────
  // Every joint the pipeline emitted gets a position actuator, so driving ctrl
  // through its range is exactly what the paper claims the asset supports.
  const nu = model.nu;
  const range = [];
  for (let a = 0; a < nu; a++) {
    range.push([model.actuator_ctrlrange[a * 2], model.actuator_ctrlrange[a * 2 + 1]]);
  }

  let playing = true;
  let visible = true;

  function actuate() {
    // Drive from simulated time, not wall clock: the animation then depends on
    // nothing but how far the physics has run, which keeps it identical across
    // refresh rates and lets a headless capture advance it deterministically.
    for (let a = 0; a < nu; a++) {
      // Stagger the leaves so the asset reads as several independent joints
      // rather than one rigid gesture.
      const t = data.time * 0.55 - a * 0.22;
      const s = (1 - Math.cos(Math.max(t, 0))) / 2;   // 0..1, starts at rest
      const [lo, hi] = range[a];
      data.ctrl[a] = lo + (hi - lo) * s;
    }
  }

  // Run the model forward before the first frame is drawn. Useful to open an
  // asset up for a still, and the only way a headless capture — which paints
  // after a handful of animation frames however long you give it — can be shown
  // anything but the rest pose.
  if (opts.warmup) {
    const n = Math.min(Math.round(opts.warmup / model.opt.timestep), 20000);
    for (let s = 0; s < n; s++) {
      actuate();
      mj.mj_step(model, data);
    }
    syncPoses();
  }

  let last = performance.now();
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (playing && visible) {
      actuate();
      // Track real time when the clock is sane, otherwise assume one 60 Hz
      // frame — a headless capture reports dt ≈ 0 and would never step at all.
      const span = (dt > 0.001 && dt < 0.1) ? dt : 1 / 60;
      const steps = Math.min(Math.round(span / model.opt.timestep), 40);
      for (let s = 0; s < steps; s++) mj.mj_step(model, data);
      syncPoses();
    }
    controls.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  // Stop stepping physics when the panel scrolls out of view.
  const onScreen = new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    last = performance.now();
  }, {threshold: 0.05});
  onScreen.observe(el);

  return {
    stats: {
      bodies: model.nbody - 1,      // exclude the world body
      joints: model.njnt,
      actuators: nu,
      geoms: drawn.length,
    },
    setPlaying(v) { playing = v; last = performance.now(); },
    reset() {
      // Resets data.time too, which is what the actuation phase reads.
      mj.mj_resetData(model, data);
      mj.mj_forward(model, data);
      syncPoses();
    },
    dispose() {
      cancelAnimationFrame(raf);
      onScreen.disconnect();
      onResize.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      // Embind handles live on the WASM heap and are not garbage collected.
      data.delete();
      model.delete();
    },
  };
}
