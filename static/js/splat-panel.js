/**
 * The raw 3D Gaussian Splatting capture, free-viewpoint in the page.
 *
 * This is the full storey capture that the simulation panel's assets were cut
 * out of, at the stage before anything was segmented: 2.6 million gaussians,
 * orbitable but completely inert. Placing it beside the MJCF panel is the whole
 * argument of the paper in one screen.
 *
 * Gated behind a button like the physics panel — the scene is 62 MB.
 */
import {autoStart} from './viewer-gate.js';

const PANEL = 'splat-viewer';
const SCENE = 'assets/splats/full_scene.ksplat';

// Storey extent from the point cloud's 1st/99th percentile: 45.3 x 25.6 x 3.4 m
// (x in [-36.9, 8.4], y in [-19.3, 6.3], z in [-0.8, 2.7]), centred near
// (-7.0, -2.5, 1.0), z up.
//
// The opening shot is an elevated oblique three-quarter view over the storey.
const UP = [0, 0, 1];
const EYE = [8.0, -22.0, 14.0];
const LOOK_AT = [-7.0, -2.5, 1.0];

document.addEventListener('DOMContentLoaded', () => {
  const host = document.getElementById(PANEL);
  if (!host) return;
  const stub = host.querySelector('.risc-viewer-stub');
  const btn = host.querySelector('[data-splat-load]');
  if (!btn) return;

  autoStart(host, async () => {
    btn.disabled = true;
    btn.textContent = 'Loading capture…';

    try {
      const GS = await import('../vendor/splats/gaussian-splats-3d.module.min.js');
      const viewer = new GS.Viewer({
        rootElement: host,
        cameraUp: UP,
        initialCameraPosition: EYE,
        initialCameraLookAt: LOOK_AT,
        // SharedArrayBuffer needs Cross-Origin-Opener-Policy and
        // Cross-Origin-Embedder-Policy response headers, which GitHub Pages
        // cannot set. Without this the workers fail to start.
        sharedMemoryForWorkers: false,
        useBuiltInControls: true,
        selfDrivenMode: true,
        dynamicScene: false,
        sceneRevealMode: GS.SceneRevealMode.Gradual,
      });

      await viewer.addSplatScene(SCENE, {
        progressiveLoad: true,
        onProgress: pct => {
          if (pct < 100) btn.textContent = `Loading capture… ${Math.round(pct)}%`;
        },
      });
      viewer.start();
      stub?.remove();

      const bar = document.createElement('div');
      bar.className = 'risc-viewer-bar';
      const stats = document.createElement('span');
      stats.className = 'risc-viewer-stats';
      stats.textContent = '2,573,121 gaussians · drag to look, scroll to move';
      bar.appendChild(stats);
      host.appendChild(bar);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Retry';
      const msg = host.querySelector('[data-splat-error]');
      if (msg) msg.textContent = String(err.message || err);
      console.error('[splat]', err);
    }
  }, btn);
});
