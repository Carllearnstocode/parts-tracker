/* ==========================================================================
   PitStop — Vehicle detail (Module 3)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    document.body.style.setProperty('--lx', `${event.clientX}px`);
    document.body.style.setProperty('--ly', `${event.clientY}px`);
  }, { passive: true });

  const params = new URLSearchParams(window.location.search);
  const vehicleId = params.get('id');
  const vehicle = vehicleId ? PitStopStorage.getVehicle(vehicleId) : null;

  const summaryEl = document.getElementById('vehicle-summary');

  if (!vehicle) {
    summaryEl.innerHTML = `
      <div class="vehicle-summary-info">
        <h1>Vehicle not found</h1>
        <p class="vehicle-summary-meta">It may have been deleted. <a href="garage.html">Back to Garage</a></p>
      </div>`;
    document.getElementById('add-part-btn').hidden = true;
    document.querySelector('.parts-heading').hidden = true;
    return;
  }

  document.title = `${vehicle.name} — PitStop`;

  const PLACEHOLDER_PHOTO_HTML = `
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path d="M4 7h3l2-3h6l2 3h3v12H4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="1.6"/>
    </svg>`;

  const listEl = document.getElementById('parts-list');
  const emptyState = document.getElementById('parts-empty-state');

  const modal = document.getElementById('part-modal');
  const modalTitle = document.getElementById('part-modal-title');
  const form = document.getElementById('part-form');
  const idField = document.getElementById('part-id');
  const nameField = document.getElementById('part-name');
  const purchaseDateField = document.getElementById('part-purchase-date');
  const installDateField = document.getElementById('part-install-date');
  const scheduleButtons = document.querySelectorAll('.schedule-btn');
  const intervalKmRow = document.getElementById('interval-km-row');
  const intervalDaysRow = document.getElementById('interval-days-row');
  const intervalKmField = document.getElementById('part-interval-km');
  const intervalDaysField = document.getElementById('part-interval-days');
  const intervalKmUnit = document.getElementById('interval-km-unit');
  const deletePartBtn = document.getElementById('delete-part-btn');
  const partPhotoInput = document.getElementById('part-photo-input');
  const partPhotoPreview = document.getElementById('part-photo-preview');
  const partPhotoLabel = document.getElementById('part-photo-label');
  const partPhotoRemove = document.getElementById('part-photo-remove');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const maxPartTilt = 4;
  let litPartCard = null;

  function clearLitPartCard() {
    if (!litPartCard) return;
    litPartCard.classList.remove('is-lit');
    ['--rx', '--ry'].forEach((property) => litPartCard.style.removeProperty(property));
    const photo = litPartCard.querySelector('.part-card-photo');
    if (photo) ['--light-x', '--light-y'].forEach((property) => photo.style.removeProperty(property));
    litPartCard = null;
  }

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || reducedMotion.matches) {
      clearLitPartCard();
      return;
    }

    const card = event.target instanceof Element ? event.target.closest('.part-card') : null;
    if (card !== litPartCard) {
      clearLitPartCard();
      litPartCard = card;
      if (litPartCard) litPartCard.classList.add('is-lit');
    }
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    card.style.setProperty('--ry', ((px - 0.5) * 2 * maxPartTilt).toFixed(2));
    card.style.setProperty('--rx', ((0.5 - py) * 2 * maxPartTilt).toFixed(2));

    const photo = card.querySelector('.part-card-photo');
    const photoRect = photo.getBoundingClientRect();
    photo.style.setProperty('--light-x', `${(event.clientX - photoRect.left).toFixed(1)}px`);
    photo.style.setProperty('--light-y', `${(event.clientY - photoRect.top).toFixed(1)}px`);
  }, true);

  listEl.addEventListener('pointerleave', clearLitPartCard);
  window.addEventListener('blur', clearLitPartCard);

  let currentSchedule = 'distance';
  let pendingPartPhoto = null;

  function setPartPhotoPreview(photo) {
    partPhotoPreview.innerHTML = photo ? `<img src="${photo}" alt="">` : PLACEHOLDER_PHOTO_HTML;
    partPhotoLabel.textContent = photo ? 'Replace photo' : 'Upload photo';
    partPhotoRemove.hidden = !photo;
  }

  /* ---------------------------------------------------------------------
     Render vehicle summary
     --------------------------------------------------------------------- */
  function renderSummary() {
    const displayOdo = Math.round(PitStopStorage.fromKm(vehicle.currentOdometerKm, vehicle.odometerUnit)).toLocaleString();
    const vehicles = PitStopStorage.getVehicles();
    const bayNumber = String(Math.max(0, vehicles.findIndex((item) => item.id === vehicle.id)) + 1).padStart(2, '0');
    const parts = PitStopStorage.getParts(vehicle.id);
    const nextService = parts.find((part) => {
      const result = PitStopStorage.computePartStatus(part, vehicle);
      return result.status !== 'ok';
    });

    summaryEl.innerHTML = `
      <div class="vehicle-bay-tag">BAY #${bayNumber}</div>
      <div class="vehicle-summary-photo${vehicle.cutoutPhoto ? ' is-cutout' : ''}" id="vehicle-summary-photo">
        ${vehicle.cutoutPhoto || vehicle.photo ? `<img src="${vehicle.cutoutPhoto || vehicle.photo}" alt="">` : PLACEHOLDER_PHOTO_HTML}
        ${vehicle.photo ? `<button type="button" class="vehicle-background-button" id="vehicle-background-button"></button>` : ''}
      </div>
      <div class="vehicle-summary-info">
        <p class="vehicle-bay-spec-label">STALLED VEHICLE / ACTIVE BAY</p>
        <h1>${escapeHtml(vehicle.name)}</h1>
        <p class="vehicle-summary-meta">${escapeHtml(vehicle.brand)} &middot; ${escapeHtml(String(vehicle.year))}</p>
        <div class="vehicle-status-pills">
          <span class="vehicle-status-pill">Active Bay</span>
          <span class="vehicle-status-pill">${parts.length} ${parts.length === 1 ? 'Part' : 'Parts'} Tracked</span>
          ${nextService ? '<span class="vehicle-status-pill vehicle-status-pill--attention">Service Due</span>' : ''}
        </div>
      </div>
      <div class="vehicle-summary-odo">
        <div class="odo-label">Odometer</div>
        <div class="odo-value mono">${displayOdo}</div>
        <div class="odo-unit">${vehicle.odometerUnit === 'mi' ? 'MILES' : 'KILOMETERS'}</div>
      </div>
    `;

    const photoWrap = document.getElementById('vehicle-summary-photo');
    const backgroundButton = document.getElementById('vehicle-background-button');
    if (backgroundButton) {
      backgroundButton.textContent = vehicle.cutoutPhoto ? 'Restore photo' : 'Remove background';
      backgroundButton.addEventListener('click', () => {
        if (vehicle.cutoutPhoto) {
          vehicle.cutoutPhoto = null;
          PitStopStorage.updateVehicle(vehicle.id, { cutoutPhoto: null });
          renderSummary();
          attachVehicleAccent();
          return;
        }

        backgroundButton.disabled = true;
        backgroundButton.textContent = 'Removing…';
        createVehicleCutout(vehicle.photo).then((cutout) => {
          if (!cutout) {
            backgroundButton.disabled = false;
            backgroundButton.textContent = 'Remove background';
            return;
          }
          vehicle.cutoutPhoto = cutout;
          PitStopStorage.updateVehicle(vehicle.id, { cutoutPhoto: cutout });
          renderSummary();
        });
      });
    }

    if (photoWrap && vehicle.cutoutPhoto) photoWrap.classList.add('is-cutout');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const STATUS_LABEL = { ok: 'OK', 'due-soon': 'Due Soon', overdue: 'Overdue' };

  function scheduleSummary(part) {
    const unit = vehicle.odometerUnit;
    const kmPart = part.intervalKm
      ? `every ${Math.round(PitStopStorage.fromKm(part.intervalKm, unit)).toLocaleString()} ${unit}`
      : null;
    const dayPart = part.intervalDays ? `every ${part.intervalDays} days` : null;
    if (part.scheduleType === 'distance') return kmPart;
    if (part.scheduleType === 'time') return dayPart;
    return [kmPart, dayPart].filter(Boolean).join(' or ');
  }

  function remainingSummary(part, result) {
    const unit = vehicle.odometerUnit;
    const bits = [];
    if (result.kmRemaining !== null) {
      const displayRemaining = Math.round(PitStopStorage.fromKm(result.kmRemaining, unit));
      bits.push(displayRemaining >= 0
        ? `${displayRemaining.toLocaleString()} ${unit} left`
        : `${Math.abs(displayRemaining).toLocaleString()} ${unit} overdue`);
    }
    if (result.daysRemaining !== null) {
      bits.push(result.daysRemaining >= 0
        ? `${result.daysRemaining} days left`
        : `${Math.abs(result.daysRemaining)} days overdue`);
    }
    return bits.join(' &middot; ');
  }

  /* ---------------------------------------------------------------------
     Render parts list
     --------------------------------------------------------------------- */
  function renderParts() {
    const parts = PitStopStorage.getParts(vehicle.id);
    emptyState.hidden = parts.length > 0;
    listEl.hidden = parts.length === 0;
    listEl.innerHTML = '';

    const scored = parts.map((p) => ({ part: p, result: PitStopStorage.computePartStatus(p, vehicle) }));
    scored.sort((a, b) => b.result.percent - a.result.percent);

    function getProgressColor(percent) {
      const stops = [
        [0.00, [60, 200, 110]],
        [0.28, [121, 207, 99]],
        [0.48, [176, 211, 79]],
        [0.64, [225, 203, 67]],
        [0.82, [237, 162, 74]],
        [1.00, [232, 93, 87]],
      ];
      const value = Math.min(1, Math.max(0, percent));

      for (let i = 1; i < stops.length; i++) {
        if (value <= stops[i][0]) {
          const [startPosition, startRgb] = stops[i - 1];
          const [endPosition, endRgb] = stops[i];
          const ratio = (value - startPosition) / (endPosition - startPosition);
          const rgb = startRgb.map((channel, index) =>
            Math.round(channel + ((endRgb[index] - channel) * ratio))
          );
          return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        }
      }

      return 'rgb(232, 93, 87)';
    }

    scored.forEach(({ part, result }) => {
      const card = document.createElement('article');
      card.className = 'part-card';
      card.id = `part-${part.id}`;
      card.tabIndex = -1;
      const normalizedPercent = Math.min(Math.max(result.percent, 0), 1);
      const widthPct = normalizedPercent * 100;
      const progressColor = getProgressColor(normalizedPercent);
      card.innerHTML = `
        <div class="part-card-photo">
          ${part.photo ? `<img src="${part.photo}" alt="">` : `<div class="part-photo-placeholder">${PLACEHOLDER_PHOTO_HTML}</div>`}
          <button type="button" class="part-edit-btn" data-edit-part="${part.id}" aria-label="Edit ${escapeHtml(part.name)}" title="Edit ${escapeHtml(part.name)}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M13.5 8.5l2 2" stroke="currentColor" stroke-width="1.7"/>
            </svg>
          </button>
        </div>
        <div class="part-card-body">
          <div class="part-card-title">
            <h3>${escapeHtml(part.name)}</h3>
            <span class="status-badge status-${result.status}">${STATUS_LABEL[result.status]}</span>
          </div>
          <div class="part-progress-track">
            <div class="part-progress-fill status-${result.status}" style="width:${widthPct}%;--progress-color:${progressColor}"></div>
          </div>
          <div class="part-remaining">${remainingSummary(part, result)}</div>
          <div class="part-card-dates">
            Installed ${formatDate(part.installDate)} &middot; ${escapeHtml(scheduleSummary(part) || 'no interval set')}
          </div>
        </div>
      `;
      listEl.appendChild(card);
    });

    listEl.querySelectorAll('[data-edit-part]').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.dataset.editPart));
    });
  }

  /* ---------------------------------------------------------------------
     Modal open / close
     --------------------------------------------------------------------- */
  function setSchedule(type) {
    currentSchedule = type;
    scheduleButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.schedule === type));
    intervalKmRow.hidden = type === 'time';
    intervalDaysRow.hidden = type === 'distance';
  }

  scheduleButtons.forEach((btn) => {
    btn.addEventListener('click', () => setSchedule(btn.dataset.schedule));
  });

  function openModal(partId) {
    form.reset();
    pendingPartPhoto = null;
    setPartPhotoPreview(null);
    intervalKmUnit.textContent = vehicle.odometerUnit;
    setSchedule('distance');
    deletePartBtn.hidden = true;
    installDateField.value = new Date().toISOString().slice(0, 10);

    if (partId) {
      const p = PitStopStorage.getPart(partId);
      if (!p) return;
      modalTitle.textContent = 'Edit Part';
      idField.value = p.id;
      nameField.value = p.name;
      purchaseDateField.value = p.purchaseDate || '';
      installDateField.value = p.installDate || '';
      pendingPartPhoto = p.photo || null;
      setPartPhotoPreview(pendingPartPhoto);
      setSchedule(p.scheduleType);
      if (p.intervalKm) intervalKmField.value = Math.round(PitStopStorage.fromKm(p.intervalKm, vehicle.odometerUnit));
      if (p.intervalDays) intervalDaysField.value = p.intervalDays;
      deletePartBtn.hidden = false;
    } else {
      modalTitle.textContent = 'Add Part';
      idField.value = '';
    }

    modal.hidden = false;
    nameField.focus();
  }

  function closeModal() { modal.hidden = true; }

  document.getElementById('add-part-btn').addEventListener('click', () => openModal(null));
  document.querySelectorAll('[data-open-part-form]').forEach((btn) =>
    btn.addEventListener('click', () => openModal(null))
  );
  document.getElementById('part-modal-close').addEventListener('click', closeModal);
  document.getElementById('part-cancel-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  partPhotoInput.addEventListener('change', async () => {
    const file = partPhotoInput.files[0];
    if (!file) return;
    try {
      pendingPartPhoto = await PitStopStorage.compressPhoto(file);
      setPartPhotoPreview(pendingPartPhoto);
    } catch (err) {
      console.error('PitStop: part photo processing failed', err);
      alert('Could not process that image. Try a different file.');
    }
  });

  partPhotoRemove.addEventListener('click', () => {
    pendingPartPhoto = null;
    partPhotoInput.value = '';
    setPartPhotoPreview(null);
  });

  /* ---------------------------------------------------------------------
     Save / Delete
     --------------------------------------------------------------------- */
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const intervalKm = intervalKmField.value ? PitStopStorage.toKm(Number(intervalKmField.value), vehicle.odometerUnit) : null;
    const intervalDays = intervalDaysField.value ? Number(intervalDaysField.value) : null;
    const installDate = installDateField.value;

    const data = {
      vehicleId: vehicle.id,
      name: nameField.value.trim(),
      purchaseDate: purchaseDateField.value || null,
      installDate,
      scheduleType: currentSchedule,
      photo: pendingPartPhoto,
      intervalKm: currentSchedule === 'time' ? null : intervalKm,
      intervalDays: currentSchedule === 'distance' ? null : intervalDays,
      baselineDate: installDate,
      baselineOdometerKm: vehicle.currentOdometerKm,
    };

    const existingId = idField.value;
    if (existingId) {
      const existing = PitStopStorage.getPart(existingId);
      PitStopStorage.updatePart(existingId, { ...data, baselineOdometerKm: existing.baselineOdometerKm });
    } else {
      PitStopStorage.addPart(data);
    }

    PitStopStorage.maybeRequestNotificationPermission();
    closeModal();
    renderParts();
    PitStopStorage.sendOverdueNotifications(true);
  });

  deletePartBtn.addEventListener('click', () => {
    const id = idField.value;
    if (!id) return;
    if (confirm('Delete this part? This can\u2019t be undone.')) {
      PitStopStorage.deletePart(id);
      closeModal();
      renderParts();
      PitStopStorage.sendOverdueNotifications(true);
    }
  });

  function attachVehicleAccent() {
    const root = document.querySelector('.vehicle-summary');
    if (!root) return;

    const fallback = '#4fd1e8';
    const setAccent = (color) => {
      root.style.setProperty('--vehicle-accent', color);
      root.style.setProperty('--vehicle-glow', `color-mix(in srgb, ${color} 38%, transparent)`);
      root.style.setProperty('--light-soft', `color-mix(in srgb, ${color} 18%, transparent)`);
      root.style.setProperty('--light-mid', `color-mix(in srgb, ${color} 28%, transparent)`);
      root.style.setProperty('--light-hard', `color-mix(in srgb, ${color} 46%, transparent)`);
    };

    if (vehicle.accentColor) {
      setAccent(vehicle.accentColor);
    } else if (vehicle.photo) {
      PitStopStorage.getVehicleAccentColor(vehicle, fallback).then((color) => setAccent(color)).catch(() => setAccent(fallback));
    } else {
      setAccent(fallback);
    }
  }

  renderSummary();
  attachVehicleAccent();
  renderParts();

  if (window.location.hash) {
    const targetPart = document.getElementById(window.location.hash.slice(1));
    if (targetPart && targetPart.classList.contains('part-card')) {
      targetPart.classList.add('is-notification-target');
      targetPart.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
      targetPart.focus({ preventScroll: true });
      window.setTimeout(() => targetPart.classList.remove('is-notification-target'), 5000);
    }
  }

  function setupOverdueNotifications() {
    const button = document.getElementById('notification-enable-btn');
    if (!button) return;

    const permission = PitStopStorage.getNotificationPermissionState();

    if (permission === 'unsupported') {
      button.hidden = true;
    } else if (permission === 'granted') {
      button.textContent = 'Alerts enabled';
      button.disabled = true;
    } else if (permission === 'denied') {
      button.textContent = 'Alerts blocked';
      button.disabled = true;
    } else {
      button.textContent = 'Enable maintenance alerts';
    }

    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Requesting permission…';
      const result = await PitStopStorage.requestNotificationPermission();

      if (result === 'granted') {
        button.textContent = 'Alerts enabled';
        PitStopStorage.sendOverdueNotifications(true);
      } else if (result === 'denied') {
        button.textContent = 'Alerts blocked';
      } else {
        button.textContent = 'Enable maintenance alerts';
        button.disabled = false;
      }
    });
  }

  setupOverdueNotifications();

  /* =======================================================================
     Trip Tracker (Module 4)
     ======================================================================= */

  const gpsSupportNote = document.getElementById('gps-support-note');
  const gpsToggleBtn = document.getElementById('gps-toggle-btn');
  const gpsStatusBadge = document.getElementById('gps-status-badge');
  const gpsCardStatus = document.getElementById('gps-card-status');
  const gpsLiveReadout = document.getElementById('gps-live-readout');
  const gpsTripModal = document.getElementById('gps-trip-modal');
  const manualTripModal = document.getElementById('manual-trip-modal');
  const openGpsModalBtn = document.getElementById('open-gps-modal');
  const openManualModalBtn = document.getElementById('open-manual-modal');

  const manualForm = document.getElementById('manual-trip-form');
  const manualDistanceField = document.getElementById('manual-trip-distance');
  const manualDateField = document.getElementById('manual-trip-date');
  const manualDestinationField = document.getElementById('manual-trip-destination');
  const manualUnitLabel = document.getElementById('manual-trip-unit');

  const tripConfirm = document.getElementById('trip-confirm');
  const tripConfirmDistance = document.getElementById('trip-confirm-distance');
  const tripConfirmDestination = document.getElementById('trip-confirm-destination');
  const tripConfirmUnit = document.getElementById('trip-confirm-unit');
  const tripConfirmBtn = document.getElementById('trip-confirm-btn');
  const tripDiscardBtn = document.getElementById('trip-discard-btn');

  const tripLogEl = document.getElementById('trip-log');
  const tripLogToggle = document.getElementById('trip-log-toggle');
  let tripLogCollapsed = true;

  const overdueToast = document.getElementById('overdue-toast');
  const overdueToastTitle = document.getElementById('overdue-toast-title');
  const overdueToastBody = document.getElementById('overdue-toast-body');
  const overdueToastClose = document.getElementById('overdue-toast-close');
  let overdueToastTimer = null;

  function showOverdueToast(detail) {
    if (!overdueToast) return;
    overdueToastTitle.textContent = detail.title;
    overdueToastBody.textContent = detail.body;
    overdueToast.dataset.tone = detail.hasOverdue ? 'overdue' : 'due-soon';
    overdueToast.hidden = false;
    window.clearTimeout(overdueToastTimer);
    overdueToastTimer = window.setTimeout(() => {
      overdueToast.hidden = true;
    }, 8000);
  }

  if (overdueToastClose) {
    overdueToastClose.addEventListener('click', () => {
      window.clearTimeout(overdueToastTimer);
      overdueToast.hidden = true;
    });
  }

  document.addEventListener('pitstop:overdue', (event) => showOverdueToast(event.detail));

  function closeTripModal(modal, returnFocusTo) {
    modal.hidden = true;
    returnFocusTo.focus();
  }

  openGpsModalBtn.addEventListener('click', () => {
    gpsTripModal.hidden = false;
    gpsToggleBtn.focus();
  });
  openManualModalBtn.addEventListener('click', () => {
    if (!manualDateField.value) manualDateField.value = new Date().toISOString().slice(0, 10);
    manualTripModal.hidden = false;
    manualDistanceField.focus();
  });

  document.getElementById('gps-trip-close').addEventListener('click', () => closeTripModal(gpsTripModal, openGpsModalBtn));
  document.getElementById('manual-trip-close').addEventListener('click', () => closeTripModal(manualTripModal, openManualModalBtn));
  [gpsTripModal, manualTripModal].forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeTripModal(overlay, overlay === gpsTripModal ? openGpsModalBtn : openManualModalBtn);
      }
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!manualTripModal.hidden) closeTripModal(manualTripModal, openManualModalBtn);
    else if (!gpsTripModal.hidden) closeTripModal(gpsTripModal, openGpsModalBtn);
  });

  function setTripLogExpanded(expanded) {
    tripLogCollapsed = !expanded;
    tripLogEl.hidden = !expanded;
    tripLogToggle.setAttribute('aria-expanded', String(expanded));
    tripLogToggle.textContent = expanded ? 'Hide trip history' : 'Show trip history';
  }

  tripLogToggle.addEventListener('click', () => {
    setTripLogExpanded(tripLogCollapsed);
  });

  setTripLogExpanded(false);

  function refreshAfterOdometerChange() {
    const fresh = PitStopStorage.getVehicle(vehicle.id);
    if (fresh) Object.assign(vehicle, fresh);
    renderSummary();
    renderParts();
    renderTripLog();
    PitStopStorage.sendOverdueNotifications(true);
  }

  function renderTripLog() {
    const trips = PitStopStorage.getTrips(vehicle.id);
    const hasTrips = trips.length > 0;
    tripLogToggle.hidden = !hasTrips;
    tripLogEl.hidden = !hasTrips || tripLogCollapsed;
    tripLogToggle.textContent = tripLogCollapsed ? 'Show trip history' : 'Hide trip history';
    tripLogToggle.setAttribute('aria-expanded', String(!tripLogCollapsed));
    tripLogEl.innerHTML = trips.slice(0, 8).map((t) => {
      const displayDist = Math.round(PitStopStorage.fromKm(t.distanceKm, vehicle.odometerUnit) * 10) / 10;
      const destination = t.destination ? escapeHtml(t.destination) : '—';
      return `
        <div class="trip-log-row">
          <span class="trip-log-date">${formatDate(t.date)}</span>
          <span class="trip-log-destination" title="${destination === '—' ? 'No destination saved' : destination}">${destination}</span>
          <span class="trip-log-distance">${displayDist} ${vehicle.odometerUnit}</span>
          <span class="trip-log-source">${t.source}</span>
          <button class="trip-log-delete" data-delete-trip="${t.id}">Remove</button>
        </div>`;
    }).join('');

    tripLogEl.querySelectorAll('[data-delete-trip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (confirm('Remove this trip? Its distance will be subtracted from the odometer.')) {
          PitStopStorage.deleteTrip(btn.dataset.deleteTrip);
          refreshAfterOdometerChange();
        }
      });
    });
  }

  const EARTH_RADIUS_KM = 6371;
  function haversineKm(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
  }

  let watchId = null;
  let lastPoint = null;
  let accumulatedKm = 0;
  let isTracking = false;

  const MIN_MOVE_KM = 0.005;
  const MAX_ACCURACY_M = 50;

  function updateLiveReadout() {
    const display = PitStopStorage.fromKm(accumulatedKm, vehicle.odometerUnit);
    gpsLiveReadout.textContent = display.toFixed(2);
  }

  function onPosition(pos) {
    if (pos.coords.accuracy != null && pos.coords.accuracy > MAX_ACCURACY_M) return;
    const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (lastPoint) {
      const segment = haversineKm(lastPoint, point);
      if (segment >= MIN_MOVE_KM) {
        accumulatedKm += segment;
        lastPoint = point;
        updateLiveReadout();
      }
    } else {
      lastPoint = point;
    }
  }

  function onPositionError(err) {
    console.error('PitStop: geolocation error', err);
    alert('Could not access GPS: ' + err.message);
    stopTracking(false);
  }

  function startTracking() {
    lastPoint = null;
    accumulatedKm = 0;
    isTracking = true;
    gpsLiveReadout.hidden = false;
    gpsLiveReadout.setAttribute('data-unit', vehicle.odometerUnit);
    updateLiveReadout();
    gpsStatusBadge.textContent = 'Tracking';
    gpsStatusBadge.classList.add('is-tracking');
    gpsCardStatus.textContent = 'Tracking';
    gpsCardStatus.classList.add('is-tracking');
    openGpsModalBtn.textContent = 'View GPS Trip';
    gpsToggleBtn.textContent = 'Stop GPS Trip';
    tripConfirm.hidden = true;
    tripConfirmDestination.value = '';

    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  }

  function stopTracking(showConfirm = true) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    isTracking = false;
    gpsStatusBadge.textContent = 'Idle';
    gpsStatusBadge.classList.remove('is-tracking');
    gpsCardStatus.textContent = 'Idle';
    gpsCardStatus.classList.remove('is-tracking');
    openGpsModalBtn.textContent = 'Open GPS Trip';
    gpsToggleBtn.textContent = 'Start GPS Trip';

    if (showConfirm && accumulatedKm > 0) {
      const display = PitStopStorage.fromKm(accumulatedKm, vehicle.odometerUnit);
      tripConfirmDistance.value = display.toFixed(2);
      tripConfirm.hidden = false;
    }
  }

  if (!('geolocation' in navigator)) {
    gpsSupportNote.hidden = false;
    gpsToggleBtn.disabled = true;
    gpsToggleBtn.textContent = 'GPS Unavailable';
  } else {
    gpsToggleBtn.addEventListener('click', () => {
      if (isTracking) stopTracking(true);
      else startTracking();
    });
  }

  tripConfirmBtn.addEventListener('click', () => {
    const distanceInVehicleUnit = parseFloat(tripConfirmDistance.value);
    if (!distanceInVehicleUnit || distanceInVehicleUnit <= 0) return;
    PitStopStorage.addTrip({
      vehicleId: vehicle.id,
      distanceKm: PitStopStorage.toKm(distanceInVehicleUnit, vehicle.odometerUnit),
      date: new Date().toISOString().slice(0, 10),
      source: 'gps',
      destination: tripConfirmDestination.value.trim(),
    });
    tripConfirm.hidden = true;
    tripConfirmDestination.value = '';
    gpsLiveReadout.hidden = true;
    refreshAfterOdometerChange();
    closeTripModal(gpsTripModal, openGpsModalBtn);
  });

  tripDiscardBtn.addEventListener('click', () => {
    tripConfirm.hidden = true;
    tripConfirmDestination.value = '';
    gpsLiveReadout.hidden = true;
    accumulatedKm = 0;
    closeTripModal(gpsTripModal, openGpsModalBtn);
  });

  manualForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const distance = parseFloat(manualDistanceField.value);
    if (!distance || distance <= 0) return;
    PitStopStorage.addTrip({
      vehicleId: vehicle.id,
      distanceKm: PitStopStorage.toKm(distance, vehicle.odometerUnit),
      date: manualDateField.value || new Date().toISOString().slice(0, 10),
      source: 'manual',
      destination: manualDestinationField.value.trim(),
    });
    manualForm.reset();
    manualDateField.value = new Date().toISOString().slice(0, 10);
    refreshAfterOdometerChange();
    closeTripModal(manualTripModal, openManualModalBtn);
  });

  renderTripLog();

  function createVehicleCutout(dataUrl) {
    return new Promise((resolve) => {
      if (!dataUrl) {
        resolve(null);
        return;
      }

      const image = new Image();
      image.onload = () => {
        try {
          const maxDimension = 700;
          const scale = Math.min(maxDimension / Math.max(image.width, 1), maxDimension / Math.max(image.height, 1), 1);
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.drawImage(image, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          const pixels = imageData.data;
          const samplePoints = [
            [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
            [Math.floor(width / 2), 0], [0, Math.floor(height / 2)],
            [width - 1, Math.floor(height / 2)], [Math.floor(width / 2), height - 1]
          ];
          const background = samplePoints.reduce((sum, [x, y]) => {
            const i = (y * width + x) * 4;
            return [sum[0] + pixels[i], sum[1] + pixels[i + 1], sum[2] + pixels[i + 2]];
          }, [0, 0, 0]).map((value) => value / samplePoints.length);

          const threshold = 58;
          const visited = new Uint8Array(width * height);
          const queue = new Uint32Array(width * height);
          let queueLength = 0;

          function matchesBackground(index) {
            const i = index * 4;
            return Math.sqrt(
              ((pixels[i] - background[0]) ** 2) +
              ((pixels[i + 1] - background[1]) ** 2) +
              ((pixels[i + 2] - background[2]) ** 2)
            ) < threshold;
          }

          function enqueue(index) {
            if (visited[index]) return;
            visited[index] = 1;
            queue[queueLength++] = index;
          }

          for (let x = 0; x < width; x++) {
            enqueue(x);
            enqueue((height - 1) * width + x);
          }
          for (let y = 0; y < height; y++) {
            enqueue(y * width);
            enqueue(y * width + width - 1);
          }

          for (let head = 0; head < queueLength; head++) {
            const index = queue[head];
            if (!matchesBackground(index)) continue;
            pixels[index * 4 + 3] = 0;

            const x = index % width;
            const y = Math.floor(index / width);
            if (x > 0) enqueue(index - 1);
            if (x < width - 1) enqueue(index + 1);
            if (y > 0) enqueue(index - width);
            if (y < height - 1) enqueue(index + width);
          }

          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }
});