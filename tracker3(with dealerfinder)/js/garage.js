/* ==========================================================================
   PitStop — Garage (Module 2)
   Renders the vehicle grid and drives the add/edit modal. All persistence
   goes through PitStopStorage (js/storage.js).

   Redesign additions: summary strip, status pill, odometer readout markup,
   and pointer-driven lighting (card tilt + spotlight + ambient glow). The
   lighting only runs for a fine mouse pointer and is skipped entirely when
   the user prefers reduced motion.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('vehicle-grid');
  const emptyState = document.getElementById('empty-state');
  const addVehicleBtn = document.getElementById('add-vehicle-btn');

  const statsStrip = document.getElementById('garage-stats');
  const statVehicles = document.getElementById('stat-vehicles');
  const statDistance = document.getElementById('stat-distance');
  const statAttention = document.getElementById('stat-attention');
  const statAttentionWrap = document.getElementById('stat-attention-wrap');

  const modal = document.getElementById('vehicle-modal');
  const modalTitle = document.getElementById('modal-title');
  const form = document.getElementById('vehicle-form');
  const idField = document.getElementById('vehicle-id');
  const nameField = document.getElementById('vehicle-name');
  const brandField = document.getElementById('vehicle-brand');
  const yearField = document.getElementById('vehicle-year');
  const odoField = document.getElementById('vehicle-odometer');
  const unitToggle = document.querySelector('.unit-toggle');
  const unitButtons = document.querySelectorAll('.unit-btn');

  const photoInput = document.getElementById('photo-input');
  const photoPreview = document.getElementById('photo-preview');
  const photoRemoveBtn = document.getElementById('photo-remove');
  const photoLabelText = document.getElementById('photo-label-text');
  const deleteBtn = document.getElementById('delete-vehicle-btn');

  let currentUnit = 'km';
  let pendingPhoto = null; // base64 string, or null, or 'REMOVE'
  const knownIds = new Set(); // cards already shown once — only new ones play the entrance

  const PLACEHOLDER_PHOTO_HTML = `
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path d="M4 7h3l2-3h6l2 3h3v12H4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="1.6"/>
    </svg>`;

  const VEHICLE_GLYPH_HTML = `
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="8" y="26" width="48" height="22" rx="4" stroke="currentColor" stroke-width="2.5"/>
      <circle cx="20" cy="50" r="5" stroke="currentColor" stroke-width="2.5"/>
      <circle cx="44" cy="50" r="5" stroke="currentColor" stroke-width="2.5"/>
      <path d="M12 26 L18 14 H46 L52 26" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    </svg>`;

  const EDIT_ICON_HTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M13.5 8.5l2 2" stroke="currentColor" stroke-width="1.7"/>
    </svg>`;

  /* ---------------------------------------------------------------------
     Helpers
     --------------------------------------------------------------------- */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Digit tiles for the odometer readout; any non-digit (group separator) becomes a gap.
  function odometerMarkup(text) {
    return Array.from(text)
      .map((ch) => (/\d/.test(ch) ? `<span class="digit">${ch}</span>` : '<span class="sep"></span>'))
      .join('');
  }

  // Worst status across a vehicle's parts. Read-only use of PitStopStorage.
  function summarizeParts(vehicle) {
    const summary = { total: 0, overdue: 0, dueSoon: 0 };
    try {
      PitStopStorage.getParts(vehicle.id).forEach((part) => {
        summary.total += 1;
        const { status } = PitStopStorage.computePartStatus(part, vehicle);
        if (status === 'overdue') summary.overdue += 1;
        else if (status === 'due-soon') summary.dueSoon += 1;
      });
    } catch (err) {
      console.error('PitStop: could not summarize parts', err);
    }
    return summary;
  }

  function statusPill(summary) {
    if (!summary.total) return '';
    if (summary.overdue || summary.dueSoon) {
      const bits = [];
      if (summary.overdue) bits.push(`${summary.overdue} overdue`);
      if (summary.dueSoon) bits.push(`${summary.dueSoon} due soon`);
      const status = summary.overdue ? 'overdue' : 'due-soon';
      return `<span class="vc-status" data-status="${status}">${bits.join(', ')}</span>`;
    }
    return '<span class="vc-status" data-status="ok">All parts on track</span>';
  }

  function updateStats(vehicles, summaries) {
    const totalKm = vehicles.reduce((sum, v) => sum + (Number(v.currentOdometerKm) || 0), 0);
    const overdue = summaries.reduce((sum, s) => sum + s.overdue, 0);
    const dueSoon = summaries.reduce((sum, s) => sum + s.dueSoon, 0);

    statVehicles.textContent = vehicles.length.toLocaleString();
    statDistance.textContent = Math.round(totalKm).toLocaleString();
    statAttention.textContent = (overdue + dueSoon).toLocaleString();
    statAttentionWrap.dataset.tone = overdue ? 'overdue' : dueSoon ? 'due-soon' : 'ok';
  }


  /* ---------------------------------------------------------------------
     Accent colour — dominant hue of the vehicle photo.
     Sampled once, cached on the vehicle as vehicle.accentColor ('#rrggbb',
     or null when the photo has no usable colour). vehicle.html reads the
     same field. Saved through PitStopStorage.updateVehicle, so the storage
     layer itself is untouched.
     --------------------------------------------------------------------- */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return [h < 0 ? h + 360 : h, s, l];
  }

  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function extractAccent(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const size = 48;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          const px = ctx.getImageData(0, 0, size, size).data;

          // 24 hue buckets, weighted by saturation and mid-lightness so
          // grey asphalt, black tyres and white sky don't win.
          const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 200) continue;
            const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
            if (s < 0.22 || l < 0.12 || l > 0.9) continue;
            const w = s * (1 - Math.abs(l - 0.5) * 1.4);
            const bin = bins[Math.floor(h / 15) % 24];
            bin.w += w; bin.r += px[i] * w; bin.g += px[i + 1] * w; bin.b += px[i + 2] * w;
          }
          const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
          if (best.w < 1) { resolve(null); return; } // grey / monochrome photo

          const [h, s] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
          // Pull into a range that glows on the dark UI without going neon or muddy
          resolve(hslToHex(h, Math.min(0.85, Math.max(0.55, s)), 0.58));
        } catch (err) {
          resolve(null);
        }
      };
      img.src = dataUrl;
    });
  }

  function ensureAccent(vehicle, card) {
    if (!vehicle.photo || vehicle.accentColor !== undefined) return;
    extractAccent(vehicle.photo).then((hex) => {
      PitStopStorage.updateVehicle(vehicle.id, { accentColor: hex });
      if (hex && card.isConnected) card.style.setProperty('--tint', hex);
    });
  }

  /* ---------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */
  function render() {
    const vehicles = PitStopStorage.getVehicles();
    const hasVehicles = vehicles.length > 0;

    addVehicleBtn.hidden = !hasVehicles;
    emptyState.hidden = hasVehicles;
    grid.hidden = !hasVehicles;
    statsStrip.hidden = !hasVehicles;
    grid.innerHTML = '';
    activeCard = null;

    const summaries = vehicles.map(summarizeParts);
    if (hasVehicles) updateStats(vehicles, summaries);

    let enterIndex = 0;
    vehicles.forEach((v, idx) => {
      const card = document.createElement('article');
      const isNew = !knownIds.has(v.id);
      card.className = 'vehicle-card'
        + (vehicles.length >= 3 && idx === 0 ? ' is-feature' : '')
        + (isNew ? ' is-new' : '');
      if (isNew) card.style.setProperty('--i', String(enterIndex++));
      knownIds.add(v.id);
      if (v.accentColor && /^#[0-9a-f]{6}$/i.test(v.accentColor)) card.style.setProperty('--tint', v.accentColor);

      const displayOdo = PitStopStorage.fromKm(v.currentOdometerKm, v.odometerUnit);
      const roundedOdo = Math.round(displayOdo).toLocaleString();

      card.innerHTML = `
        <div class="vc-surface">
          <div class="vc-photo${v.photo ? '' : ' is-empty'}">
            ${v.photo ? `<img src="${v.photo}" alt="${escapeHtml(v.name)}">` : VEHICLE_GLYPH_HTML}
            <div class="vc-scrim"></div>
            <div class="vc-over">
              <div class="vc-top">
                ${statusPill(summaries[idx])}
                <button class="vehicle-card-edit" data-edit="${v.id}" aria-label="Edit ${escapeHtml(v.name)}">${EDIT_ICON_HTML}</button>
              </div>
              <div class="vc-bottom">
                <h3 class="vc-name">${escapeHtml(v.name)}</h3>
                <div class="vc-chips">
                  <span class="vc-chip">${escapeHtml(v.brand)}</span>
                  <span class="vc-chip">${escapeHtml(String(v.year))}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="vc-foot">
            <div>
              <span class="odo-label">Odometer</span>
              <div class="odo" role="img" aria-label="${roundedOdo} ${v.odometerUnit}">
                ${odometerMarkup(roundedOdo)}<span class="odo-unit">${v.odometerUnit}</span>
              </div>
            </div>
            <a class="btn btn-primary btn-sm vehicle-card-view-parts" href="vehicle.html?id=${v.id}">View Parts</a>
          </div>
        </div>
      `;
      grid.appendChild(card);
      ensureAccent(v, card);
    });

    grid.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.dataset.edit));
    });
  }

  /* ---------------------------------------------------------------------
     Lighting — card tilt + spotlight, ambient glow, button highlight.
     One delegated listener on the grid, rAF-throttled, so it survives
     every re-render of the cards.
     --------------------------------------------------------------------- */
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const lightsOn = () => finePointer.matches && !reducedMotion.matches;

  const MAX_TILT = 7; // degrees
  const page = document.body;

  let activeCard = null;
  let activeRect = null;
  let lastPointer = null;
  let tiltFrame = 0;

  const ambient = { x: 0, y: 0, tx: 0, ty: 0, frame: 0, ready: false };

  function clamp01(n) { return Math.min(1, Math.max(0, n)); }

  function releaseCard(card) {
    if (!card) return;
    card.classList.remove('is-lit');
    ['--rx', '--ry', '--px', '--py'].forEach((p) => card.style.removeProperty(p));
  }

  function applyTilt() {
    tiltFrame = 0;
    if (!activeCard || !activeCard.isConnected || !activeRect || !lastPointer) return;
    const r = activeRect;
    const px = clamp01((lastPointer.clientX - r.left) / r.width);
    const py = clamp01((lastPointer.clientY - r.top) / r.height);
    const s = activeCard.style;
    s.setProperty('--px', px.toFixed(3));
    s.setProperty('--py', py.toFixed(3));
    s.setProperty('--mx', `${(px * r.width).toFixed(1)}px`);
    s.setProperty('--my', `${(py * r.height).toFixed(1)}px`);
    s.setProperty('--ry', ((px - 0.5) * 2 * MAX_TILT).toFixed(2));
    s.setProperty('--rx', ((0.5 - py) * 2 * MAX_TILT).toFixed(2));
  }

  function ambientStep() {
    const dx = ambient.tx - ambient.x;
    const dy = ambient.ty - ambient.y;
    ambient.x += dx * 0.14;
    ambient.y += dy * 0.14;
    page.style.setProperty('--lx', `${ambient.x.toFixed(1)}px`);
    page.style.setProperty('--ly', `${ambient.y.toFixed(1)}px`);
    ambient.frame = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? requestAnimationFrame(ambientStep) : 0;
  }

  function moveAmbient(e) {
    ambient.tx = e.clientX;
    ambient.ty = e.clientY;
    if (!ambient.ready) {
      ambient.x = e.clientX;
      ambient.y = e.clientY;
      ambient.ready = true;
    }
    if (!ambient.frame) ambient.frame = requestAnimationFrame(ambientStep);
  }

  // Highlight that slides across a button under the cursor
  function moveButtonLight(e) {
    const btn = e.target.closest && e.target.closest('.btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--bx', `${(e.clientX - r.left).toFixed(1)}px`);
    btn.style.setProperty('--by', `${(e.clientY - r.top).toFixed(1)}px`);
  }

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !lightsOn()) return;
    moveAmbient(e);
    moveButtonLight(e);
  });

  grid.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !lightsOn()) return;
    const card = e.target.closest('.vehicle-card');
    if (card !== activeCard) {
      releaseCard(activeCard);
      activeCard = card;
      activeRect = card ? card.getBoundingClientRect() : null; // measured before it tilts
      if (card) card.classList.add('is-lit');
    }
    if (!card) return;
    lastPointer = e;
    if (!tiltFrame) tiltFrame = requestAnimationFrame(applyTilt);
  });

  grid.addEventListener('pointerleave', () => {
    releaseCard(activeCard);
    activeCard = null;
    activeRect = null;
  });

  // Cached card rect goes stale on scroll/resize — drop it so the next move re-measures
  const refreshRect = () => {
    if (activeCard) activeRect = activeCard.getBoundingClientRect();
  };
  window.addEventListener('scroll', refreshRect, { passive: true });
  window.addEventListener('resize', refreshRect);

  /* ---------------------------------------------------------------------
     Modal open / close
     --------------------------------------------------------------------- */
  function openModal(vehicleId) {
    form.reset();
    pendingPhoto = null;
    setPhotoPreview(null);
    setUnit('km');
    deleteBtn.hidden = true;

    if (vehicleId) {
      const v = PitStopStorage.getVehicle(vehicleId);
      if (!v) return;
      modalTitle.textContent = 'Edit Vehicle';
      idField.value = v.id;
      nameField.value = v.name;
      brandField.value = v.brand;
      yearField.value = v.year;
      setUnit(v.odometerUnit);
      odoField.value = Math.round(PitStopStorage.fromKm(v.currentOdometerKm, v.odometerUnit));
      if (v.photo) setPhotoPreview(v.photo);
      deleteBtn.hidden = false;
    } else {
      modalTitle.textContent = 'Add Vehicle';
      idField.value = '';
    }

    modal.hidden = false;
    nameField.focus();
  }

  function closeModal() {
    modal.hidden = true;
  }

  document.getElementById('add-vehicle-btn').addEventListener('click', () => openModal(null));
  document.querySelectorAll('[data-open-form]').forEach((btn) =>
    btn.addEventListener('click', () => openModal(null))
  );
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  /* ---------------------------------------------------------------------
     Odometer unit toggle — converts whatever's typed so switching units
     doesn't silently change the meaning of the number already entered.
     --------------------------------------------------------------------- */
  function setUnit(unit) {
    currentUnit = unit;
    if (unitToggle) unitToggle.dataset.active = unit; // drives the sliding thumb
    unitButtons.forEach((btn) => {
      const active = btn.dataset.unit === unit;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  unitButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const newUnit = btn.dataset.unit;
      if (newUnit === currentUnit) return;
      const raw = parseFloat(odoField.value);
      if (!Number.isNaN(raw)) {
        const km = PitStopStorage.toKm(raw, currentUnit);
        odoField.value = Math.round(PitStopStorage.fromKm(km, newUnit));
      }
      setUnit(newUnit);
    });
  });

  /* ---------------------------------------------------------------------
     Photo upload
     --------------------------------------------------------------------- */
  function setPhotoPreview(dataUrl) {
    if (dataUrl) {
      photoPreview.innerHTML = `<img src="${dataUrl}" alt="">`;
      photoRemoveBtn.hidden = false;
      photoLabelText.textContent = 'Replace photo';
    } else {
      photoPreview.innerHTML = PLACEHOLDER_PHOTO_HTML;
      photoRemoveBtn.hidden = true;
      photoLabelText.textContent = 'Upload photo';
    }
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    try {
      const compressed = await PitStopStorage.compressPhoto(file);
      pendingPhoto = compressed;
      setPhotoPreview(compressed);
    } catch (err) {
      console.error('PitStop: photo processing failed', err);
      alert('Could not process that image. Try a different file.');
    }
  });

  photoRemoveBtn.addEventListener('click', () => {
    pendingPhoto = 'REMOVE';
    photoInput.value = '';
    setPhotoPreview(null);
  });

  /* ---------------------------------------------------------------------
     Save / Delete
     --------------------------------------------------------------------- */
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const data = {
      name: nameField.value.trim(),
      brand: brandField.value.trim(),
      year: Number(yearField.value),
      odometerUnit: currentUnit,
      startingOdometer: Number(odoField.value),
    };

    const existingId = idField.value;

    if (existingId) {
      const patch = {
        name: data.name,
        brand: data.brand,
        year: data.year,
        odometerUnit: data.odometerUnit,
        currentOdometerKm: PitStopStorage.toKm(data.startingOdometer, data.odometerUnit),
      };
      if (pendingPhoto === 'REMOVE') { patch.photo = null; patch.accentColor = undefined; }
      else if (pendingPhoto) { patch.photo = pendingPhoto; patch.accentColor = undefined; } // re-sampled on next render
      PitStopStorage.updateVehicle(existingId, patch);
    } else {
      PitStopStorage.addVehicle({
        ...data,
        photo: pendingPhoto && pendingPhoto !== 'REMOVE' ? pendingPhoto : null,
      });
    }

    closeModal();
    render();
  });

  deleteBtn.addEventListener('click', () => {
    const id = idField.value;
    if (!id) return;
    const v = PitStopStorage.getVehicle(id);
    if (confirm(`Delete "${v.name}"? This can't be undone.`)) {
      PitStopStorage.deleteVehicle(id);
      knownIds.delete(id);
      closeModal();
      render();
    }
  });

  render();
});
