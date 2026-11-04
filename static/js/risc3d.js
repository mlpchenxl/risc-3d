/* RISC-3D page behaviour: lazy video playback, result lightbox, before/after
 * sliders. No dependencies — the template's jQuery is only used by its own
 * carousel code.
 */
(function () {
  'use strict';

  /* ── play a grid video only while it is on screen ─────────────────────────
   * Eight autoplaying clips decoding at once stalls a laptop, and every one of
   * them is also pulling bytes. Pausing off-screen keeps it to the two or three
   * the reader is actually looking at.
   */
  function lazyVideos() {
    var vids = document.querySelectorAll('video[data-lazy]');
    if (!('IntersectionObserver' in window)) {
      vids.forEach(function (v) { v.play().catch(function () {}); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) {
          if (!v.src && v.dataset.src) v.src = v.dataset.src;
          v.play().catch(function () {});
        } else {
          v.pause();
        }
      });
    }, {rootMargin: '200px 0px', threshold: 0.15});
    vids.forEach(function (v) { io.observe(v); });
  }

  /* ── click a result tile to open the 1080p cut ──────────────────────────── */
  function lightbox() {
    var box = document.getElementById('lightbox');
    if (!box) return;
    var vid = box.querySelector('video');

    function close() {
      box.classList.remove('open');
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
    }

    document.querySelectorAll('[data-full]').forEach(function (el) {
      el.addEventListener('click', function () {
        vid.src = el.dataset.full;
        box.classList.add('open');
        vid.play().catch(function () {});
      });
    });

    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.classList.contains('close')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* ── before/after wipe ──────────────────────────────────────────────────── */
  function sliders() {
    document.querySelectorAll('.risc-slider').forEach(function (root) {
      var after = root.querySelector('.after');
      var handle = root.querySelector('.handle');
      if (!after || !handle) return;

      function setTo(clientX) {
        var r = root.getBoundingClientRect();
        if (!r.width) return;
        var pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 100;
        var clip = 'inset(0 ' + (100 - pct) + '% 0 0)';
        after.style.webkitClipPath = clip;
        after.style.clipPath = clip;
        handle.style.left = pct + '%';
      }

      var dragging = false;
      root.addEventListener('dragstart', function (e) {
        e.preventDefault();
      });
      root.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        dragging = true;
        if (root.setPointerCapture && e.pointerId != null) {
          try { root.setPointerCapture(e.pointerId); } catch (_) {}
        }
        setTo(e.clientX);
      });
      window.addEventListener('pointermove', function (e) {
        if (dragging) setTo(e.clientX);
      });
      function stopDrag() { dragging = false; }
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);
      root.addEventListener('lostpointercapture', stopDrag);
    });
  }

  /* ── bibtex copy button ─────────────────────────────────────────────────── */
  function bibtex() {
    var btn = document.getElementById('copy-bibtex');
    var src = document.getElementById('bibtex-content');
    var label = document.getElementById('copy-label');
    if (!btn || !src || !label) return;
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(src.textContent).then(function () {
        btn.classList.add('copied');
        label.textContent = 'Copied!';
        setTimeout(function () {
          btn.classList.remove('copied');
          label.textContent = 'Copy';
        }, 1800);
      });
    });
  }

  /* ── hero background video playback sync & sticky nav scroll-spy ──────── */
  function heroVideoSync() {
    var video = document.getElementById('hero-video');
    if (!video) return;
    var reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : {matches: false};
    var visible = true;

    function syncPlayback() {
      if (!reducedMotion.matches && visible && !document.hidden) {
        video.play().catch(function () {});
      } else {
        video.pause();
      }
    }

    document.addEventListener('visibilitychange', syncPlayback);
    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener('change', syncPlayback);
    }
    if ('IntersectionObserver' in window) {
      var heroEl = video.closest('.hero') || video;
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        syncPlayback();
      }).observe(heroEl);
    }
    syncPlayback();
  }

  function headerNavSpy() {
    var links = Array.prototype.slice.call(
      document.querySelectorAll('.header-nav a[href^="#"]')
    );
    if (!links.length || !('IntersectionObserver' in window)) return;
    var targets = links
      .map(function (a) {
        var id = a.getAttribute('href').slice(1);
        var el = document.getElementById(id);
        return el ? {link: a, el: el} : null;
      })
      .filter(Boolean);

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        targets.forEach(function (t) {
          t.link.classList.toggle('is-active', t.el === entry.target);
        });
      });
    }, {rootMargin: '-25% 0px -60% 0px', threshold: 0});

    targets.forEach(function (t) { io.observe(t.el); });
  }

  /* ── back to top ────────────────────────────────────────────────────────── */
  function scrollTop() {
    var btn = document.getElementById('scroll-top');
    if (!btn) return;
    btn.addEventListener('click', function () {
      window.scrollTo({top: 0, behavior: 'smooth'});
    });
    window.addEventListener('scroll', function () {
      btn.classList.toggle('visible', window.scrollY > 600);
    }, {passive: true});
  }

  document.addEventListener('DOMContentLoaded', function () {
    heroVideoSync();
    headerNavSpy();
    lazyVideos();
    lightbox();
    sliders();
    bibtex();
    scrollTop();
  });
})();
