/**
 * Service worker: injection, message routing, session state.
 *
 * Holds no host permissions. The only path to a Maps tab is the user clicking
 * the toolbar icon, which grants activeTab for that tab and lets us inject the
 * collector once. Maps is a single-page app, so one click covers the session;
 * a hard navigation drops the grant and the panel asks for another click.
 */
/* global importScripts */
'use strict';

importScripts(
  '../common/constants.js',
  '../common/text.js',
  '../common/debug-log.js',
  '../common/place-id.js',
  '../common/selector-schema.js',
  '../common/entitlements.js',
  './session-store.js'
);

const K = self.MLE.K;
const store = self.MLE.sessionStore;

/* ------------------------------------------------------------------ selectors */

let selectorMap = null;
let selectorsReady = null;

/**
 * Load the bundled selector map.
 *
 * The worker owns this rather than the content script, because a content
 * script fetching an extension resource would require declaring it web
 * accessible against a URL pattern — and we ship zero host permissions. The
 * worker reads its own package freely and hands the validated map over the
 * port. M4's remote refresh slots in here, behind the same validator.
 */
function loadSelectors() {
  if (selectorsReady) return selectorsReady;
  selectorsReady = fetch(chrome.runtime.getURL('config/selectors.json'))
    .then((r) => r.json())
    .then((raw) => {
      const checked = self.MLE.selectorSchema.validate(raw);
      if (!checked.ok) {
        console.error('[MapsLeadExport] bundled selector map is invalid:', checked.errors);
        selectorMap = null;
        return null;
      }
      selectorMap = checked.value;
      return selectorMap;
    })
    .catch((err) => {
      console.error('[MapsLeadExport] could not load selector map:', err);
      selectorMap = null;
      return null;
    });
  return selectorsReady;
}

/* ---------------------------------------------------------------------- state */

/** Live collector ports, keyed by tab id. */
const collectors = new Map();
/** Live panel ports. */
const panels = new Set();

const runtime = {
  paused: false,
  captcha: false,
  layoutBroken: false,
  healthStrikes: 0,
  health: { seen: 0, parsed: 0, idSources: {} },
  lastInjectAt: 0,
  lastClickWasMaps: null,
  droppedSelectors: []
};

function resolveState() {
  if (runtime.captcha) return K.STATE.CAPTCHA;
  if (runtime.layoutBroken) return K.STATE.LAYOUT_CHANGED;
  if (runtime.paused) return K.STATE.PAUSED;
  if (collectors.size > 0) return store.isFull() ? K.STATE.SESSION_FULL : K.STATE.COLLECTING;
  if (runtime.lastClickWasMaps === false) return K.STATE.NOT_MAPS;
  if (Date.now() - runtime.lastInjectAt < K.CONNECT_GRACE_MS) return K.STATE.CONNECTING;
  return K.STATE.DISCONNECTED;
}

function stateSnapshot() {
  const seen = runtime.health.seen;
  return {
    state: resolveState(),
    paused: runtime.paused,
    full: store.isFull(),
    count: store.size(),
    max: K.SESSION_MAX_ROWS,
    query: store.query(),
    health: {
      seen: seen,
      parsed: runtime.health.parsed,
      ratio: seen ? runtime.health.parsed / seen : null,
      idSources: runtime.health.idSources
    },
    droppedSelectors: runtime.droppedSelectors
  };
}

function broadcast(message) {
  panels.forEach(function (p) {
    try {
      p.postMessage(message);
    } catch (_) {
      panels.delete(p);
    }
  });
}

function broadcastState() {
  broadcast({ type: K.MSG.STATE, state: stateSnapshot() });
}

/* ------------------------------------------------------------------ injection */

const CONTENT_FILES = [
  'src/common/constants.js',
  'src/common/text.js',
  'src/common/place-id.js',
  'src/common/selector-schema.js',
  'src/content/parser-level1.js',
  'src/content/parser-level2.js',
  'src/content/collector.js'
];

