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
  /** Level-2: the URL we last reacted to, and the pending hydration re-reads. */
  let lastUrl = '';
  let detailTimers = [];
  /** The one relayed row-click currently allowed to be outstanding, if any. */
  let relayInFlight = null;
  let relayTimer = 0;
  /**
   * Whether the last scan's element passed the results-feed identity test.
   * Starts null so the first scan always reports, and only transitions are
   * announced afterwards.
   */
  let lastIdentified = null;

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

    // An element with role="feed" that holds no place links is not the results
    // list. Say so once per transition rather than scoring it as a total parse
    // failure, which is what used to trip the layout-changed banner.
    if (result.stats.identified !== lastIdentified) {
      lastIdentified = result.stats.identified;
      post({
        type: K.MSG.FEED_IDENTITY,
        identified: result.stats.identified,
        placeLinks: result.stats.placeLinks || 0,
        children: result.stats.children || 0,
        viewingPlace: /\/maps\/place\//.test(location.pathname)
      });
    }

    if (!result.stats.identified) {
      // No denominator, so no health report and therefore no strike.
      return;
    }

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

  /* ------------------------------------------------------------------- detail */

  /**
   * Level-2 enrichment, passive.
   *
   * We notice that the user has opened a place and read the pane they are
   * already looking at. We never open one. Under escalation E1 in
   * docs/RED-LINES.md the extension initiates no navigation at all, so there is
   * deliberately no code path here that changes the tab's location, activates a
   * link, or moves on to another place.
   *
   * The retry ladder exists only because the pane hydrates asynchronously; it
   * targets the single URL the user navigated to and stops at the first
   * successful read. It is not advancement, and it cannot become advancement:
   * every attempt re-checks that the URL is still the one the user opened.
   */
  function clearDetailTimers() {
    for (let i = 0; i < detailTimers.length; i += 1) clearTimeout(detailTimers[i]);
    detailTimers = [];
  }

  /** Free the single-relay lock. Nothing here starts another one. */
  function releaseRelay() {
    if (relayTimer) {
      clearTimeout(relayTimer);
      relayTimer = 0;
    }
    relayInFlight = null;
  }

  function scheduleDetailReads() {
    const openedUrl = location.href;
    const delays = K.DETAIL_READ_DELAYS_MS;

    for (let i = 0; i < delays.length; i += 1) {
      detailTimers.push(
        setTimeout(function () {
          if (stopped || paused || !selectors) return;
          // The user has moved on; whatever we would read is not what they opened.
          if (location.href !== openedUrl) return;

          let result = null;
          try {
            result = MLE.parserL2.readDetail(document, selectors, openedUrl);
          } catch (_) {
            return;
          }
          if (!result) return; // not hydrated yet; a later attempt will catch it

          clearDetailTimers();
          // The pane has finished. That, and only that, releases the relay lock
          // — red line 8's "gated on the prior pane finishing".
          releaseRelay();
          post({
            type: K.MSG.DETAIL,
            aliases: result.aliases,
            name: result.name,
            patch: result.patch
          });
        }, delays[i])
      );
    }
  }

  /* -------------------------------------------------------------- relay (E1) */

  /**
   * Relay one panel row-click to the matching card's own link.
   *
   * Permitted by the E1 ruling: red line 2 bars machine-initiated clicks, and
   * this is the direct 1:1 relay of a fresh human gesture on our UI. The three
   * constraints below are what keep it that way, and each is enforced here
   * rather than assumed.
   */
  function relayOpen(msg) {
    // 1. The gesture must be fresh. A stale request cannot be replayed.
    const age = Date.now() - (msg.gestureAt || 0);
    if (!msg.gestureAt || age > K.RELAY_GESTURE_MAX_AGE_MS || age < -1000) {
      post({ type: K.MSG.OPEN_RESULT, ok: false, reason: 'stale-gesture', token: msg.token });
      return;
    }

    // 2. One at a time, gated on the previous pane finishing.
    if (relayInFlight) {
      post({ type: K.MSG.OPEN_RESULT, ok: false, reason: 'busy', token: msg.token });
      return;
    }

    // 3. Only cards Maps has already drawn. We never scroll to find one.
    const anchor = findRenderedCard(msg.aliases || []);
    if (!anchor) {
      post({ type: K.MSG.OPEN_RESULT, ok: false, reason: 'not-rendered', token: msg.token });
      return;
    }

    relayInFlight = { token: msg.token, at: Date.now() };
    if (relayTimer) clearTimeout(relayTimer);
    relayTimer = setTimeout(function () {
      // The pane never arrived; release the lock rather than wedging it shut.
      relayInFlight = null;
      post({ type: K.MSG.OPEN_RESULT, ok: false, reason: 'timeout', token: msg.token });
    }, K.RELAY_TIMEOUT_MS);

    post({ type: K.MSG.OPEN_RESULT, ok: true, token: msg.token });
    anchor.click();
  }

  /**
   * Find the currently rendered card matching any of these identifiers.
   *
   * Reads only what is on screen. If the user has scrolled the card out of the
   * feed there is no match and the panel says so — hunting for it by scrolling
   * is exactly what the boundary in the E1 ruling forbids.
   */
  function findRenderedCard(aliases) {
    if (!feed || !feed.isConnected || !aliases.length) return null;
    const cards = MLE.parserL1.pickAll(feed, selectors.feed.card);

    for (let i = 0; i < cards.length; i += 1) {
      const link = MLE.parserL1.pick(cards[i], selectors.feed.placeLink);
      if (!link) continue;
      const href = link.href || link.getAttribute('href') || '';
      const ids = MLE.placeId.extractIdentifiers(href, '');
      for (let j = 0; j < aliases.length; j += 1) {
        const a = aliases[j];
        if (a && (a === ids.placeId || a === ids.ftid || a === ids.mid)) return link;
      }
    }
    return null;
  }

  /** Cheap URL-change check, run from the existing recheck tick. */
  function watchUrl() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    clearDetailTimers();
    if (/\/maps\/place\//.test(location.pathname)) scheduleDetailReads();
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
    // Re-announce identity for the new element rather than inheriting the last
    // one's verdict.
    lastIdentified = null;

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
    // INIT arrives again every time the user re-clicks the toolbar icon, so
    // this must be idempotent or each click strands another 1s interval.
    if (recheckTimer) clearInterval(recheckTimer);
    recheckTimer = setInterval(function () {
      if (stopped) return;
      if (paused) return;
      // Opening a place is a URL change, so this same tick is what notices the
      // user has done it. No separate observer, no body-wide subtree watch.
      watchUrl();
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
      // lastUrl starts empty, so this first tick also enriches a place the user
      // already had open when they activated the panel.
      watchUrl();
      post({ type: K.MSG.CONTEXT, query: readQuery(), url: location.href });
      return;
    }
    if (msg.type === K.MSG.OPEN_ROW) {
      relayOpen(msg);
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
    clearDetailTimers();
    releaseRelay();
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
      // Re-clicking the icon is the documented way to recover, so treat it as
      // an explicit resume: clear the paused state and re-report everything.
      // `resumed` tells the worker to drop its own paused flag too — clearing
      // only the local one leaves the panel reading "Paused" while we collect.
      post({ type: K.MSG.HELLO, url: location.href, resumed: true });
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
