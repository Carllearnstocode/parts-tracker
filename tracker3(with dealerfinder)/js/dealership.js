/* ==========================================================================
   PitStop — Dealership Finder (Module 5)
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
  let popupWindow = null;
  let popupWatcher = null;

  function stopPopupWatcher() {
    if (popupWatcher) {
      clearInterval(popupWatcher);
      popupWatcher = null;
    }
    popupWindow = null;
  }

  function showSearchPanel() {
    searchPanel.hidden = false;
    mapPanel.hidden = true;
    mapStatus.textContent = '';
  }

  function closeModal() {
    modal.hidden = true;
    showSearchPanel();
    stopPopupWatcher();
    if (mapFrame) mapFrame.src = '';
  }

  function watchPopupWindow(win) {
    if (!win) return;
    popupWindow = win;

    if (popupWatcher) clearInterval(popupWatcher);

    popupWatcher = setInterval(() => {
      try {
        if (popupWindow && popupWindow.closed) {
          closeModal();
          return;
        }
      } catch (error) {
        closeModal();
        return;
      }
    }, 300);
  }

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      locationNote.textContent = 'Location unavailable in this browser — results will be general.';
      return;
    }
    locationNote.textContent = 'Looking for your location…';
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

  function openModal() {
    modal.hidden = false;
    showSearchPanel();
    searchInput.value = vehicle ? `${vehicle.brand} dealership` : '';
    userCoords = null;
    requestLocation();
    searchInput.focus();
  }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backBtn.addEventListener('click', showSearchPanel);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  window.addEventListener('focus', () => {
    if (popupWindow && popupWindow.closed) {
      closeModal();
    }
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = searchInput.value.trim();
    const base = typed || (vehicle ? `${vehicle.brand} dealership` : 'dealership');
    const query = userCoords ? `${base} near ${userCoords.lat},${userCoords.lng}` : base;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

    const popup = window.open(url, '_blank');

    if (popup) {
      popup.focus();
      watchPopupWindow(popup);
      closeModal();
      return;
    }

    locationNote.textContent = 'Pop-ups were blocked. Please allow pop-ups and try again.';
    searchInput.focus();
  });
});