function inject(tabId) {
  runtime.lastInjectAt = Date.now();
  chrome.scripting.executeScript(
    { target: { tabId: tabId }, files: CONTENT_FILES },
    function () {
      if (chrome.runtime.lastError) {
        // Most often: the tab navigated between the click and the injection, so
        // the activeTab grant no longer covers it.
        console.warn('[MapsLeadExport] injection failed:', chrome.runtime.lastError.message);
        broadcastState();
      }
    }
  );
}

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || tab.id == null) return;

  // activeTab is granted by this very click, which is what makes tab.url
  // readable here without a host permission. If it still comes back empty we
  // inject anyway and let the collector decide from its own location — it
  // reports back and stands down when the page is not Maps.
  const urlKnown = typeof tab.url === 'string' && tab.url.length > 0;
  const isMaps = urlKnown ? self.MLE.isMapsUrl(tab.url) : true;
  runtime.lastClickWasMaps = urlKnown ? isMaps : null;

  const windowId = tab.windowId;
  chrome.sidePanel
    .open(windowId != null ? { windowId: windowId } : { tabId: tab.id })
    .catch(function (err) {
      console.warn('[MapsLeadExport] could not open the side panel:', err);
    });

  if (isMaps) {
    inject(tab.id);
  } else {
    broadcastState();
  }
});

// The panel is opened explicitly above so that a click on a non-Maps tab can
// still show the "open Maps to start" state instead of silently doing nothing.
chrome.runtime.onInstalled.addListener(function () {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(function () {
    /* older builds ignore this; the explicit open above still works */
  });
});

/* ------------------------------------------------------------------- health */

function noteHealth(stats) {
  runtime.health = stats;
  const enoughSample = stats.seen >= K.PARSE_HEALTH_MIN_SAMPLE;
  const ratio = stats.seen ? stats.parsed / stats.seen : 1;

  if (enoughSample && ratio < K.PARSE_HEALTH_MIN) {
    runtime.healthStrikes += 1;
    if (runtime.healthStrikes >= K.HEALTH_STRIKES && !runtime.layoutBroken) {
      // Stop collecting rather than quietly filling the sheet with rows we do
      // not trust. Existing rows are untouched and still exportable.
      runtime.layoutBroken = true;
      setCollectorsPaused(true);
    }
  } else {
    runtime.healthStrikes = 0;
  }
}

function setCollectorsPaused(paused) {
  collectors.forEach(function (port) {
    try {
      port.postMessage({ type: K.MSG.SET_PAUSED, paused: paused });
    } catch (_) {
      /* port closing */
    }
  });
}

/* -------------------------------------------------------------------- ports */

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name === K.PORT.COLLECTOR) {
    handleCollector(port);
  } else if (port.name === K.PORT.PANEL) {
    handlePanel(port);
  }
});

function handleCollector(port) {
  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (tabId == null) return;

  collectors.set(tabId, port);

  port.onDisconnect.addListener(function () {
    collectors.delete(tabId);
    if (collectors.size === 0) {
      // Nothing is watching any more; a CAPTCHA or pause on a dead tab should
      // not keep the panel in that state forever.
      runtime.captcha = false;
      runtime.layoutBroken = false;
      runtime.healthStrikes = 0;
      runtime.health = { seen: 0, parsed: 0, idSources: {} };
    }
    store.flush();
    broadcastState();
  });

  port.onMessage.addListener(function (msg) {
    if (!msg) return;

    switch (msg.type) {
      case K.MSG.HELLO:
        if (msg.notMaps) {
          // The collector looked at its own location and bowed out.
          runtime.lastClickWasMaps = false;
          broadcastState();
          return;
        }
        runtime.lastClickWasMaps = true;
        runtime.captcha = false;
        runtime.layoutBroken = false;
        runtime.healthStrikes = 0;
        // A re-click is an explicit resume; the collector has already cleared
        // its own flag and would otherwise be collecting behind a "Paused" UI.
        if (msg.resumed) runtime.paused = false;
        Promise.all([loadSelectors(), store.load()]).then(function () {
          if (!selectorMap) {
            broadcastState();
            return;
          }
          try {
            port.postMessage({ type: K.MSG.INIT, selectors: selectorMap });
          } catch (_) {
            /* tab closed mid-handshake */
          }
          broadcastState();
        });
        break;

      case K.MSG.ROWS:
        store.load().then(function () {
          const result = store.addRows(msg.rows || []);
          if (msg.query) store.setQuery(msg.query);
          if (result.added.length || result.updated.length) {
            broadcast({
              type: K.MSG.DELTA,
              added: result.added,
              updated: result.updated,
              state: stateSnapshot()
            });
          } else {
            broadcastState();
          }
        });
        break;

      case K.MSG.DETAIL:
        self.MLE.debugLog.log('detail:received', {
          aliases: msg.aliases || [],
          name: msg.name || '',
          fields: Object.keys(msg.patch || {})
        });
        store.load().then(function () {
          const row = store.applyDetail(msg.aliases || [], msg.patch || {});
          if (!row) {
            // The user opened a place we never collected, or the row predates
            // aliasing. Either way the store has already logged why.
            broadcastState();
            return;
          }
          broadcast({
            type: K.MSG.DELTA,
            added: [],
            updated: [row],
            state: stateSnapshot()
          });
        });
        break;

      case K.MSG.HEALTH:
        noteHealth({
          seen: msg.seen || 0,
          parsed: msg.parsed || 0,
          idSources: msg.idSources || {}
        });
        broadcastState();
        break;

      case K.MSG.CAPTCHA:
        runtime.captcha = !!msg.present;
        broadcastState();
        break;

      case K.MSG.CONTEXT:
        if (msg.droppedSelectors && msg.droppedSelectors.length) {
          runtime.droppedSelectors = msg.droppedSelectors;
          console.warn('[MapsLeadExport] dropped unparsable selectors:', msg.droppedSelectors);
        }
        if (msg.query) {
          store.load().then(function () {
            store.setQuery(msg.query);
            broadcastState();
          });
        }
        break;

      default:
        break;
    }
  });
}

