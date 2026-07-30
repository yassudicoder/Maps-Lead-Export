/**
 * The collection session: rows deduped by place id, capped, and persisted to
 * chrome.storage.local.
 *
 * Data stays on the machine. Nothing here talks to a network.
 *
 * The in-memory Map is the source of truth while the worker is alive and
 * doubles as the ordering (Map preserves insertion order, and re-setting an
 * existing key keeps its original position, so the list stays in the order the
 * user actually saw the businesses). Storage is a debounced mirror so an
 * idle-terminated worker can pick the session straight back up.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;

  /** @type {Map<string, object>} */
  let rows = new Map();
  let query = '';
  let loaded = null;
  let persistTimer = 0;
  let dirty = false;

  function load() {
    if (loaded) return loaded;
    loaded = new Promise(function (resolve) {
      chrome.storage.local.get([K.STORAGE.SESSION], function (data) {
        if (chrome.runtime.lastError) {
          resolve();
          return;
        }
        const saved = data && data[K.STORAGE.SESSION];
        if (saved && saved.version === K.STORAGE_VERSION && Array.isArray(saved.rows)) {
          rows = new Map();
          for (let i = 0; i < saved.rows.length; i += 1) {
            const row = saved.rows[i];
            if (row && row.placeId) rows.set(row.placeId, row);
          }
          query = saved.query || '';
        }
        resolve();
      });
    });
    return loaded;
  }

  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = 0;
    }
    if (!dirty) return;
    dirty = false;
    const payload = {
      version: K.STORAGE_VERSION,
      savedAt: Date.now(),
      query: query,
      rows: Array.from(rows.values())
    };
    chrome.storage.local.set({ [K.STORAGE.SESSION]: payload }, function () {
      // A quota failure must not be silent: mark dirty again so the next
      // change retries, and let the caller surface it if it keeps failing.
      if (chrome.runtime.lastError) dirty = true;
    });
  }

  function schedulePersist() {
    dirty = true;
    if (persistTimer) return;
    persistTimer = setTimeout(function () {
      persistTimer = 0;
      persistNow();
    }, K.PERSIST_DEBOUNCE_MS);
  }

  function isFull() {
    return rows.size >= K.SESSION_MAX_ROWS;
  }

  /**
   * Merge freshly parsed rows.
   *
   * A row already held is replaced only when something actually changed, so the
   * panel's delta stream stays quiet while the user scrolls back over results
   * they have already passed.
   *
   * @returns {{added: object[], updated: object[], full: boolean, dropped: number}}
   */
  function addRows(incoming) {
    const added = [];
    const updated = [];
    let dropped = 0;

    for (let i = 0; i < incoming.length; i += 1) {
      const row = incoming[i];
      if (!row || !row.placeId || !row.name) continue;

      const existing = rows.get(row.placeId);
      if (existing) {
        // Keep the original collectedAt: it records when the user first saw
        // this business, which is the thing worth knowing.
        row.collectedAt = existing.collectedAt;
        if (!changed(existing, row)) continue;
        rows.set(row.placeId, row);
        updated.push(row);
        continue;
      }

      if (isFull()) {
        dropped += 1;
        continue;
      }
      rows.set(row.placeId, row);
      added.push(row);
    }

    if (added.length || updated.length) schedulePersist();
    return { added: added, updated: updated, full: isFull(), dropped: dropped };
  }

  const COMPARED = [
    'name',
    'category',
    'addressLine',
    'rating',
    'reviewCount',
    'website',
    'websiteReason',
    'placeUrl',
    'level'
  ];

  function changed(a, b) {
    for (let i = 0; i < COMPARED.length; i += 1) {
      if (a[COMPARED[i]] !== b[COMPARED[i]]) return true;
    }
    return false;
  }

  function setQuery(next) {
    if (!next || next === query) return false;
    query = next;
    schedulePersist();
    return true;
  }

  function clear() {
    rows = new Map();
    query = '';
    dirty = true;
    persistNow();
  }

  MLE.sessionStore = {
    load: load,
    addRows: addRows,
    setQuery: setQuery,
    clear: clear,
    isFull: isFull,
    flush: persistNow,
    all: function () {
      return Array.from(rows.values());
    },
    size: function () {
      return rows.size;
    },
    query: function () {
      return query;
    }
  };
})(typeof self !== 'undefined' ? self : this);
