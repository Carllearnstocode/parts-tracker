/* ==========================================================================
   PitStop — Theme
   Dark mode is the fixed default for this design, so we force it on startup.
   ========================================================================== */

const PitStopTheme = (() => {
  const root = document.documentElement;

  function init() {
    root.setAttribute('data-theme', 'dark');

    try {
      localStorage.setItem('pitstop-theme', 'dark');
    } catch (err) {
      // localStorage unavailable — theme still stays dark by default
    }
  }

  return { init, current: () => 'dark' };
})();

document.addEventListener('DOMContentLoaded', PitStopTheme.init);
