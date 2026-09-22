/* ==========================================================================
   PitStop — Vehicle detail (Module 3)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
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

  let currentSchedule = 'distance';

  /* ---------------------------------------------------------------------
     Render vehicle summary
     --------------------------------------------------------------------- */
  function renderSummary() {
    const displayOdo = Math.round(PitStopStorage.fromKm(vehicle.currentOdometerKm, vehicle.odometerUnit)).toLocaleString();
    summaryEl.innerHTML = `
      <div class="vehicle-summary-photo">
        ${vehicle.photo ? `<img src="${vehicle.photo}" alt="">` : PLACEHOLDER_PHOTO_HTML}
      </div>
      <div class="vehicle-summary-info">
        <h1>${escapeHtml(vehicle.name)}</h1>
        <p class="vehicle-summary-meta">${escapeHtml(vehicle.brand)} &middot; ${escapeHtml(String(vehicle.year))}</p>
      </div>
      <div class="vehicle-summary-odo">
        <div class="odo-value mono">${displayOdo}</div>
        <div class="odo-label">${vehicle.odometerUnit === 'mi' ? 'miles' : 'kilometers'}</div>
      </div>
    `;
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

    // Due/overdue first, so the parts that need attention surface to the top
    const scored = parts.map((p) => ({ part: p, result: PitStopStorage.computePartStatus(p, vehicle) }));
    scored.sort((a, b) => b.result.percent - a.result.percent);

    scored.forEach(({ part, result }) => {
      const card = document.createElement('article');
      card.className = 'part-card';
      const widthPct = Math.min(result.percent * 100, 100);
      card.innerHTML = `
        <div class="part-card-main">
          <div class="part-card-title">
            <h3>${escapeHtml(part.name)}</h3>
            <span class="status-badge status-${result.status}">${STATUS_LABEL[result.status]}</span>
          </div>
          <div class="part-card-dates">
            Installed ${formatDate(part.installDate)} &middot; ${escapeHtml(scheduleSummary(part) || 'no interval set')}
          </div>
          <div class="part-progress-track">
            <div class="part-progress-fill status-${result.status}" style="width:${widthPct}%"></div>
          </div>
          <div class="part-remaining">${remainingSummary(part, result)}</div>
        </div>
        <div class="part-card-actions">
          <button class="part-edit-btn" data-edit-part="${part.id}">Edit</button>
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
      intervalKm: currentSchedule === 'time' ? null : intervalKm,
      intervalDays: currentSchedule === 'distance' ? null : intervalDays,
      baselineDate: installDate,
      // Baseline odometer = the vehicle's current reading, since a part
      // being added now is assumed installed at (or near) today's reading.
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
  });

  deletePartBtn.addEventListener('click', () => {
    const id = idField.value;
    if (!id) return;
    if (confirm('Delete this part? This can\u2019t be undone.')) {
      PitStopStorage.deletePart(id);
      closeModal();
      renderParts();
    }
  });

  renderSummary();
  renderParts();

  /* =======================================================================
     Trip Tracker (Module 4)
     ======================================================================= */

  const gpsSupportNote = document.getElementById('gps-support-note');
  const gpsToggleBtn = document.getElementById('gps-toggle-btn');
  const gpsStatusBadge = document.getElementById('gps-status-badge');
  const gpsLiveReadout = document.getElementById('gps-live-readout');

  const manualForm = document.getElementById('manual-trip-form');
  const manualDistanceField = document.getElementById('manual-trip-distance');
  const manualDateField = document.getElementById('manual-trip-date');
  const manualUnitLabel = document.getElementById('manual-trip-unit');

  const tripConfirm = document.getElementById('trip-confirm');
  const tripConfirmDistance = document.getElementById('trip-confirm-distance');
  const tripConfirmUnit = document.getElementById('trip-confirm-unit');
  const tripConfirmBtn = document.getElementById('trip-confirm-btn');
  const tripDiscardBtn = document.getElementById('trip-discard-btn');

  const tripLogEl = document.getElementById('trip-log');

  manualUnitLabel.textContent = vehicle.odometerUnit;
  tripConfirmUnit.textContent = vehicle.odometerUnit;
  manualDateField.value = new Date().toISOString().slice(0, 10);

  /* ---- Refresh vehicle + dependent UI after the odometer changes ---- */
  function refreshAfterOdometerChange() {
    const fresh = PitStopStorage.getVehicle(vehicle.id);
    if (fresh) Object.assign(vehicle, fresh);
    renderSummary();
    renderParts();
    renderTripLog();
  }

  /* ---- Trip log ---- */
  function renderTripLog() {
    const trips = PitStopStorage.getTrips(vehicle.id);
    tripLogEl.innerHTML = trips.slice(0, 8).map((t) => {
      const displayDist = Math.round(PitStopStorage.fromKm(t.distanceKm, vehicle.odometerUnit) * 10) / 10;
      return `
        <div class="trip-log-row">
          <span class="trip-log-date">${formatDate(t.date)}</span>
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

  /* ---- GPS tracking ----
     Foreground-only: relies on the tab staying open while a trip runs.
     Points are filtered for accuracy and minimum movement so GPS jitter
     doesn't silently inflate the distance while the vehicle is stationary. */
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

  const MIN_MOVE_KM = 0.005; // ~5m — filters GPS jitter while stationary
  const MAX_ACCURACY_M = 50; // ignore low-confidence fixes

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
    gpsToggleBtn.textContent = 'Stop GPS Trip';
    tripConfirm.hidden = true;

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
    });
    tripConfirm.hidden = true;
    gpsLiveReadout.hidden = true;
    refreshAfterOdometerChange();
  });

  tripDiscardBtn.addEventListener('click', () => {
    tripConfirm.hidden = true;
    gpsLiveReadout.hidden = true;
    accumulatedKm = 0;
  });

  /* ---- Manual entry ---- */
  manualForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const distance = parseFloat(manualDistanceField.value);
    if (!distance || distance <= 0) return;
    PitStopStorage.addTrip({
      vehicleId: vehicle.id,
      distanceKm: PitStopStorage.toKm(distance, vehicle.odometerUnit),
      date: manualDateField.value || new Date().toISOString().slice(0, 10),
      source: 'manual',
    });
    manualForm.reset();
    manualDateField.value = new Date().toISOString().slice(0, 10);
    refreshAfterOdometerChange();
  });

  renderTripLog();
});
