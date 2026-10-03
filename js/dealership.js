/* ==========================================================================
   PitStop — Dealership Finder (Module 5)
   No API key or billing account needed: this opens a plain Google Maps
   search in a new tab (https://www.google.com/maps/search/?api=1&query=...),
   optionally biased toward the user's current location.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('find-dealership-btn');
  if (!openBtn) return; // vehicle not found — vehicle.js already bailed out

  const modal = document.getElementById('dealership-modal');
  const closeBtn = document.getElementById('dealership-modal-close');
  const searchForm = document.getElementById('dealership-search-form');
  const searchInput = document.getElementById('dealership-search-input');
  const locationNote = document.getElementById('dealership-location-note');
  const searchPanel = document.getElementById('dealership-search-panel');
  const mapPanel = document.getElementById('dealership-map-panel');
  const mapFrame = document.getElementById('dealership-map-frame');
  const openTabLink = document.getElementById('dealership-open-tab-link');
  const backBtn = document.getElementById('dealership-back-btn');
  const mapStatus = document.getElementById('dealership-map-status');

  const params = new URLSearchParams(window.location.search);
  const vehicleId = params.get('id');
  const vehicle = vehicleId ? PitStopStorage.getVehicle(vehicleId) : null;

  let userCoords = null; // {lat, lng} if geolocation is available and granted

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      locationNote.textContent = 'Location unavailable in this browser — results will be general.';
      return;
    }
    locationNote.textContent = 'Looking for your location\u2026';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        locationNote.textContent = 'Will center results near your current location.';
      },
      () => {
        locationNote.textContent = 'Location not shared — results will be general.';
      },
      { timeout: 8000 }
    );
  }

  function showSearchPanel() {
    searchPanel.hidden = false;
    mapPanel.hidden = true;
    mapStatus.textContent = '';
  }

  function showMapPanel(url, statusText) {
    searchPanel.hidden = true;
    mapPanel.hidden = false;
    mapStatus.textContent = statusText;
    openTabLink.href = url;
    if (mapFrame) mapFrame.src = '';
  }

  function openModal() {
    modal.hidden = false;
    showSearchPanel();
    searchInput.value = vehicle ? `${vehicle.brand} dealership` : '';
    userCoords = null;
    requestLocation();
    searchInput.focus();
  }

  function closeModal() {
    modal.hidden = true;
    showSearchPanel();
    if (mapFrame) mapFrame.src = '';
  }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backBtn.addEventListener('click', showSearchPanel);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = searchInput.value.trim();
    const base = typed || (vehicle ? `${vehicle.brand} dealership` : 'dealership');
    const query = userCoords ? `${base} near ${userCoords.lat},${userCoords.lng}` : base;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

    const popup = window.open(
      url,
      'pitstop-dealership-map',
      'width=1200,height=820,left=120,top=80,noopener=yes,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no'
    );

    if (popup) {
      popup.focus();
      showMapPanel(url, 'Google Maps opened in a floating window. If it does not appear, use the button below.');
      return;
    }

    showMapPanel(url, 'Chrome blocked the floating map window. Use the button below to continue in Google Maps.');
  });
});
