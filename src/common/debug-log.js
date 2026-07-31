/**
 * Local debug ring buffer.
 *
 * "It isn't working" has to be diagnosable from the user's own machine without
 * a debugger attached and without anyone guessing. Every meaningful event in
 * the collect -> match -> enrich chain lands here, and the panel can export the
 * lot as JSON.
 *
 * Stays local. Nothing is transmitted; this is a buffer in worker memory that
 * the user copies to their own clipboard, and it holds no row content beyond
 * the identifiers needed to explain a match failure.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const LIMIT = 200;

  /** @type {Array<{t: number, type: string, data: object}>} */
  let events = [];
  let seq = 0;

  function log(type, data) {
    seq += 1;
    events.push({ n: seq, t: Date.now(), type: type, data: data || {} });
    if (events.length > LIMIT) events = events.slice(events.length - LIMIT);
  }

  function all() {
    return events.slice();
  }

  function clear() {
    events = [];
  }

  /**
   * A self-contained report: the event trail plus the environment facts needed
   * to interpret it. Version and locale matter because a stale session or a
   * different Maps UI language changes what "working" looks like.
   */
  function report(extra) {
    let version = '';
    try {
      version = chrome.runtime.getManifest().version;
    } catch (_) {
      /* not in an extension context */
    }
    return {
      generatedAt: new Date().toISOString(),
      extensionVersion: version,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      uiLanguage: (function () {
        try {
          return chrome.i18n.getUILanguage();
        } catch (_) {
          return '';
        }
      })(),
      context: extra || {},
      events: all()
    };
  }

  MLE.debugLog = { log, all, clear, report, LIMIT };
})(typeof self !== 'undefined' ? self : this);
