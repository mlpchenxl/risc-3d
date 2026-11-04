/**
 * Live 3D split-wipe comparison viewer for #ablation ("Comparisons").
 *
 * Left of the wipe divider: raw 3D Gaussian Splatting capture of large_room_b.
 * Right of the wipe divider: carved/inpainted clean 3DGS background +
 * reconstructed foreground rigid objects and articulated built-in cabinets
 * (toggleable between textured visual meshes and collision hulls),
 * clipped in real time against the camera frustum plane at the divider's X.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import {GLTFLoader} from '../vendor/three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../vendor/three/addons/libs/meshopt_decoder.module.js';
import * as GS from '../vendor/splats/gaussian-splats-3d.module.min.js';
import {autoStart} from './viewer-gate.js';

const PANEL = 'cmp-viewer';
const RAW_SPLAT_URL = 'assets/splats/large_room_b.ksplat';
const CLEAN_SPLAT_URL = 'assets/splats/large_room_b_clean.ksplat';
const BUILTINS_GLB_URL = 'assets/builtin/large_room_b_builtins.glb?v=2';
const BUILTINS_JSON_URL = 'assets/builtin/large_room_b_builtins.json?v=2';

const UP = [0, 0, 1];
const EYE = [3.8, -10.8, 3.6];
const LOOK_AT = [0.4, -4.2, 0.8];

const OBJECT_IDS = [
  'bar_stool_1_000',
  'bar_stool_1_001',
  'bar_stool_1_002',
  'bar_stool_2',
  'bottle_1',
  'bottle_2',
  'chair_1',
  'fire_extinguisher_1_000',
  'fire_extinguisher_1_001',
  'induction_cooker',
  'office_chair_1',
  'pillow_1',
  'potted_plant_1',
  'sectional_sofa_1',
  'speaker_1',
  'white_coffee_table_1',
  'white_couch_1',
];

const PALETTE = [
  0x4ea8de, 0x56cfe1, 0x72efdd, 0x80ffdb,
  0xf4a261, 0xe76f51, 0x2a9d8f, 0xe9c46a,
  0xa8dadc, 0xffb703, 0x8ecae6, 0xcdb4db,
  0xffafcc, 0xbde0fe, 0x90be6d, 0xf9844a,
  0x577590,
];

let gltfLoader = null;
function getLoader() {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  }
  return gltfLoader;
}

const loadGLTF = url =>
  new Promise((resolve, reject) => getLoader().load(url, resolve, undefined, reject));

function applyLitVisualMaterial(root, clipPlane) {
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    if (o.geometry) {
      o.geometry.computeVertexNormals();
    }
    const oldMat = Array.isArray(o.material) ? o.material[0] : o.material;
    const map = oldMat?.map || null;
    if (map) {
      map.colorSpace = THREE.LinearSRGBColorSpace;
      map.needsUpdate = true;
    }
    o.material = new THREE.MeshLambertMaterial({
      map,
      color: 0xffffff,
      side: THREE.DoubleSide,
      clippingPlanes: [clipPlane],
    });
  });
}

function applyHullMaterial(root, clipPlane, startColorIdx = 0) {
  let cursor = startColorIdx;
  root.traverse(o => {
    if (!o.isMesh) return;
    const hasVC = Boolean(
      o.geometry && o.geometry.attributes && o.geometry.attributes.color
    );
    const colorHex = PALETTE[cursor++ % PALETTE.length];
    o.material = new THREE.MeshStandardMaterial({
      color: hasVC ? 0xffffff : colorHex,
      vertexColors: hasVC,
      roughness: 0.65,
      metalness: 0.05,
      side: THREE.DoubleSide,
      clippingPlanes: [clipPlane],
      clipShadows: true,
    });

    const wireGeo = new THREE.WireframeGeometry(o.geometry);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x0b151c,
      transparent: true,
      opacity: 0.22,
      clippingPlanes: [clipPlane],
    });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    o.add(wire);
  });
}

function patchSplatSplitShader(splatMesh, initialSplitRatio = 0.5) {
  const mat = splatMesh?.material;
  if (!mat) return;
  mat.uniforms.splitRatio = {type: 'f', value: initialSplitRatio};

  mat.vertexShader = mat.vertexShader
    .replace(
      'varying vec2 vPosition;',
      'varying vec2 vPosition;\n        varying float vSceneIndex;'
    )
    .replace(
      /if\s*\(sceneCount\s*>\s*1\)\s*\{\s*sceneIndex\s*=\s*texture\(sceneIndexesTexture,\s*getDataUV\(1,\s*0,\s*sceneIndexesTextureSize\)\)\.r;\s*\}/,
      '$&\n            vSceneIndex = float(sceneIndex);'
    );

  mat.fragmentShader = mat.fragmentShader
    .replace(
      'uniform vec3 debugColor;',
      'uniform vec3 debugColor;\n            uniform vec2 viewport;\n            uniform float splitRatio;\n            varying float vSceneIndex;'
    )
    .replace(
      'void main () {',
      `void main () {
                if (splitRatio >= 0.0 && viewport.x > 0.0) {
                    float screenX = gl_FragCoord.x / viewport.x;
                    if (vSceneIndex < 0.5 && screenX > splitRatio) discard;
                    if (vSceneIndex > 0.5 && screenX <= splitRatio) discard;
                }`
    );

  mat.needsUpdate = true;
  mat.uniformsNeedUpdate = true;
}

document.addEventListener('DOMContentLoaded', () => {
  const host = document.getElementById(PANEL);
  if (!host) return;
  const btn = host.querySelector('.risc-viewer-cta');

  const start = async () => {
    if (btn) {
      btn.disabled = true;
      const titleEl = btn.querySelector('.cta-title');
      if (titleEl) titleEl.textContent = 'Loading 3D scene…';
      else btn.textContent = 'Loading 3D scene…';
    }

    const stage = document.createElement('div');
    stage.className = 'cmp-stage';
    host.appendChild(stage);

    try {
      const threeScene = new THREE.Scene();

      const ambient = new THREE.AmbientLight(0xffffff, 0.78);
      threeScene.add(ambient);

      const keyLight = new THREE.DirectionalLight(0xffffff, 0.32);
      keyLight.position.set(6.0, -10.0, 12.0);
      threeScene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xffffff, 0.18);
      fillLight.position.set(-8.0, 8.0, 6.0);
      threeScene.add(fillLight);

      const viewer = new GS.Viewer({
        threeScene,
        cameraUp: UP,
        initialCameraPosition: EYE,
        initialCameraLookAt: LOOK_AT,
        rootElement: stage,
        sharedMemoryForWorkers: false,
        gpuAcceleratedSort: false,
        useBuiltInControls: true,
        selfDrivenMode: true,
        dynamicScene: true,
        sceneRevealMode: GS.SceneRevealMode.Instant,
      });

      await viewer.addSplatScenes(
        [
          {path: RAW_SPLAT_URL, splatAlphaRemovalThreshold: 5},
          {path: CLEAN_SPLAT_URL, splatAlphaRemovalThreshold: 5},
        ],
        false
      );
      patchSplatSplitShader(viewer.splatMesh, 0.5);
      viewer.start();

      if (viewer.renderer) {
        viewer.renderer.localClippingEnabled = true;
      }

      const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

      const hullsGroup = new THREE.Group();
      const visualGroup = new THREE.Group();
      hullsGroup.visible = false;
      visualGroup.visible = true;
      threeScene.add(hullsGroup, visualGroup);

      const animatedJoints = [];

      // Preload rigid objects + articulated built-in cabinets in room-space Z-up coordinates.
      await Promise.all([
        ...OBJECT_IDS.map((id, objIdx) =>
          Promise.all([
            loadGLTF(`assets/rigid/${id}/visual.glb?v=3`)
              .then(gltf => {
                const root = gltf.scene;
                applyLitVisualMaterial(root, clipPlane);
                visualGroup.add(root);
              })
              .catch(e => {
                console.warn(`[cmp-panel] Failed to load visual mesh for ${id}:`, e);
              }),
            loadGLTF(`assets/rigid/${id}/hulls.glb?v=3`)
              .then(gltf => {
                const root = gltf.scene;
                applyHullMaterial(root, clipPlane, objIdx);
                hullsGroup.add(root);
              })
              .catch(e => {
                console.warn(`[cmp-panel] Failed to load hulls for ${id}:`, e);
              }),
          ])
        ),
        Promise.all([
          loadGLTF(BUILTINS_GLB_URL),
          fetch(BUILTINS_JSON_URL).then(r => r.json()),
        ])
          .then(([builtinsGltf, builtinsMeta]) => {
            const builtinsVisualRoot = builtinsGltf.scene;
            const builtinsHullsRoot = builtinsVisualRoot.clone(true);

            applyLitVisualMaterial(builtinsVisualRoot, clipPlane);
            applyHullMaterial(builtinsHullsRoot, clipPlane, 5);

            visualGroup.add(builtinsVisualRoot);
            hullsGroup.add(builtinsHullsRoot);

            for (const j of builtinsMeta.joints || []) {
              const targets = [];
              for (const nodeName of j.nodes || []) {
                const vNode = builtinsVisualRoot.getObjectByName(nodeName);
                const hNode = builtinsHullsRoot.getObjectByName(nodeName);
                if (vNode) targets.push(vNode);
                if (hNode) targets.push(hNode);
              }
              if (!targets.length) continue;
              const hi = Array.isArray(j.limits) ? j.limits[1] : 1.0;
              animatedJoints.push({
                type: j.type,
                origin: new THREE.Vector3(...j.origin),
                axis: new THREE.Vector3(...j.axis).normalize(),
                maxVal: hi * 0.75,
                targets,
              });
            }
          })
          .catch(e => {
            console.warn('[cmp-panel] Failed to load built-in cabinets:', e);
          }),
      ]);

      btn?.remove();

      // Overlay tags
      const tagL = document.createElement('span');
      tagL.className = 'tag-l';
      tagL.textContent = '3DGS capture';

      const tagR = document.createElement('span');
      tagR.className = 'tag-r';
      tagR.textContent = 'Reconstructed scene \u00b7 Visual meshes';

      // Vertical split-wipe divider
      const divider = document.createElement('div');
      divider.className = 'cmp-divider';
      divider.innerHTML = '<div class="cmp-line"></div><div class="cmp-knob">&#10231;</div>';

      // Bottom-left mode toggle pill
      const modes = document.createElement('div');
      modes.className = 'cmp-modes';

      const visualBtn = document.createElement('button');
      visualBtn.type = 'button';
      visualBtn.className = 'cmp-mode is-active';
      visualBtn.textContent = 'Visual meshes';

      const hullsBtn = document.createElement('button');
      hullsBtn.type = 'button';
      hullsBtn.className = 'cmp-mode';
      hullsBtn.textContent = 'Collision hulls';

      modes.append(visualBtn, hullsBtn);
      host.append(tagL, tagR, divider, modes);

      const setMode = mode => {
        if (mode === 'visual') {
          hullsBtn.classList.remove('is-active');
          visualBtn.classList.add('is-active');
          hullsGroup.visible = false;
          visualGroup.visible = true;
          tagR.textContent = 'Reconstructed scene \u00b7 Visual meshes';
        } else {
          visualBtn.classList.remove('is-active');
          hullsBtn.classList.add('is-active');
          visualGroup.visible = false;
          hullsGroup.visible = true;
          tagR.textContent = 'Reconstructed scene \u00b7 Collision hulls';
        }
      };

      hullsBtn.addEventListener('click', e => {
        e.stopPropagation();
        setMode('hulls');
      });
      visualBtn.addEventListener('click', e => {
        e.stopPropagation();
        setMode('visual');
      });

      // Split-wipe drag handling
      let pct = 50;
      let dragging = false;

      const updatePctFromEvent = e => {
        const rect = host.getBoundingClientRect();
        if (!rect.width) return;
        const raw = ((e.clientX - rect.left) / rect.width) * 100;
        pct = Math.max(4, Math.min(96, raw));
        divider.style.left = `${pct}%`;
        if (viewer.splatMesh?.material?.uniforms?.splitRatio) {
          viewer.splatMesh.material.uniforms.splitRatio.value = pct / 100;
        }
      };

      divider.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
      });

      window.addEventListener('pointermove', e => {
        if (!dragging) return;
        updatePctFromEvent(e);
      });

      const stopDrag = () => {
        dragging = false;
      };
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);

      // Update world-space clipping plane and cabinet joint animations every frame
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const pRight = new THREE.Vector3();
      const animQuat = new THREE.Quaternion();
      const animPos = new THREE.Vector3();

      const tick = nowMs => {
        requestAnimationFrame(tick);
        if (viewer.renderer && !viewer.renderer.localClippingEnabled) {
          viewer.renderer.localClippingEnabled = true;
        }
        if (viewer.splatMesh?.material?.uniforms?.splitRatio) {
          viewer.splatMesh.material.uniforms.splitRatio.value = pct / 100;
        }

        const ndcX = pct / 50 - 1;
        const cam = viewer.camera;
        if (cam) {
          cam.updateMatrixWorld();
          p0.setFromMatrixPosition(cam.matrixWorld);
          p1.set(ndcX, -1, 0.5).unproject(cam);
          p2.set(ndcX, 1, 0.5).unproject(cam);
          clipPlane.setFromCoplanarPoints(p0, p1, p2);
          pRight.set(ndcX + 0.2, 0, 0.5).unproject(cam);
          if (clipPlane.distanceToPoint(pRight) < 0) clipPlane.negate();
        }

        const tSec = (nowMs || performance.now()) * 0.001;
        for (let i = 0; i < animatedJoints.length; i++) {
          const j = animatedJoints[i];
          const w = 0.5 - 0.5 * Math.cos(tSec * 1.5 - i * 0.22);
          const frac = w * w * (3 - 2 * w);
          const val = frac * j.maxVal;
          if (j.type === 'revolute') {
            animQuat.setFromAxisAngle(j.axis, val);
            animPos.copy(j.origin).applyQuaternion(animQuat).sub(j.origin).negate();
            for (const node of j.targets) {
              node.position.copy(animPos);
              node.quaternion.copy(animQuat);
            }
          } else if (j.type === 'prismatic') {
            animPos.copy(j.axis).multiplyScalar(val);
            for (const node of j.targets) {
              node.position.copy(animPos);
            }
          }
        }
      };
      requestAnimationFrame(tick);
    } catch (err) {
      console.error('[cmp-panel]', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry loading comparison viewer';
      }
    }
  };

  autoStart(host, start, btn);
});
