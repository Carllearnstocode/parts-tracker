/* ==========================================================================
   PitStop — Garage (Module 2)
   Renders the vehicle grid and drives the add/edit modal. All persistence
   goes through PitStopStorage (js/storage.js).
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('vehicle-grid');
  const emptyState = document.getElementById('empty-state');
  const addVehicleBtn = document.getElementById('add-vehicle-btn');

  const modal = document.getElementById('vehicle-modal');
  const modalTitle = document.getElementById('modal-title');
  const form = document.getElementById('vehicle-form');
  const idField = document.getElementById('vehicle-id');
  const nameField = document.getElementById('vehicle-name');
  const brandField = document.getElementById('vehicle-brand');
  const yearField = document.getElementById('vehicle-year');
  const odoField = document.getElementById('vehicle-odometer');
  const unitButtons = document.querySelectorAll('.unit-btn');

  const photoInput = document.getElementById('photo-input');
  const photoPreview = document.getElementById('photo-preview');
  const photoRemoveBtn = document.getElementById('photo-remove');
  const photoLabelText = document.getElementById('photo-label-text');
  const deleteBtn = document.getElementById('delete-vehicle-btn');

  let currentUnit = 'km';
  let pendingPhoto = null; // base64 string, or null, or 'REMOVE'
  const PLACEHOLDER_PHOTO_HTML = `
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path d="M4 7h3l2-3h6l2 3h3v12H4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="1.6"/>
    </svg>`;

  /* ---------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */
  function render() {
    const vehicles = PitStopStorage.getVehicles();
    const hasVehicles = vehicles.length > 0;

    addVehicleBtn.hidden = !hasVehicles;
    emptyState.hidden = hasVehicles;
    grid.hidden = !hasVehicles;
    grid.innerHTML = '';

    vehicles.forEach((v) => {
      const card = document.createElement('article');
      card.className = 'vehicle-card';

      const displayOdo = PitStopStorage.fromKm(v.currentOdometerKm, v.odometerUnit);
      const roundedOdo = Math.round(displayOdo).toLocaleString();

      card.innerHTML = `
        <div class="vehicle-card-photo">
          ${v.photo ? `<img src="${v.photo}" alt="${escapeHtml(v.name)}">` : PLACEHOLDER_PHOTO_HTML}
        </div>
        <div class="vehicle-card-body">
          <div class="vehicle-card-title">
            <h3>${escapeHtml(v.name)}</h3>
            <button class="vehicle-card-edit" data-edit="${v.id}" aria-label="Edit ${escapeHtml(v.name)}">Edit</button>
          </div>
          <table class="vehicle-info-table">
            <tbody>
              <tr><td>Make</td><td>${escapeHtml(v.brand)}</td></tr>
              <tr><td>Year</td><td>${escapeHtml(String(v.year))}</td></tr>
              <tr><td>Odometer</td><td class="mono">${roundedOdo} ${v.odometerUnit}</td></tr>
            </tbody>
          </table>
          <a class="btn btn-primary btn-sm vehicle-card-view-parts" href="vehicle.html?id=${v.id}">View Parts</a>
        </div>
      `;
      grid.appendChild(card);
    });

    grid.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.dataset.edit));
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

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
      if (pendingPhoto === 'REMOVE') patch.photo = null;
      else if (pendingPhoto) patch.photo = pendingPhoto;
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
      closeModal();
      render();
    }
  });

  render();
});
