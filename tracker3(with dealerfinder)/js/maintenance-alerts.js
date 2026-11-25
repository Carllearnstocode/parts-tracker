/* ==========================================================================
   PitStop — In-app maintenance alerts
   ========================================================================== */

const alertSoundToggle = document.getElementById('alert-sound-toggle');
const ALERT_SOUND_PREFERENCE_KEY = 'pitstop-alert-sound-enabled';

function loadAlertSoundPreference() {
  try {
    const preference = localStorage.getItem(ALERT_SOUND_PREFERENCE_KEY);
    if (preference === null) {
      localStorage.setItem(ALERT_SOUND_PREFERENCE_KEY, 'on');
      return true;
    }
    return preference === 'on';
  } catch (err) {
    console.warn('PitStop: could not read alert sound preference.', err);
    return true;
  }
}

let alertSoundEnabled = loadAlertSoundPreference();
let alertAudioContext = null;
let alertSoundPending = false;
const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

async function playMaintenanceChime() {
  if (!AudioContextConstructor) {
    throw new Error('Web Audio is not supported by this browser.');
  }

  if (!alertAudioContext) alertAudioContext = new AudioContextConstructor();

  await alertAudioContext.resume();
  const now = alertAudioContext.currentTime;
  const oscillator = alertAudioContext.createOscillator();
  const gain = alertAudioContext.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.setValueAtTime(1174.66, now + 0.14);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  oscillator.connect(gain);
  gain.connect(alertAudioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.5);
}

function updateAlertSoundToggle() {
  alertSoundToggle.textContent = `Sound: ${alertSoundEnabled ? 'On' : 'Off'}`;
  alertSoundToggle.setAttribute('aria-pressed', String(alertSoundEnabled));
}

function setAlertSoundEnabled(enabled) {
  alertSoundEnabled = enabled;
  if (!enabled) alertSoundPending = false;
  try {
    localStorage.setItem(ALERT_SOUND_PREFERENCE_KEY, enabled ? 'on' : 'off');
  } catch (err) {
    console.warn('PitStop: could not save alert sound preference.', err);
  }
  updateAlertSoundToggle();
}

function markAlertSoundUnavailable(err) {
  console.warn('PitStop: maintenance alert sound is unavailable.', err);
  alertSoundEnabled = false;
  try {
    localStorage.setItem(ALERT_SOUND_PREFERENCE_KEY, 'off');
  } catch (storageErr) {
    console.warn('PitStop: could not save alert sound preference.', storageErr);
  }
  alertSoundToggle.textContent = 'Sound unavailable';
  alertSoundToggle.disabled = true;
}

if (!AudioContextConstructor) {
  alertSoundToggle.disabled = true;
  alertSoundToggle.textContent = 'Sound unavailable';
} else {
  alertSoundToggle.addEventListener('click', async () => {
    if (alertSoundEnabled) {
      setAlertSoundEnabled(false);
      return;
    }

    alertSoundPending = false;
    try {
      await playMaintenanceChime();
      setAlertSoundEnabled(true);
    } catch (err) {
      markAlertSoundUnavailable(err);
    }
  });
}

function unlockAlertAudio() {
  if (!alertSoundEnabled || !AudioContextConstructor) return;

  try {
    if (!alertAudioContext) alertAudioContext = new AudioContextConstructor();
    if (alertAudioContext.state === 'running' && !alertSoundPending) return;
    alertAudioContext.resume().then(() => {
      if (alertSoundPending && alertSoundEnabled && !document.hidden) {
        alertSoundPending = false;
        playMaintenanceChime().catch((err) => {
          alertSoundPending = true;
          console.warn('PitStop: maintenance chime is waiting for audio permission.', err);
        });
      }
    }).catch((err) => {
      if (err.name !== 'NotAllowedError') {
        console.warn('PitStop: alert audio could not be unlocked.', err);
      }
    });
  } catch (err) {
    console.warn('PitStop: alert audio could not be unlocked.', err);
  }
}

document.addEventListener('pointerdown', unlockAlertAudio);
document.addEventListener('keydown', unlockAlertAudio);

document.addEventListener('pitstop:overdue', () => {
  if (alertSoundEnabled && !document.hidden) {
    playMaintenanceChime().catch((err) => {
      alertSoundPending = true;
      console.warn('PitStop: maintenance chime is waiting for audio permission.', err);
    });
  }
});

if (AudioContextConstructor) updateAlertSoundToggle();

