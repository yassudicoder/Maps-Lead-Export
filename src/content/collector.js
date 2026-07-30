/**
 * Collector: the only code that touches the Maps page.
 *
 * It watches the results feed the user is already scrolling and posts parsed
 * rows to the service worker. It does not scroll, click, paginate, open places,
 * or fetch anything. Every row it reports was on screen in the user's own tab.
 *
 * Injected by chrome.scripting.executeScript under the activeTab grant, so it
 * only ever runs on a tab the user pointed at by clicking the toolbar icon.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;
  const T = MLE.text;

  // Re-injection is normal: clicking the icon again on an already-live tab.
  // Announce and stand down rather than starting a second observer.
  if (root.__MLE_COLLECTOR__) {
    root.__MLE_COLLECTOR__.reannounce();
    return;
  }

  /* -------------------------------------------------------------- local state */

  let selectors = null;
  let port = null;
  let feed = null;
  let feedObserver = null;
  let recheckTimer = 0;
  let rescanTimer = 0;
  let flushTimer = 0;
  let lastScrollScan = 0;
  let paused = false;
  let captchaSeen = false;
  let stopped = false;

  /** placeId -> fingerprint of the last row we sent, so we post only changes. */
  const sent = new Map();
  /** Rows waiting for the next batched post. */
  let pending = new Map();
  /** Rolling parse-health counters for the current feed. */
  let health = { seen: 0, parsed: 0, idSources: {} };

  /* ------------------------------------------------------------------ helpers */

  function now() {
    return Date.now();
  }

  /** Cheap change detector; avoids re-posting identical rows every rescan. */
  function fingerprint(row) {
    return [
      row.name,
      row.category,
      row.addressLine,
      row.rating,
      row.reviewCount,
      row.website
    ].join('');
  }

  function post(message) {
    if (!port) return;
    try {
      port.postMessage(message);
    } catch (_) {
      // Worker went away mid-send; the disconnect handler cleans up.
    }
  }

  /* ------------------------------------------------------------------ context */

  /** The query the user typed, for row attribution and the export filename. */
  function readQuery() {
    const input = MLE.parserL1.pick(document, (selectors.context && selectors.context.searchInput) || []);
    const typed = input && input.value ? T.clean(input.value) : '';
    if (typed) return typed;

    // Fall back to the URL: /maps/search/plumbers+in+austin+tx/@30.4,...
    const m = location.pathname.match(/\/maps\/search\/([^/@]+)/);
    if (m && m[1]) {
      try {
        return T.clean(decodeURIComponent(m[1]).replace(/\+/g, ' '));
      } catch (_) {
        return T.clean(m[1].replace(/\+/g, ' '));
      }
    }
    return '';
  }

  /* ------------------------------------------------------------------ captcha */

  /**
   * Red line: we never touch a CAPTCHA. If one appears we stop collecting and
   * hand the tab back to the user.
   */
  function checkCaptcha() {
    const signals = (selectors.captcha && selectors.captcha.signals) || [];
    const hit = MLE.parserL1.pick(document, signals);
    if (hit && !captchaSeen) {
      captchaSeen = true;
      paused = true;
      detachFeed();
      post({ type: K.MSG.CAPTCHA, present: true });
    }
    return captchaSeen;
  }

  /* --------------------------------------------------------------------- scan */

  function scan() {
    if (stopped || paused || !selectors) return;
    if (!feed || !feed.isConnected) {
      attachFeed();
      if (!feed) return;
    }
    if (checkCaptcha()) return;

    const ctx = { query: readQuery() };
    let result;
    try {
      result = MLE.parserL1.parseFeed(feed, selectors, ctx);
    } catch (err) {
      // A parser throw is a layout signal, not a crash: report zero health for
      // this pass and let the worker decide whether to raise the banner.
      post({ type: K.MSG.HEALTH, seen: health.seen, parsed: 0, idSources: {} });
      return;
    }

    health = result.stats;

    for (let i = 0; i < result.rows.length; i += 1) {
      const row = result.rows[i];
      const fp = fingerprint(row);
      if (sent.get(row.placeId) === fp) continue;
      sent.set(row.placeId, fp);
      pending.set(row.placeId, row);
    }

    post({
      type: K.MSG.HEALTH,
      seen: result.stats.seen,
      parsed: result.stats.parsed,
      idSources: result.stats.idSources
    });

    if (pending.size) scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = 0;
      if (!pending.size) return;
      const rows = Array.from(pending.values());
      pending = new Map();
      post({ type: K.MSG.ROWS, rows: rows, query: readQuery() });
    }, K.POST_BATCH_MS);
  }

  function scheduleScan() {
    if (rescanTimer) return;
    rescanTimer = setTimeout(function () {
      rescanTimer = 0;
      scan();
    }, K.RESCAN_DEBOUNCE_MS);
  }

  /* --------------------------------------------------------------------- feed */

  function detachFeed() {
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }
    if (feed) {
      feed.removeEventListener('scroll', onFeedScroll);
      feed = null;
    }
  }

  /**
   * Passive only. The scroll listener reacts to the user's own scrolling so
   * rows appear without waiting on the recheck tick; it never scrolls anything.
   */
  function onFeedScroll() {
    const t = now();
    if (t - lastScrollScan < K.SCROLL_THROTTLE_MS) return;
    lastScrollScan = t;
    scheduleScan();
  }

  function attachFeed() {
    const found = MLE.parserL1.pick(document, selectors.feed.container);
    if (!found) return;
    if (found === feed) return;

    detachFeed();
    feed = found;

    // A new feed means a new result set: forget fingerprints so a re-search
    // re-reports rows the worker may have never seen, and reset health.
    sent.clear();
    health = { seen: 0, parsed: 0, idSources: {} };

    feedObserver = new MutationObserver(scheduleScan);
    feedObserver.observe(feed, { childList: true, subtree: true });
    feed.addEventListener('scroll', onFeedScroll, { passive: true });

    scheduleScan();
  }

  /**
   * Maps is a single-page app that swaps the whole results pane on a new
   * search or a map pan. Watching for that with a body-wide subtree observer
   * would fire on nearly every frame Maps renders; a one-second liveness check
   * costs nothing and reattaches just as reliably.
   */
  function startRecheck() {
    recheckTimer = setInterval(function () {
      if (stopped) return;
      if (paused) return;
      if (!feed || !feed.isConnected) {
        attachFeed();
      } else if (captchaSeen) {
        checkCaptcha();
      }
    }, K.FEED_RECHECK_MS);
  }

  /* ------------------------------------------------------------------ port io */

  function onMessage(msg) {
    if (!msg) return;
    if (msg.type === K.MSG.INIT) {
      const checked = MLE.selectorSchema.compileFilter(msg.selectors, document);
      selectors = checked.value;
      if (checked.dropped.length) {
        post({ type: K.MSG.CONTEXT, droppedSelectors: checked.dropped });
      }
      attachFeed();
      startRecheck();
      post({ type: K.MSG.CONTEXT, query: readQuery(), url: location.href });
      return;
    }
    if (msg.type === K.MSG.SET_PAUSED) {
      paused = !!msg.paused;
      if (paused) {
        detachFeed();
      } else {
        // Resuming after a CAPTCHA: re-check before trusting the page again.
        captchaSeen = false;
        if (!checkCaptcha()) attachFeed();
      }
    }
  }

  function teardown() {
    if (stopped) return;
    stopped = true;
    detachFeed();
    if (recheckTimer) clearInterval(recheckTimer);
    if (rescanTimer) clearTimeout(rescanTimer);
    if (flushTimer) clearTimeout(flushTimer);
    try {
      if (port) port.disconnect();
    } catch (_) {
      /* already gone */
    }
    port = null;
    delete root.__MLE_COLLECTOR__;
  }

  function connect() {
    try {
      port = chrome.runtime.connect({ name: K.PORT.COLLECTOR });
    } catch (_) {
      // Extension reloaded or context invalidated; nothing useful to do.
      teardown();
      return;
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(function () {
      port = null;
      teardown();
    });

    // Check where we are for ourselves rather than trusting the worker's read
    // of tab.url. Say so, then leave: this is the last line of defence on
    // "only ever runs on Google Maps", and it holds even if the tab navigated
    // between the toolbar click and this injection.
    if (!MLE.isMapsUrl(location.href)) {
      post({ type: K.MSG.HELLO, notMaps: true });
      teardown();
      return;
    }

    post({ type: K.MSG.HELLO, url: location.href });
  }

  root.__MLE_COLLECTOR__ = {
    reannounce: function () {
      if (stopped) return;
      post({ type: K.MSG.HELLO, url: location.href });
      // Re-clicking the icon is the documented way to recover, so treat it as
      // an explicit resume: clear the paused state and re-report everything.
      paused = false;
      captchaSeen = false;
      sent.clear();
      attachFeed();
      scheduleScan();
    },
    teardown: teardown
  };

  // A hard navigation ends the activeTab grant with the page; clean up so we
  // never leave a dangling observer behind.
  addEventListener('pagehide', teardown, { once: true });

  connect();
})(typeof self !== 'undefined' ? self : this);
