/**
 * A rigid asset in the page, in three dimensions, with its physics visible.
 *
 * Rigid assets have no joints, so there is nothing for a simulator to do with
 * one on its own — running MuJoCo here would buy nothing. What is worth showing
 * is the pair: the textured shape the pipeline reconstructed, and the convex
 * decomposition underneath it that makes the shape simulatable. Figure 1 states
 * that as "67 hulls"; this is that sentence with a picture.
 *
 * Both files come out of tools/pack-rigid.py in the same frame, so one recentre
 * computed from the visual mesh keeps them registered.
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

let loader = null;
function gltf() {
  if (!loader) {
    // gltfpack -cc writes meshopt-compressed buffers; without the decoder every
    // file fails to parse.
    loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

const load = url => new Promise((res, rej) => gltf().load(url, res, undefined, rej));

export async function mount(el, opts = {}) {
  const base = opts.base;
  const [visualGltf, hullGltf, meta] = await Promise.all([
    load(`${base}/visual.glb?v=3`),
    load(`${base}/hulls.glb?v=3`),
    fetch(`${base}/meta.json?v=3`).then(r => r.json()),
  ]);

  const scene = new THREE.Scene();
  // Lighter than the physics panel on purpose: most of this furniture is dark,
  // and a near-black backdrop turns an office chair into a silhouette.
  scene.background = new THREE.Color(0x1b2227);

  // Assets carry their room coordinates, so an office chair arrives several
  // metres from the origin. Centre on the visual mesh and move the hulls by the
  // same amount rather than centring each on itself, which would slide the two
  // representations apart.
  const visual = visualGltf.scene;
  const hulls = hullGltf.scene;
  const box = new THREE.Box3().setFromObject(visual);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  visual.position.sub(centre);
  hulls.position.sub(centre);

  // glTF is y-up; these assets were authored z-up in MuJoCo.
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2;
  world.add(visual, hulls);
  scene.add(world);

  hulls.visible = false;
  hulls.traverse(o => {
    if (!o.isMesh) return;
    // Barely any environment: the room probe that makes the textured meshes
    // read correctly washes flat vertex colours out to white, and telling the
    // hulls apart is the entire point of this mode.
    o.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.1,
      side: THREE.DoubleSide,
    });
  });
  visual.traverse(o => {
    if (o.isMesh && o.material) o.material.side = THREE.DoubleSide;
  });

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4.5, 3.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fd6e6, 0.6);
  fill.position.set(-3, 1.5, -2.5);
  scene.add(fill);

  const radius = Math.max(size.length() / 2, 0.15);
  if (opts.debug) {
    let tris = 0;
    visual.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
    console.log('[rigid] size', size.toArray().map(v => +v.toFixed(3)),
                'radius', +radius.toFixed(3), 'visual tris', tris,
                'hull meshes', hulls.children.length);
  }
  const FOV = 35;
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 10, radius / 100, radius * 80);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(FOV) / 2) * 1.1;
  camera.position.set(dist * 0.72, dist * 0.42, dist * 0.72);

  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  el.appendChild(renderer.domElement);

  // Directional lights alone leave a black mesh office chair as a silhouette:
  // these are PBR materials and most of what should light them is indirect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = radius * 0.8;
  controls.maxDistance = radius * 8;
  // Turn slowly until touched, so the panel reads as three-dimensional without
  // the reader having to discover that it can be dragged.
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.9;
  controls.addEventListener('start', () => { controls.autoRotate = false; });
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

  let visible = true;
  const onScreen = new IntersectionObserver(
    es => { visible = es[0].isIntersecting; }, {threshold: 0.05});
  onScreen.observe(el);

  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    controls.update();
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    meta,
    setMode(mode) {
      visual.visible = mode !== 'hulls';
      hulls.visible = mode === 'hulls';
    },
    dispose() {
      cancelAnimationFrame(raf);
      onResize.disconnect();
      onScreen.disconnect();
      controls.dispose();
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) {
          m.map?.dispose();
          m.dispose();
        }
      });
      envRT.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
