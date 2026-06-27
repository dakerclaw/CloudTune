/**
 * CloudTune - Configuration Module
 * SA-only mode: only folderId and volume are persisted.
 */

const Config = (() => {
  const STORAGE_KEY = 'cloudtune_config';

  const defaults = {
    folderId: '',
    volume: 1,
  };

  let current = { ...defaults };

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

  // Initialize on load
  load();

  return { get, set, update, load };
})();
