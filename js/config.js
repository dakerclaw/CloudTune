/**
 * CloudTune - Configuration Module
 * Manages app settings and authentication mode detection
 */

const Config = (() => {
  const STORAGE_KEY = 'cloudtune_config';

  const defaults = {
    clientId: '',
    folderId: '',
    authMode: 'auto', // 'auto', 'oauth2', 'service-account'
    theme: 'dark',
    autoPlay: true,
    volume: 1,
  };

  let current = { ...defaults };
  // Detected mode from backend status endpoint
  let detectedMode = null;

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        current = { ...defaults, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load config:', e);
    }
    return current;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.warn('Failed to save config:', e);
    }
  }

  function get(key) {
    return current[key];
  }

  function set(key, value) {
    current[key] = value;
    save();
  }

  function update(obj) {
    current = { ...current, ...obj };
    save();
  }

  function hasClientId() {
    return !!current.clientId;
  }

  function reset() {
    current = { ...defaults };
    save();
  }

  function setDetectedMode(mode) {
    detectedMode = mode;
  }

  function getDetectedMode() {
    return detectedMode;
  }

  /**
   * Determine the effective auth mode
   * - 'auto': detect from backend availability
   * - 'oauth2': force OAuth2 mode
   * - 'service-account': force SA mode (requires backend)
   */
  function getEffectiveMode() {
    if (current.authMode === 'auto') {
      return detectedMode || 'oauth2';
    }
    return current.authMode;
  }

  function isServiceAccountMode() {
    return getEffectiveMode() === 'service-account';
  }

  function isOAuth2Mode() {
    return getEffectiveMode() === 'oauth2';
  }

  // Initialize on load
  load();

  return {
    get,
    set,
    update,
    hasClientId,
    reset,
    load,
    setDetectedMode,
    getDetectedMode,
    getEffectiveMode,
    isServiceAccountMode,
    isOAuth2Mode,
    STORAGE_KEY,
  };
})();