function handlePanel(port) {
  panels.add(port);

  port.onDisconnect.addListener(function () {
    panels.delete(port);
    store.flush();
  });

  port.onMessage.addListener(function (msg) {
    if (!msg) return;

    switch (msg.type) {
      case K.MSG.PANEL_HELLO:
        Promise.all([loadSelectors(), store.load()]).then(function () {
          try {
            port.postMessage({
              type: K.MSG.SNAPSHOT,
              rows: store.all(),
              state: stateSnapshot()
            });
          } catch (_) {
            panels.delete(port);
          }
        });
        break;

      case K.MSG.TOGGLE_PAUSE: {
        const next = typeof msg.paused === 'boolean' ? msg.paused : !runtime.paused;
        runtime.paused = next;
        if (!next) {
          // Resuming clears the conditions that forced the stop; the collector
          // re-checks the page for itself before trusting it again.
          runtime.captcha = false;
          runtime.layoutBroken = false;
          runtime.healthStrikes = 0;
        }
        setCollectorsPaused(next);
        broadcastState();
        break;
      }

      case K.MSG.CLEAR:
        store.load().then(function () {
          store.clear();
          broadcast({ type: K.MSG.SNAPSHOT, rows: [], state: stateSnapshot() });
        });
        break;

      case K.MSG.NOTE_EXPORT:
        self.MLE.debugLog.log('export', { rows: msg.count || 0 });
        noteExport(msg.count || 0);
        break;

      case K.MSG.DEBUG_REPORT:
        store.load().then(function () {
          try {
            port.postMessage({
              type: K.MSG.DEBUG_REPORT,
              report: self.MLE.debugLog.report({
                rowsHeld: store.size(),
                unresolved: store.unresolvedCount(),
                query: store.query(),
                state: resolveState(),
                collectorsConnected: collectors.size,
                selectorsLoaded: !!selectorMap,
                droppedSelectors: runtime.droppedSelectors
              })
            });
          } catch (_) {
            panels.delete(port);
          }
        });
        break;

      default:
        break;
    }
  });
}

/**
 * Record an export against today's free-tier allowance.
 *
 * Nothing is gated in M1 (BETA_ALL_FREE), but the counter runs now so M3 has
 * real history to gate on rather than starting from zero.
 */
function noteExport(count) {
  chrome.storage.local.get([K.STORAGE.EXPORTS], function (data) {
    if (chrome.runtime.lastError) return;
    const today = self.MLE.entitlements.today();
    const prev = (data && data[K.STORAGE.EXPORTS]) || {};
    const next =
      prev.day === today
        ? { day: today, count: (prev.count || 0) + 1, rows: (prev.rows || 0) + count }
        : { day: today, count: 1, rows: count };
    chrome.storage.local.set({ [K.STORAGE.EXPORTS]: next });
  });
}

// Warm the map and the session as soon as the worker spins up, so the first
// click does not pay for the load.
loadSelectors();
store.load();
