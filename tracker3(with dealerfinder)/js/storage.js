/* ==========================================================================
   PitStop — Storage
   Shared localStorage data layer + Service Worker / Web Push helpers.
   Canonical odometer unit is always km internally; convert only at
   display/input time.
   ========================================================================== */

const PitStopStorage = (() => {
  const VEHICLES_KEY = 'pitstop-vehicles';
  const PARTS_KEY = 'pitstop-parts';
  const TRIPS_KEY = 'pitstop-trips';
  const NOTIF_FLAG_KEY = 'pitstop-notif-requested';
  const NOTIF_LAST_SENT_KEY = 'pitstop-overdue-last-notified';
  const PUSH_SUB_KEY = 'pitstop-push-subscription';
  const KM_PER_MILE = 1.60934;

  // Replace with your Web Push server's base64url VAPID public key if using a push backend.
  const PUSH_PUBLIC_VAPID_KEY = '';

  let swRegistrationPromise = null;

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /* ---- Service Worker & Web Push ---- */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!swRegistrationPromise) {
      swRegistrationPromise = navigator.serviceWorker
        .register('./sw.js')
        .catch((err) => {
          console.warn('PitStop: service worker registration failed', err);
          return null;
        });
    }
    return swRegistrationPromise;
  }

  async function subscribeToWebPush() {
    if (!PUSH_PUBLIC_VAPID_KEY) return null;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (getNotificationPermissionState() !== 'granted') return null;

    try {
      const reg = await registerServiceWorker();
      if (!reg || !reg.pushManager) return null;

      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_VAPID_KEY),
        });
      }

      try {
        localStorage.setItem(PUSH_SUB_KEY, JSON.stringify(subscription.toJSON()));
      } catch (_) {
        // Ignore storage errors
      }

      return subscription;
    } catch (err) {
      console.warn('PitStop: web push subscription failed', err);
      return null;
    }
  }

  function getSavedPushSubscription() {
    try {
      const raw = localStorage.getItem(PUSH_SUB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

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
    deletePartsForVehicle(id);
    deleteTripsForVehicle(id);
  }

  /* ---- Photo compression ---- */
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
      photo: data.photo || null,
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

  function parseLocalDateMs(dateStr) {
    if (!dateStr) return Date.now();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
    const ms = new Date(normalized).getTime();
    return Number.isNaN(ms) ? Date.now() : ms;
  }

  /* ---- Status computation (90% = due-soon, 100%+ = overdue) ---- */
  function computePartStatus(part, vehicle) {
    const DUE_SOON_THRESHOLD = 0.9; // 90% of distance or days limit
    const baselineOdometerKm = getEffectiveBaselineOdometerKm(part, vehicle);
    const nowMs = Date.now();
    const baselineMs = parseLocalDateMs(part.baselineDate || part.installDate);

    let percentKm = null;
    let percentDays = null;

    if (part.scheduleType === 'distance' || part.scheduleType === 'whichever') {
      if (part.intervalKm) {
        const kmSince = (vehicle.currentOdometerKm || 0) - baselineOdometerKm;
        percentKm = kmSince / part.intervalKm;
      }
    }
    if (part.scheduleType === 'time' || part.scheduleType === 'whichever') {
      if (part.intervalDays) {
        const daysSince = (nowMs - baselineMs) / (1000 * 60 * 60 * 24);
        percentDays = daysSince / part.intervalDays;
      }
    }

    const percents = [percentKm, percentDays].filter((p) => p !== null);
    const percent = percents.length ? Math.max(...percents) : 0;

    let status = 'ok';
    if (percent >= 1) status = 'overdue';
    else if (percent >= DUE_SOON_THRESHOLD) status = 'due-soon';

    const kmUsed = (vehicle.currentOdometerKm || 0) - baselineOdometerKm;
    return {
      status,
      percent: Math.min(percent, 1.5),
      kmRemaining: part.intervalKm != null
        ? Math.round(part.intervalKm - kmUsed)
        : null,
      daysRemaining: part.intervalDays != null
        ? Math.round(part.intervalDays - (nowMs - baselineMs) / (1000 * 60 * 60 * 24))
        : null,
    };
  }

  /* ---- Notification permission ---- */
  function getNotificationPermissionState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    await registerServiceWorker();
    if (Notification.permission !== 'default') {
      if (Notification.permission === 'granted') await subscribeToWebPush();
      return Notification.permission;
    }

    try {
      localStorage.setItem(NOTIF_FLAG_KEY, '1');
    } catch (_) {
      // Ignore storage errors
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      await subscribeToWebPush();
    }
    return permission;
  }

  function maybeRequestNotificationPermission() {
    if (getNotificationPermissionState() === 'default') {
      requestNotificationPermission();
    }
  }

  async function dispatchSystemNotification(title, body, targetUrl) {
    const options = {
      body,
      icon: 'assets/icon-transparent.png',
      badge: 'assets/icon-transparent.png',
      tag: 'pitstop-maintenance-alerts',
      silent: false,
      renotify: true,
      data: { url: targetUrl },
    };

    try {
      const reg = await registerServiceWorker();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return;
      }
    } catch (_) {
      // Fall back to window Notification constructor
    }

    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.location.href = targetUrl;
      notification.close();
    };
  }

  function sendOverdueNotifications(force = false) {
    registerServiceWorker();

    const alerts = [];
    getVehicles().forEach((vehicle) => {
      getParts(vehicle.id).forEach((part) => {
        const result = computePartStatus(part, vehicle);
        if (result.status === 'overdue' || result.status === 'due-soon') {
          alerts.push({ vehicle, part, status: result.status, result });
        }
      });
    });

    document.dispatchEvent(new CustomEvent('pitstop:attention-updated'));
    if (!alerts.length) return [];

    alerts.sort((a, b) => (a.status === 'overdue' ? -1 : 1) - (b.status === 'overdue' ? -1 : 1));

    const signatureItems = alerts
      .map(({ vehicle, part, status }) => `${vehicle.id}:${part.id}:${status}`)
      .sort()
      .join('|');
    const today = new Date().toISOString().slice(0, 10);
    const signature = `${today}|${signatureItems}`;

    let lastSent = '';
    try {
      lastSent = localStorage.getItem(NOTIF_LAST_SENT_KEY) || '';
    } catch (_) {
      // Ignore storage errors
    }

    if (!force && lastSent === signature) return alerts;

    const overdueCount = alerts.filter((a) => a.status === 'overdue').length;
    const dueSoonCount = alerts.filter((a) => a.status === 'due-soon').length;

    let title = 'Maintenance attention needed';
    if (overdueCount && dueSoonCount) {
      title = `${overdueCount} overdue, ${dueSoonCount} at 90%+ limit`;
    } else if (overdueCount) {
      title = overdueCount === 1 ? 'One maintenance part is overdue' : `${overdueCount} maintenance parts are overdue`;
    } else {
      title = dueSoonCount === 1 ? 'One part reached 90% of its limit' : `${dueSoonCount} parts reached 90% of their limit`;
    }

    const first = alerts[0];
    const reason = first.status === 'overdue' ? 'is overdue' : 'is at 90%+ of its service limit';
    const body = alerts.length === 1
      ? `${first.part.name} on ${first.vehicle.name} ${reason}. Tap to review all.`
      : `First up: ${first.part.name} on ${first.vehicle.name} (${first.status === 'overdue' ? 'overdue' : 'due soon'}). Tap to review all.`;

    document.dispatchEvent(new CustomEvent('pitstop:overdue', {
      detail: {
        title,
        body,
        hasOverdue: overdueCount > 0,
        alerts: alerts.map(({ vehicle, part, status }) => ({
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          partName: part.name,
          status,
        })),
      },
    }));

    if (getNotificationPermissionState() === 'granted') {
      const targetUrl = new URL('garage.html?show=attention', window.location.href).href;
      dispatchSystemNotification(title, body, targetUrl).catch((err) => {
        console.warn('PitStop: notification could not be sent.', err);
      });
    }

    try {
      localStorage.setItem(NOTIF_LAST_SENT_KEY, signature);
    } catch (_) {
      // Ignore storage errors
    }

    return alerts;
  }

  function startOverdueNotificationChecks(intervalMinutes = 15) {
    registerServiceWorker().then(() => {
      if (getNotificationPermissionState() === 'granted') {
        subscribeToWebPush();
      }
      sendOverdueNotifications();
    });

    const intervalId = window.setInterval(sendOverdueNotifications, intervalMinutes * 60 * 1000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) sendOverdueNotifications();
    });

    return intervalId;
  }

  /* ---- Trips ---- */
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

  function addTrip({ vehicleId, distanceKm, date, source, destination = '' }) {
    const trips = getAllTrips();
    const trip = {
      id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      vehicleId,
      distanceKm,
      date: date || new Date().toISOString().slice(0, 10),
      source,
      destination: String(destination || '').trim(),
      createdAt: new Date().toISOString(),
    };
    trips.push(trip);
    saveAllTrips(trips);

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

  function getTripsSinceInstall(part, vehicle) {
    if (!part.installDate) return [];
    const installDate = new Date(part.installDate + 'T00:00:00');
    return getTrips(vehicle.id).filter((trip) => {
      if (!trip.date) return false;
      return new Date(trip.date + 'T00:00:00') >= installDate;
    });
  }

  function getEffectiveBaselineOdometerKm(part, vehicle) {
    const currentOdometerKm = Number(vehicle.currentOdometerKm) || 0;
    const recordedBaseline = Number(part.baselineOdometerKm);
    if (part.baselineOdometerKm != null && Number.isFinite(recordedBaseline)) {
      return recordedBaseline;
    }

    if (!part.installDate) return Number(part.baselineOdometerKm) || currentOdometerKm;

    const tripsSinceInstall = getTripsSinceInstall(part, vehicle);
    const distanceSinceInstallKm = tripsSinceInstall.reduce((sum, trip) => sum + (Number(trip.distanceKm) || 0), 0);

    if (distanceSinceInstallKm > 0) {
      return Math.max(0, currentOdometerKm - distanceSinceInstallKm);
    }

    return Number(part.baselineOdometerKm) || currentOdometerKm;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
      .join('');
  }

  function getDominantColorFromImage(dataUrl, fallback = '#4fd1e8') {
    return new Promise((resolve) => {
      if (!dataUrl || !/^data:image\//.test(dataUrl)) {
        resolve(fallback);
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 64;
          const scale = Math.min(maxDim / Math.max(img.width, 1), maxDim / Math.max(img.height, 1), 1);
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(fallback);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const { data } = ctx.getImageData(0, 0, width, height);
          const buckets = new Map();

          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha < 128) continue;

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const brightness = (0.299 * r) + (0.587 * g) + (0.114 * b);
            if (brightness < 18 || brightness > 248) continue;

            const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
            const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
            bucket.count += 1;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
            buckets.set(key, bucket);
          }

          if (buckets.size === 0) {
            resolve(fallback);
            return;
          }

          let bestBucket = null;
          for (const bucket of buckets.values()) {
            if (!bestBucket || bucket.count > bestBucket.count) bestBucket = bucket;
          }

          const color = bestBucket
            ? rgbToHex(
                Math.round(bestBucket.r / bestBucket.count),
                Math.round(bestBucket.g / bestBucket.count),
                Math.round(bestBucket.b / bestBucket.count)
              )
            : fallback;

          resolve(color);
        } catch (err) {
          resolve(fallback);
        }
      };

      img.onerror = () => resolve(fallback);
      img.src = dataUrl;
    });
  }

  function getVehicleAccentColor(vehicle, fallback = '#4fd1e8') {
    if (!vehicle) return Promise.resolve(fallback);
    return getDominantColorFromImage(vehicle.photo, fallback);
  }

  function getVehicleAccentColorFromDataUri(dataUrl, fallback = '#4fd1e8') {
    return getDominantColorFromImage(dataUrl, fallback);
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
    registerServiceWorker,
    subscribeToWebPush,
    getSavedPushSubscription,
    maybeRequestNotificationPermission,
    getNotificationPermissionState,
    requestNotificationPermission,
    sendOverdueNotifications,
    startOverdueNotificationChecks,
    getTrips,
    addTrip,
    deleteTrip,
    deleteTripsForVehicle,
    getDominantColorFromImage,
    getVehicleAccentColor,
    getVehicleAccentColorFromDataUri,
  };
})();