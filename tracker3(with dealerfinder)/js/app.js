/* ==========================================================================
   PitStop — Welcome screen
   - Scramble-text intro (random glyphs resolving into the real copy)
   - 3D dial scene: pointer tilt + parallax, spring-driven needle, auto-sway
   - "Enter the Garage" button: magnetic pull, ripple, rev-up, exit transition

   "Enter the Garage" is a plain link to garage.html (see index.html); the
   click handler below only adds a short exit animation before navigating.
   ========================================================================== */

const PitStopWelcome = (() => {
  'use strict';

  /* ---- Config ---- */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!<>-_\\/[]{}=+*^?#';
  const NOISE_TICK_MS = 40;     // how often unresolved glyphs change
  const FONT_WAIT_MS = 800;     // max wait for web fonts before the intro starts
  const NEEDLE_START_MS = 1400; // needle sweeps after the layers have flown in
  const EXIT_MS = 420;          // exit animation length before navigating

  const REST = 0.58;            // needle resting position (0–1 of the 270° sweep)
  const REV = 0.2;              // extra sweep while the CTA is hovered/focused
  const ARC_LEN = 754;          // length of the 270° sweep path (r = 160)
  const SPRING_K = 70;          // needle spring stiffness
  const SPRING_C = 8.5;         // needle damping (under-damped = small overshoot)
  const TILT_SMOOTH = 4.5;      // pointer-follow smoothing
  const MAGNET_MAX = 8;         // max magnetic pull on the CTA, in px
  const MAGNET_REACH = 80;      // px around the CTA where the pull starts

  /* ---- Helpers ---- */
  const root = document.documentElement;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const mq = {
    reduce: window.matchMedia('(prefers-reduced-motion: reduce)'),
    tablet: window.matchMedia('(max-width: 860px)'),
    phone: window.matchMedia('(max-width: 560px)')
  };

  /* ---- State ---- */
  const scene = {
    el: null, arc: null, needle: null, halo: null,
    tx: 0, ty: 0,               // smoothed tilt, -1…1
    v: 0, vel: 0,               // needle value + velocity
    needleAt: Infinity,         // timestamp when the needle starts its sweep
    rev: 0, revTarget: 0,       // 0–1, CTA hover/focus "revving"
    raf: 0, last: 0
  };
  const pointer = { x: 0, y: 0, live: false };
  const cta = { el: null, x: 0, y: 0, tx: 0, ty: 0, hover: false, focus: false, leaving: false };


  /* ==========================================================================
     Scramble text
     ========================================================================== */
  const jobs = new Set();
  let scrambleRaf = 0;

  const isScrambleable = (ch) => /[A-Za-z0-9]/.test(ch);
  const randomGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

  function markRevealed(el) {
    el.classList.add('is-revealed');
    const group = el.closest('[data-reveal-group]');
    if (group) group.classList.add('is-revealed');
  }

  // Split a block into words → characters. The real text stays available to
  // assistive tech via a visually-hidden copy; the animated spans are aria-hidden.
  function prepare(el) {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const readable = document.createElement('span');
    readable.className = 'visually-hidden';
    readable.textContent = text;

    const visual = document.createElement('span');
    visual.className = 'scr';
    visual.setAttribute('aria-hidden', 'true');

    const chars = [];
    const words = text.split(' ');
    words.forEach((word, wi) => {
      const wordEl = document.createElement('span');
      wordEl.className = 'scr-word';
      for (const ch of word) {
        const charEl = document.createElement('span');
        charEl.className = 'scr-char';
        charEl.textContent = ch;
        wordEl.appendChild(charEl);
        chars.push({ el: charEl, ch, scramble: isScrambleable(ch), lock: 0, done: false, noisy: false });
      }
      visual.appendChild(wordEl);
      if (wi < words.length - 1) visual.appendChild(document.createTextNode(' '));
    });

    el.textContent = '';
    el.append(readable, visual);
    return { el, text, chars, start: null, lastTick: -Infinity, resolve: null };
  }

  // Measure every final glyph first (one layout), then lock the widths so
  // random glyphs can never change line breaks or push neighbours around.
  function lockWidths(items) {
    const widths = items.map((it) => it.chars.map((c) => c.el.getBoundingClientRect().width));
    items.forEach((it, i) => {
      it.chars.forEach((c, j) => {
        c.el.style.width = widths[i][j] + 'px';
        c.el.classList.add('is-locked');
      });
    });
  }

  function play(item) {
    const delay = Number(item.el.dataset.delay) || 0;
    const duration = Number(item.el.dataset.duration) || 1000;
    const n = item.chars.length;

    // Left-to-right lock-in with a little randomness per character.
    item.chars.forEach((c, i) => {
      c.lock = c.scramble ? (i / n) * duration * 0.8 + Math.random() * duration * 0.2 : 0;
    });

    return new Promise((resolve) => {
      item.resolve = resolve;
      setTimeout(() => {
        markRevealed(item.el);
        jobs.add(item);
        if (!scrambleRaf) scrambleRaf = requestAnimationFrame(tickScramble);
      }, delay);
    });
  }

  function tickScramble(now) {
    scrambleRaf = 0;

    jobs.forEach((item) => {
      if (item.start === null) item.start = now;
      const t = now - item.start;
      const tick = now - item.lastTick >= NOISE_TICK_MS;
      let pending = 0;

      for (const c of item.chars) {
        if (!c.scramble || c.done) continue;
        if (t >= c.lock) {
          c.el.textContent = c.ch;
          c.el.classList.remove('is-noise');
          c.done = true;
        } else {
          pending++;
          if (tick || !c.noisy) {
            c.el.textContent = randomGlyph();
            if (!c.noisy) { c.el.classList.add('is-noise'); c.noisy = true; }
          }
        }
      }
      if (tick) item.lastTick = now;

      if (!pending) {
        // Done: put the original text back so the final DOM is exactly the copy.
        jobs.delete(item);
        item.el.textContent = item.text;
        item.resolve();
      }
    });

    if (jobs.size) scrambleRaf = requestAnimationFrame(tickScramble);
  }

  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    const loads = ['600 1em Sora', '400 1em Inter', '400 1em "JetBrains Mono"']
      .map((f) => document.fonts.load(f).catch(() => null));
    await Promise.race([Promise.all(loads).then(() => document.fonts.ready), wait(FONT_WAIT_MS)]);
  }

  async function playIntro() {
    const texts = $$('[data-scramble]');
    const reveals = $$('[data-reveal]');

    if (mq.reduce.matches) {
      texts.forEach(markRevealed);
      reveals.forEach((el) => el.classList.add('is-revealed'));
      startScene(true);
      return;
    }

    const items = texts.map(prepare);
    await loadFonts();          // measure with the real fonts, not fallbacks
    lockWidths(items);

    startScene(false);
    items.forEach(play);
    reveals.forEach((el) => {
      setTimeout(() => el.classList.add('is-revealed'), Number(el.dataset.revealDelay) || 0);
    });
  }


  /* ==========================================================================
     3D scene
     ========================================================================== */
  function setGauge(v) {
    if (!scene.needle || !scene.arc) return;
    scene.needle.style.rotate = (-135 + 270 * v).toFixed(2) + 'deg';
    scene.arc.style.strokeDashoffset = (ARC_LEN * (1 - clamp(v, 0, 1))).toFixed(1);
  }

  function startScene(isStatic) {
    if (!scene.el) return;
    scene.el.classList.add('is-on');
    if (isStatic) { scene.v = REST; setGauge(REST); return; }
    scene.needleAt = performance.now() + NEEDLE_START_MS;
  }

  // One loop drives tilt, parallax, needle spring, halo and the CTA's magnetic pull.
  function frame(now) {
    scene.raf = requestAnimationFrame(frame);
    const dt = Math.min((now - scene.last) / 1000, 0.05);
    scene.last = now;
    if (dt <= 0) return;

    // Tilt target: follow the mouse, otherwise (touch, no pointer, narrow
    // screens) a slow auto-sway.
    const calm = mq.tablet.matches;
    let ttx, tty;
    if (!calm && pointer.live) {
      ttx = clamp((pointer.x / window.innerWidth) * 2 - 1, -1, 1);
      tty = clamp((pointer.y / window.innerHeight) * 2 - 1, -1, 1);
    } else {
      const amp = calm ? 0.3 : 0.55;
      ttx = Math.sin(now * 0.00035) * amp;
      tty = Math.cos(now * 0.00027) * amp * 0.55;
    }
    const k = 1 - Math.exp(-dt * TILT_SMOOTH);
    scene.tx += (ttx - scene.tx) * k;
    scene.ty += (tty - scene.ty) * k;

    // Rev: eases toward 1 while the CTA is hovered/focused.
    scene.rev += (scene.revTarget - scene.rev) * (1 - Math.exp(-dt * 6));

    // Needle: under-damped spring toward REST (+ rev + engine jitter).
    let target = 0;
    if (now >= scene.needleAt) {
      const jitter = (0.0045 * Math.sin(now * 0.0071) + 0.003 * Math.sin(now * 0.0113 + 1.7)) * (1 + scene.rev * 1.5);
      target = REST + REV * scene.rev + jitter;
    }
    scene.vel += ((target - scene.v) * SPRING_K - scene.vel * SPRING_C) * dt;
    scene.v += scene.vel * dt;

    // Magnetic pull on the CTA (smoothed here; target set on pointermove).
    const km = 1 - Math.exp(-dt * 10);
    cta.x += (cta.tx - cta.x) * km;
    cta.y += (cta.ty - cta.y) * km;

    // Writes
    scene.el.style.setProperty('--tx', scene.tx.toFixed(4));
    scene.el.style.setProperty('--ty', scene.ty.toFixed(4));
    setGauge(scene.v);
    if (scene.halo) scene.halo.style.opacity = (0.35 + 0.5 * scene.rev).toFixed(3);
    if (cta.el) {
      cta.el.style.translate = Math.abs(cta.x) + Math.abs(cta.y) < 0.02
        ? ''
        : cta.x.toFixed(2) + 'px ' + cta.y.toFixed(2) + 'px';
    }
  }

  // Run only when something is visible and allowed to move.
  function syncLoop() {
    const run = !!scene.el && !mq.reduce.matches && !mq.phone.matches && !document.hidden;
    if (run && !scene.raf) {
      scene.last = performance.now();
      scene.raf = requestAnimationFrame(frame);
    } else if (!run && scene.raf) {
      cancelAnimationFrame(scene.raf);
      scene.raf = 0;
    }
    if (mq.reduce.matches && scene.el) {
      scene.v = REST;
      setGauge(REST);
      if (cta.el) cta.el.style.translate = '';
    }
  }


  /* ==========================================================================
     Pointer + button interactions
     ========================================================================== */
  function updateMagnet() {
    if (!cta.el || mq.reduce.matches || !pointer.live) { cta.tx = 0; cta.ty = 0; return; }
    const r = cta.el.getBoundingClientRect();
    // Remove the current pull so the button's "home" centre is stable.
    const cx = r.left + r.width / 2 - cta.x;
    const cy = r.top + r.height / 2 - cta.y;
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    const near = Math.abs(dx) < r.width / 2 + MAGNET_REACH && Math.abs(dy) < r.height / 2 + MAGNET_REACH;
    cta.tx = near ? clamp(dx * 0.2, -MAGNET_MAX, MAGNET_MAX) : 0;
    cta.ty = near ? clamp(dy * 0.3, -MAGNET_MAX, MAGNET_MAX) : 0;
  }

  function bindPointer() {
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.live = true;
      updateMagnet();
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => {
      pointer.live = false;
      cta.tx = 0;
      cta.ty = 0;
    });
  }

  function ripple(btn, clientX, clientY) {
    if (mq.reduce.matches) return;
    const r = btn.getBoundingClientRect();
    const x = clientX == null ? r.width / 2 : clientX - r.left;
    const y = clientY == null ? r.height / 2 : clientY - r.top;
    const size = Math.hypot(r.width, r.height) * 2;

    const dot = document.createElement('span');
    dot.className = 'btn-ripple';
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    dot.style.width = size + 'px';
    dot.style.height = size + 'px';
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
    btn.appendChild(dot);
  }

  function updateRev() {
    scene.revTarget = cta.hover || cta.focus ? 1 : 0;
  }

  function bindButtons() {
    $$('.btn').forEach((btn) => {
      const isPrimary = btn.classList.contains('btn-primary');
      if (isPrimary && !cta.el) cta.el = btn;

      // Cursor-tracking highlight
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        btn.style.setProperty('--bx', e.clientX - r.left + 'px');
        btn.style.setProperty('--by', e.clientY - r.top + 'px');
      });

      // Ripple from the click point (pointer) or the centre (keyboard)
      btn.addEventListener('pointerdown', (e) => {
        if (e.button === 0) ripple(btn, e.clientX, e.clientY);
      });

      if (isPrimary) {
        btn.addEventListener('pointerenter', () => { cta.hover = true; updateRev(); });
        btn.addEventListener('pointerleave', () => { cta.hover = false; updateRev(); });
        btn.addEventListener('focus', () => { cta.focus = true; updateRev(); });
        btn.addEventListener('blur', () => {
          cta.focus = false;
          btn.classList.remove('is-pressed');
          updateRev();
        });
      }

      // Space activates the link too (anchors only respond to Enter natively).
      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) btn.classList.add('is-pressed');
        }
      });
      btn.addEventListener('keyup', (e) => {
        if (e.key === ' ' && btn.classList.contains('is-pressed')) {
          btn.classList.remove('is-pressed');
          btn.click();
        }
      });

      btn.addEventListener('click', (e) => {
        if (e.detail === 0) ripple(btn);   // keyboard activation → centred ripple
        if (!btn.href) return;

        // Let the browser handle new-tab / download style clicks untouched.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (btn.target && btn.target !== '_self') return;

        if (cta.leaving) { e.preventDefault(); return; }
        if (mq.reduce.matches) return;      // navigate immediately

        e.preventDefault();
        cta.leaving = true;
        root.classList.add('is-leaving');
        setTimeout(() => window.location.assign(btn.href), EXIT_MS);
      });
    });
  }

  function bindLifecycle() {
    document.addEventListener('visibilitychange', syncLoop);
    mq.reduce.addEventListener('change', syncLoop);
    mq.phone.addEventListener('change', syncLoop);

    // Returning via the back button can restore the page from bfcache with the
    // exit animation still applied — reset it.
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      cta.leaving = false;
      cta.hover = false;
      cta.focus = false;
      root.classList.remove('is-leaving');
      updateRev();
      syncLoop();
    });
  }


  /* ==========================================================================
     Init
     ========================================================================== */
  function init() {
    scene.el = $('.scene');
    if (scene.el) {
      scene.arc = $('.scene-sweep', scene.el);
      scene.needle = $('.scene-needle-wrap', scene.el);
      scene.halo = $('.scene-halo-glow', scene.el);
      setGauge(0);               // needle starts at the bottom-left stop
    }

    bindPointer();
    bindButtons();
    bindLifecycle();
    playIntro();
    syncLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
