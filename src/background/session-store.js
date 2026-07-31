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
          reindex();
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

      const existing = rows.get(row.placeId) || resolve(row.placeId);
      if (existing) {
        const merged = mergeLevel1(existing, row);
        if (!merged) continue;
        rows.set(merged.placeId, merged);
        index(merged);
        updated.push(merged);
        continue;
      }

      if (isFull()) {
        dropped += 1;
        continue;
      }
      rows.set(row.placeId, row);
      index(row);
      added.push(row);
    }

    if (added.length || updated.length) schedulePersist();
    return { added: added, updated: updated, full: isFull(), dropped: dropped };
  }

  /** Level-1 fields, i.e. everything a result card can supply. */
  const LEVEL1_FIELDS = [
    'name',
    'category',
    'addressLine',
    'rating',
    'reviewCount',
    'website',
    'websiteReason',
    'placeUrl'
  ];

  /**
   * Fold a freshly parsed Level-1 row into the stored one.
   *
   * The rule that matters: a field already proven by the detail pane is never
   * overwritten by a card read. Without this, opening a place would enrich the
   * row and the very next rescan — milliseconds later, as the user keeps
   * scrolling — would replace it wholesale with the card's thinner version and
   * silently undo the work. Provenance is what makes the distinction, which is
   * why every field carries it from M1.
   *
   * @returns {object|null} the merged row, or null when nothing changed.
   */
  function mergeLevel1(existing, incoming) {
    const merged = Object.assign({}, existing);
    const provenance = Object.assign({}, existing.provenance || {});
    let touched = false;

    for (let i = 0; i < LEVEL1_FIELDS.length; i += 1) {
      const field = LEVEL1_FIELDS[i];
      if (provenance[field] === K.SOURCE.DETAIL) continue; // earned at Level 2
      if (merged[field] === incoming[field]) continue;
      merged[field] = incoming[field];
      if (incoming.provenance && incoming.provenance[field]) {
        provenance[field] = incoming.provenance[field];
      }
      touched = true;
    }

    // Aliases only ever accumulate: a card that omits one must not erase it.
    ['ftid', 'mid', 'geo'].forEach(function (key) {
      if (!merged[key] && incoming[key]) {
        merged[key] = incoming[key];
        touched = true;
      }
    });

    if (!touched) return null;
    merged.provenance = provenance;
    // collectedAt records when the user first saw this business, so it stands.
    merged.collectedAt = existing.collectedAt;
    return merged;
  }

  /**
   * Patch a row with Level-2 fields read from a detail pane the user opened.
   *
   * Detail beats card on every field it supplies, and the patch is applied even
   * when the session is full: it enriches a row that is already held rather
   * than adding one.
   *
   * @returns {object|null} the updated row, or null if no row matched.
   */
  function applyDetail(aliases, patch) {
    let row = null;
    for (let i = 0; i < aliases.length && !row; i += 1) {
      row = rows.get(aliases[i]) || resolve(aliases[i]);
    }
    if (!row) return null;

    const merged = Object.assign({}, row);
    const provenance = Object.assign({}, row.provenance || {});
    let touched = false;

    Object.keys(patch).forEach(function (field) {
      const value = patch[field];
      if (value === undefined || value === null || value === '') return;
      if (merged[field] === value) {
        // Already correct, but record that the detail pane proved it.
        if (provenance[field] !== K.SOURCE.DETAIL) {
          provenance[field] = K.SOURCE.DETAIL;
          touched = true;
        }
        return;
      }
      merged[field] = value;
      provenance[field] = K.SOURCE.DETAIL;
      touched = true;
    });

    if (!touched) return null;
    merged.provenance = provenance;
    merged.level = 2;
    merged.enrichedAt = Date.now();
    rows.set(merged.placeId, merged);
    index(merged);
    schedulePersist();
    return merged;
  }

  /** alias -> primary placeId, so a detail pane finds its row. */
  let aliasIndex = new Map();

  function index(row) {
    if (!row || !row.placeId) return;
    ['ftid', 'mid'].forEach(function (key) {
      if (row[key]) aliasIndex.set(row[key], row.placeId);
    });
  }

  function resolve(alias) {
    const primary = aliasIndex.get(alias);
    return primary ? rows.get(primary) : null;
  }

  function reindex() {
    aliasIndex = new Map();
    rows.forEach(index);
  }

  function setQuery(next) {
    if (!next || next === query) return false;
    query = next;
    schedulePersist();
    return true;
  }

  function clear() {
    rows = new Map();
    aliasIndex = new Map();
    query = '';
    dirty = true;
    persistNow();
  }

  /** Rows the detail pane has not yet resolved — what M2's counter reports. */
  function unresolvedCount() {
    let n = 0;
    rows.forEach(function (row) {
      if (row.website === K.WEBSITE.UNKNOWN) n += 1;
    });
    return n;
  }

  MLE.sessionStore = {
    load: load,
    addRows: addRows,
    applyDetail: applyDetail,
    unresolvedCount: unresolvedCount,
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
