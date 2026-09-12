/* ============================================================================
 * storage.js — saving the building setup between visits.
 *
 * Only configuration is written to disk: building names, categories and the
 * names of the areas being watched. Live sensor values are deliberately left
 * out, so a reopened dashboard never shows a reading that is hours old.
 *
 * Nothing here stores credentials. Broker usernames and passwords stay in
 * config.js and are never persisted.
 * ========================================================================== */

window.SHD = window.SHD || {};

SHD.storage = (function () {
  "use strict";

  var keys = SHD.config.storageKeys;

  // Some browsers block local storage (private mode, embedded frames, files
  // opened over strict policies). Fall back to memory so the dashboard still
  // runs — it just forgets the setup when the tab closes.
  var memory = {};
  var persistent = (function () {
    try {
      var probe = "__shd_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  })();

  function readRaw(key) {
    if (!persistent) return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeRaw(key, value) {
    if (!persistent) { memory[key] = value; return; }
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      memory[key] = value;
    }
  }

  function removeRaw(key) {
    if (!persistent) { delete memory[key]; return; }
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      delete memory[key];
    }
  }

  function parse(raw, fallback) {
    if (!raw) return fallback;
    try {
      var value = JSON.parse(raw);
      return value && typeof value === "object" ? value : fallback;
    } catch (err) {
      return fallback;
    }
  }

  return {
    /** True when the setup will survive a page refresh. */
    isPersistent: function () { return persistent; },

    loadBuildings: function () {
      return parse(readRaw(keys.state), null);
    },

    saveBuildings: function (payload) {
      writeRaw(keys.state, JSON.stringify(payload));
    },

    loadPrefs: function () {
      return parse(readRaw(keys.prefs), {});
    },

    savePrefs: function (prefs) {
      writeRaw(keys.prefs, JSON.stringify(prefs));
    },

    clearAll: function () {
      removeRaw(keys.state);
      removeRaw(keys.prefs);
    }
  };
})();