const maintenanceWidget = document.createElement('div');
maintenanceWidget.className = 'maintenance-widget';
maintenanceWidget.innerHTML = `
  <section id="maintenance-popover" class="maintenance-popover" aria-labelledby="maintenance-popover-title" hidden>
    <header class="maintenance-popover-header">
      <div>
        <h2 id="maintenance-popover-title">Parts to check</h2>
        <p id="maintenance-popover-summary"></p>
      </div>
      <button class="maintenance-popover-close" type="button" aria-label="Close parts to check">&times;</button>
    </header>
    <div id="maintenance-widget-list" class="maintenance-widget-list"></div>
  </section>
  <button class="maintenance-fab" type="button" aria-label="Parts to check" aria-expanded="false" aria-controls="maintenance-popover">
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3.75h8.5L19 7.3v12.95H7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M15.5 3.75V7.5H19M10 11h6M10 14.5h6M10 18h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m3.75 7.5 1.5 1.5 2-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="maintenance-fab-count" aria-live="polite" hidden></span>
  </button>
`;
document.body.appendChild(maintenanceWidget);

const maintenanceFab = maintenanceWidget.querySelector('.maintenance-fab');
const maintenancePopover = maintenanceWidget.querySelector('.maintenance-popover');
const maintenanceCount = maintenanceWidget.querySelector('.maintenance-fab-count');
const maintenanceSummary = maintenanceWidget.querySelector('#maintenance-popover-summary');
const maintenanceList = maintenanceWidget.querySelector('#maintenance-widget-list');
const maintenanceClose = maintenanceWidget.querySelector('.maintenance-popover-close');

function escapeMaintenanceHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value);
  return element.innerHTML;
}

function renderMaintenanceWidget() {
  const items = [];
  PitStopStorage.getVehicles().forEach((vehicle) => {
    PitStopStorage.getParts(vehicle.id).forEach((part) => {
      const result = PitStopStorage.computePartStatus(part, vehicle);
      if (result.status === 'overdue' || result.status === 'due-soon') {
        items.push({ vehicle, part, result });
      }
    });
  });

  items.sort((a, b) => {
    const statusOrder = (a.result.status === 'overdue' ? 0 : 1) - (b.result.status === 'overdue' ? 0 : 1);
    return statusOrder || b.result.percent - a.result.percent;
  });

  maintenanceCount.hidden = items.length === 0;
  maintenanceCount.textContent = items.length > 99 ? '99+' : String(items.length);
  maintenanceFab.setAttribute('aria-label', `Parts to check${items.length ? `, ${items.length} needing attention` : ''}`);
  maintenanceSummary.textContent = items.length
    ? `${items.length} part${items.length === 1 ? '' : 's'} need attention`
    : 'All tracked parts are on track.';

  if (!items.length) {
    maintenanceList.innerHTML = '<p class="maintenance-widget-empty">No parts currently need service.</p>';
    return;
  }

  maintenanceList.innerHTML = items.map(({ vehicle, part, result }) => {
    const statusLabel = result.status === 'overdue' ? 'Overdue' : 'Due soon';
    const href = `vehicle.html?id=${encodeURIComponent(vehicle.id)}#part-${encodeURIComponent(part.id)}`;
    return `
      <a class="maintenance-widget-item" data-status="${result.status}" href="${href}">
        <span class="maintenance-widget-status">${statusLabel}</span>
        <span class="maintenance-widget-copy">
          <strong>${escapeMaintenanceHtml(part.name)}</strong>
          <span>${escapeMaintenanceHtml(vehicle.name)}</span>
        </span>
        <span class="maintenance-widget-arrow" aria-hidden="true">&rsaquo;</span>
      </a>
    `;
  }).join('');
}

function setMaintenancePopoverOpen(open, returnFocus = false) {
  maintenancePopover.hidden = !open;
  maintenanceFab.setAttribute('aria-expanded', String(open));
  if (open) renderMaintenanceWidget();
  else if (returnFocus) maintenanceFab.focus();
}

maintenanceFab.addEventListener('click', () => {
  setMaintenancePopoverOpen(maintenancePopover.hidden);
});
maintenanceClose.addEventListener('click', () => setMaintenancePopoverOpen(false, true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !maintenancePopover.hidden) {
    setMaintenancePopoverOpen(false, true);
  }
});
document.addEventListener('click', (event) => {
  if (!maintenancePopover.hidden && !maintenanceWidget.contains(event.target)) {
    setMaintenancePopoverOpen(false);
  }
});
document.addEventListener('pitstop:attention-updated', renderMaintenanceWidget);
window.addEventListener('storage', renderMaintenanceWidget);
renderMaintenanceWidget();

PitStopStorage.startOverdueNotificationChecks(15);
