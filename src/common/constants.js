/**
 * Shared constants. Loaded into the service worker (importScripts), the side
 * panel (<script>) and the injected content scripts (executeScript).
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});

  MLE.K = Object.freeze({
    /** Bumped whenever the persisted session shape changes. */
    STORAGE_VERSION: 1,
    /** Selector map schema the parser understands. */
    SELECTOR_SCHEMA_VERSION: 1,

    /** Hard cap on rows held in one collection session. */
    SESSION_MAX_ROWS: 2000,

    /** Free-tier caps. Scaffolded in M1, enforced in M3. */
    FREE_ROWS_PER_EXPORT: 25,
    FREE_EXPORTS_PER_DAY: 2,

    /**
     * If fewer than this share of visible result cards parse, we stop and say
     * so rather than silently exporting garbage.
     */
    PARSE_HEALTH_MIN: 0.5,
    /** Don't judge health until we've seen at least this many cards. */
    PARSE_HEALTH_MIN_SAMPLE: 8,

    /** Coalescing windows, in ms. */
    RESCAN_DEBOUNCE_MS: 150,
    SCROLL_THROTTLE_MS: 250,
    POST_BATCH_MS: 120,
    FEED_RECHECK_MS: 1000,
    PERSIST_DEBOUNCE_MS: 1200,

    PORT: Object.freeze({
      COLLECTOR: 'mle.collector',
      PANEL: 'mle.panel'
    }),

    MSG: Object.freeze({
      // service worker -> collector
      INIT: 'init',
      SET_PAUSED: 'setPaused',
      // collector -> service worker
      HELLO: 'hello',
      ROWS: 'rows',
      DETAIL: 'detail',
      HEALTH: 'health',
      CAPTCHA: 'captcha',
      CONTEXT: 'context',
      // panel <-> service worker
      PANEL_HELLO: 'panel:hello',
      SNAPSHOT: 'snapshot',
      DELTA: 'delta',
      STATE: 'state',
      CLEAR: 'clear',
      TOGGLE_PAUSE: 'togglePause',
      NOTE_EXPORT: 'noteExport'
    }),

    STORAGE: Object.freeze({
      SESSION: 'mle.session.v1',
      EXPORTS: 'mle.exports.v1'
    }),

    /** Tri-state website presence. `unknown` is a first-class answer. */
    WEBSITE: Object.freeze({
      HAS: 'has',
      NONE: 'none',
      UNKNOWN: 'unknown'
    }),

    /** Why we believe the website value we recorded. */
    WEBSITE_REASON: Object.freeze({
      CHIP: 'chip',
      CHIP_ROW_WITHOUT_WEBSITE: 'chip-row-without-website',
      NO_CHIP_ROW: 'no-chip-row',
      DETAIL_LINK: 'detail-link',
      DETAIL_NO_LINK: 'detail-no-link'
    }),

    /** Where a field came from. Level 2 adds `detail` in M2. */
    SOURCE: Object.freeze({
      CARD: 'card',
      DETAIL: 'detail'
    }),

    /** How long after an injection we say "starting" rather than "reconnect". */
    CONNECT_GRACE_MS: 4000,

    /**
     * When the user opens a place, the pane hydrates over a few hundred ms.
     * These are re-read attempts on the pane they already opened; they stop at
     * the first successful read. Nothing here opens anything, and nothing
     * advances to another place — see red line 8.
     */
    DETAIL_READ_DELAYS_MS: [0, 350, 900, 1800, 3200],

    /** Consecutive bad-health scans before we call the layout broken. */
    HEALTH_STRIKES: 2,

    /** Panel-facing collection state. */
    STATE: Object.freeze({
      NOT_MAPS: 'notMaps',
      CONNECTING: 'connecting',
      DISCONNECTED: 'disconnected',
      COLLECTING: 'collecting',
      PAUSED: 'paused',
      CAPTCHA: 'captcha',
      SESSION_FULL: 'sessionFull',
      LAYOUT_CHANGED: 'layoutChanged'
    })
  });

  /** Google Maps URL test. No host permissions — this only ever runs on a URL
   *  we were handed by a user gesture (activeTab) or by the collector itself. */
  MLE.isMapsUrl = function isMapsUrl(url) {
    if (!url) return false;
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return false;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    // google.com, google.co.uk, google.de, maps.google.com, ...
    const isGoogleHost = /^(www\.|maps\.)?google(\.[a-z]{2,3}){1,2}$/.test(host);
    if (!isGoogleHost) return false;
    return host.startsWith('maps.') || u.pathname.startsWith('/maps');
  };
})(typeof self !== 'undefined' ? self : this);
