/* ==========================================================================
   PitStop — Storage
   Shared localStorage data layer. Canonical odometer unit is always km
   internally; convert only at display/input time. Every module (garage,
   parts, trips) reads/writes through this file so the data shape stays
   consistent in one place.
   ========================================================================== */

const PitStopStorage = (() => {
  const VEHICLES_KEY = 'pitstop-vehicles';
  const KM_PER_MILE = 1.60934;

  /* ---- Unit conversion ---- */
  function toKm(value, unit) {
    const n = Number(value) || 0;
    return unit === 'mi' ? n * KM_PER_MILE : n;
  }

  function fromKm(km, unit) {
    const n = Number(km) || 0;
    return unit === 'mi' ? n / KM_PER_MILE : n;
  }

  /* ---- Vehicles CRUD ---- */
  function getVehicles() {
    try {
      const raw = localStorage.getItem(VEHICLES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('PitStop: failed to read vehicles from storage', err);
      return [];
    }
  }

  function saveVehicles(vehicles) {
    try {
      localStorage.setItem(VEHICLES_KEY, JSON.stringify(vehicles));
      return true;
    } catch (err) {
      console.error('PitStop: failed to save vehicles (storage full or unavailable)', err);
      return false;
    }
  }

  function getVehicle(id) {
    return getVehicles().find((v) => v.id === id) || null;
  }

  function addVehicle(data) {
    const vehicles = getVehicles();
    const vehicle = {
      id: 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: data.name,
      brand: data.brand,
      year: data.year,
      odometerUnit: data.odometerUnit === 'mi' ? 'mi' : 'km',
      currentOdometerKm: toKm(data.startingOdometer, data.odometerUnit),
      photo: data.photo || null,
      createdAt: new Date().toISOString(),
    };
    vehicles.push(vehicle);
    saveVehicles(vehicles);
    return vehicle;
  }

  function updateVehicle(id, patch) {
    const vehicles = getVehicles();
    const idx = vehicles.findIndex((v) => v.id === id);
    if (idx === -1) return null;
    vehicles[idx] = { ...vehicles[idx], ...patch };
    saveVehicles(vehicles);
    return vehicles[idx];
  }

  function deleteVehicle(id) {
    const vehicles = getVehicles().filter((v) => v.id !== id);
    saveVehicles(vehicles);
    deletePartsForVehicle(id); // cascade — no orphaned parts left behind
    deleteTripsForVehicle(id); // cascade — no orphaned trips left behind
  }

  /* ---- Photo compression ----
     Resizes to a max dimension and re-encodes as JPEG before returning a
     base64 data URL, so a full-resolution phone photo doesn't quietly eat
     through localStorage's ~5-10MB budget across several vehicles. */
  function compressPhoto(file, maxDimension = 800, quality = 0.75) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('Not an image file'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read image'));
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---- Parts CRUD ---- */
  const PARTS_KEY = 'pitstop-parts';

  function getAllParts() {
    try {
      const raw = localStorage.getItem(PARTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('PitStop: failed to read parts from storage', err);
      return [];
    }
  }

  function saveAllParts(parts) {
    try {
      localStorage.setItem(PARTS_KEY, JSON.stringify(parts));
      return true;
    } catch (err) {
      console.error('PitStop: failed to save parts (storage full or unavailable)', err);
      return false;
    }
  }

  function getParts(vehicleId) {
    return getAllParts().filter((p) => p.vehicleId === vehicleId);
  }

  function getPart(id) {
    return getAllParts().find((p) => p.id === id) || null;
  }

  function addPart(data) {
    const parts = getAllParts();
    const part = {
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      vehicleId: data.vehicleId,
      name: data.name,
      purchaseDate: data.purchaseDate || null,
      installDate: data.installDate || null,
      scheduleType: data.scheduleType, // 'distance' | 'time' | 'whichever'
      intervalKm: data.intervalKm || null,
      intervalDays: data.intervalDays || null,
      baselineOdometerKm: data.baselineOdometerKm,
      baselineDate: data.baselineDate,
      createdAt: new Date().toISOString(),
    };
    parts.push(part);
    saveAllParts(parts);
    return part;
  }

  function updatePart(id, patch) {
    const parts = getAllParts();
    const idx = parts.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    parts[idx] = { ...parts[idx], ...patch };
    saveAllParts(parts);
    return parts[idx];
  }

  function deletePart(id) {
    saveAllParts(getAllParts().filter((p) => p.id !== id));
  }

  function deletePartsForVehicle(vehicleId) {
    saveAllParts(getAllParts().filter((p) => p.vehicleId !== vehicleId));
  }

  /* ---- Status computation ----
     Always computed live from the vehicle's current odometer + today's
     date, never stored — so editing an interval or the odometer instantly
     re-sorts what's due, with no stale flags to clean up. */
  function computePartStatus(part, vehicle) {
    const DUE_SOON_THRESHOLD = 0.85; // 85% of interval used

    let percentKm = null;
    let percentDays = null;

    if (part.scheduleType === 'distance' || part.scheduleType === 'whichever') {
      if (part.intervalKm) {
        const kmSince = (vehicle.currentOdometerKm || 0) - (part.baselineOdometerKm || 0);
        percentKm = kmSince / part.intervalKm;
      }
    }
    if (part.scheduleType === 'time' || part.scheduleType === 'whichever') {
      if (part.intervalDays) {
        const msSince = Date.now() - new Date(part.baselineDate).getTime();
        const daysSince = msSince / (1000 * 60 * 60 * 24);
        percentDays = daysSince / part.intervalDays;
      }
    }

    const percents = [percentKm, percentDays].filter((p) => p !== null);
    const percent = percents.length ? Math.max(...percents) : 0;

    let status = 'ok';
    if (percent >= 1) status = 'overdue';
    else if (percent >= DUE_SOON_THRESHOLD) status = 'due-soon';

    return {
      status,
      percent: Math.min(percent, 1.5), // cap for progress-bar rendering
      kmRemaining: part.intervalKm != null
        ? Math.round(part.intervalKm - ((vehicle.currentOdometerKm || 0) - (part.baselineOdometerKm || 0)))
        : null,
      daysRemaining: part.intervalDays != null
        ? Math.round(part.intervalDays - (Date.now() - new Date(part.baselineDate).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    };
  }

  /* ---- Notification permission ----
     Requested once, the first time the user saves a part with a schedule
     attached — not on page load. */
  const NOTIF_FLAG_KEY = 'pitstop-notif-requested';

  function maybeRequestNotificationPermission() {
    if (!('Notification' in window)) return;
    try {
      if (localStorage.getItem(NOTIF_FLAG_KEY)) return;
      localStorage.setItem(NOTIF_FLAG_KEY, '1');
    } catch (err) {
      /* localStorage unavailable — ask anyway, just won't remember for next time */
    }
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  /* ---- Trips ----
     A trip is a log entry (date, distance, source) that also nudges the
     vehicle's currentOdometerKm forward. Kept separate from the odometer
     itself so there's an audit trail — useful for spotting GPS drift and
     for the manual-entry fallback when GPS tracking isn't practical. */
  const TRIPS_KEY = 'pitstop-trips';

  function getAllTrips() {
    try {
      const raw = localStorage.getItem(TRIPS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('PitStop: failed to read trips from storage', err);
      return [];
    }
  }

  function saveAllTrips(trips) {
    try {
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
      return true;
    } catch (err) {
      console.error('PitStop: failed to save trips (storage full or unavailable)', err);
      return false;
    }
  }

  function getTrips(vehicleId) {
    return getAllTrips()
      .filter((t) => t.vehicleId === vehicleId)
      .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  /* distanceKm: the trip distance already converted to km.
     source: 'gps' | 'manual' */
  function addTrip({ vehicleId, distanceKm, date, source }) {
    const trips = getAllTrips();
    const trip = {
      id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      vehicleId,
      distanceKm,
      date: date || new Date().toISOString().slice(0, 10),
      source,
      createdAt: new Date().toISOString(),
    };
    trips.push(trip);
    saveAllTrips(trips);

    // Applying the trip is what actually moves the odometer — every part's
    // live status recalculates the moment this changes.
    const vehicle = getVehicle(vehicleId);
    if (vehicle) {
      updateVehicle(vehicleId, { currentOdometerKm: (vehicle.currentOdometerKm || 0) + distanceKm });
    }

    return trip;
  }

  function deleteTrip(id) {
    const trips = getAllTrips();
    const trip = trips.find((t) => t.id === id);
    if (!trip) return;
    saveAllTrips(trips.filter((t) => t.id !== id));

    // Deleting a trip reverses its effect on the odometer too, so the two
    // stay consistent. If the odometer was edited directly since, this can
    // drift — acceptable trade-off for a school project's scope.
    const vehicle = getVehicle(trip.vehicleId);
    if (vehicle) {
      updateVehicle(trip.vehicleId, {
        currentOdometerKm: Math.max(0, (vehicle.currentOdometerKm || 0) - trip.distanceKm),
      });
    }
  }

  function deleteTripsForVehicle(vehicleId) {
    saveAllTrips(getAllTrips().filter((t) => t.vehicleId !== vehicleId));
  }

  return {
    toKm,
    fromKm,
    getVehicles,
    saveVehicles,
    getVehicle,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    compressPhoto,
    getParts,
    getPart,
    addPart,
    updatePart,
    deletePart,
    deletePartsForVehicle,
    computePartStatus,
    maybeRequestNotificationPermission,
    getTrips,
    addTrip,
    deleteTrip,
    deleteTripsForVehicle,
  };
})();
