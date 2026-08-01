/**
 * Saved filter presets (Pro flag `savedPresets`).
 *
 * A freelancer works the same few shapes over and over — "no website, under 50
 * reviews, within 5km" is a whole prospecting method, not a one-off query. This
 * stores those shapes.
 *
 * Only filter values are stored: names the user typed and numbers they chose.
 * No rows, no place data.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;

  const MAX = 24;
  const MAX_NAME = 60;

  /** @type {Array<{name: string, filters: object, at: number}>} */
  let presets = [];
  let loaded = null;

  function load() {
    if (loaded) return loaded;
    loaded = new Promise(function (resolve) {
      chrome.storage.local.get([K.STORAGE.PRESETS], function (data) {
        if (chrome.runtime.lastError) {
          resolve(presets);
          return;
        }
        const saved = data && data[K.STORAGE.PRESETS];
        if (saved && Array.isArray(saved.items)) presets = saved.items.filter(valid);
        resolve(presets);
      });
    });
    return loaded;
  }

  function valid(p) {
    return !!p && typeof p.name === 'string' && !!p.name && !!p.filters;
  }

  function persist() {
    try {
      chrome.storage.local.set({
        [K.STORAGE.PRESETS]: { version: K.STORAGE_VERSION, items: presets }
      });
    } catch (_) {
      /* a failed preference write must not interrupt filtering */
    }
  }

  /**
   * Keep only the filter fields, and only in the shape `empty()` defines.
   *
   * Round-tripping whatever the caller passed would let a stale or hand-edited
   * record reintroduce keys the filter engine no longer understands, which is
   * how a saved preset quietly starts behaving differently from the panel.
   */
  function sanitise(filters) {
    const base = MLE.filters.empty();
    const out = {};
    Object.keys(base).forEach(function (key) {
      const value = filters ? filters[key] : undefined;
      out[key] = value === undefined ? base[key] : value;
    });
    return out;
  }

  function all() {
    return presets.slice();
  }

  /**
   * Save under a name, replacing any preset already using it.
   * @returns {{ok: boolean, reason?: string}}
   */
  function save(name, filters) {
    const clean = String(name || '').trim().slice(0, MAX_NAME);
    if (!clean) return { ok: false, reason: 'empty-name' };

    const at = presets.findIndex(function (p) {
      return p.name.toLowerCase() === clean.toLowerCase();
    });
    const record = { name: clean, filters: sanitise(filters), at: Date.now() };

    if (at !== -1) presets[at] = record;
    else if (presets.length >= MAX) return { ok: false, reason: 'full' };
    else presets.push(record);

    persist();
    return { ok: true };
  }

  function remove(name) {
    const before = presets.length;
    presets = presets.filter(function (p) {
      return p.name !== name;
    });
    if (presets.length !== before) persist();
    return presets.length !== before;
  }

  /** @returns {object|null} a fresh filter object, never the stored one. */
  function get(name) {
    const found = presets.find(function (p) {
      return p.name === name;
    });
    return found ? sanitise(found.filters) : null;
  }

  MLE.presets = { load, all, save, remove, get, sanitise, MAX, MAX_NAME };
})(typeof self !== 'undefined' ? self : this);
