/**
 * The cross-session "already exported" index.
 *
 * Prospecting the same city twice a month is normal, and re-pitching a business
 * you exported three weeks ago is the embarrassment this exists to prevent. The
 * index outlives sessions; the session itself does not.
 *
 * Stays local, like everything else. It holds place ids and a timestamp — no
 * names, no addresses, nothing about the business itself.
 *
 * Capped at 50k entries, evicted oldest-first. A Map preserves insertion order,
 * so recency order is free and eviction is taking from the front.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;

  /** @type {Map<string, number>} place id -> when it was last exported */
  let entries = new Map();
  let loaded = null;
  let dirty = false;
  let saveTimer = 0;

  function load() {
    if (loaded) return loaded;
    loaded = new Promise(function (resolve) {
      chrome.storage.local.get([K.STORAGE.EXPORTED_INDEX], function (data) {
        if (chrome.runtime.lastError) {
          resolve();
          return;
        }
        const saved = data && data[K.STORAGE.EXPORTED_INDEX];
        if (saved && saved.version === K.STORAGE_VERSION && Array.isArray(saved.entries)) {
          entries = new Map();
          for (let i = 0; i < saved.entries.length; i += 1) {
            const e = saved.entries[i];
            if (e && e.id) entries.set(e.id, e.at || 0);
          }
        }
        resolve();
      });
    });
    return loaded;
  }

  function persistNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    if (!dirty) return;
    dirty = false;
    const list = [];
    entries.forEach(function (at, id) {
      list.push({ id: id, at: at });
    });
    const payload = { version: K.STORAGE_VERSION, savedAt: Date.now(), entries: list };
    chrome.storage.local.set({ [K.STORAGE.EXPORTED_INDEX]: payload }, function () {
      if (chrome.runtime.lastError) {
        dirty = true;
        if (MLE.debugLog) {
          MLE.debugLog.log('index:write-failed', {
            error: String(chrome.runtime.lastError.message || ''),
            size: list.length
          });
        }
      }
    });
  }

  function schedulePersist() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      persistNow();
    }, K.PERSIST_DEBOUNCE_MS);
  }

  function has(placeId) {
    return !!placeId && entries.has(placeId);
  }

  /** When it was last exported, or null. */
  function at(placeId) {
    return entries.has(placeId) ? entries.get(placeId) : null;
  }

  /**
   * Record ids as exported.
   * @returns {{added: number, refreshed: number, evicted: number}}
   */
  function add(placeIds) {
    const now = Date.now();
    let added = 0;
    let refreshed = 0;

    for (let i = 0; i < placeIds.length; i += 1) {
      const id = placeIds[i];
      if (!id) continue;
      if (entries.has(id)) {
        // Re-inserting moves it to the back, which is what keeps eviction
        // oldest-first rather than first-ever-seen.
        entries.delete(id);
        refreshed += 1;
      } else {
        added += 1;
      }
      entries.set(id, now);
    }

    let evicted = 0;
    while (entries.size > K.EXPORTED_INDEX_MAX) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
      evicted += 1;
    }

    if (added || refreshed) schedulePersist();
    return { added: added, refreshed: refreshed, evicted: evicted };
  }

  function size() {
    return entries.size;
  }

  function clear() {
    entries = new Map();
    dirty = true;
    persistNow();
  }

  /** The whole index, oldest first, for the options page's export. */
  function all() {
    const out = [];
    entries.forEach(function (when, id) {
      out.push({ placeId: id, exportedAt: when });
    });
    return out;
  }

  MLE.exportedIndex = { load, has, at, add, size, clear, all, flush: persistNow };
})(typeof self !== 'undefined' ? self : this);
