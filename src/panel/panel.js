/**
 * Side panel controller.
 *
 * Owns presentation only: it renders whatever the service worker reports and
 * sends back user intent. It never touches the Maps tab and never parses.
 */
(function (root) {
  'use strict';

  const MLE = root.MLE;
  const K = MLE.K;
  const T = MLE.text;

  const el = {};
  [
    'stateDot', 'statusLine', 'count',
    'banner', 'bannerTitle', 'bannerText', 'bannerAction',
    'stateView', 'stateArt', 'stateTitle', 'stateText', 'stateAction',
    'list', 'sizer',
    'resolve', 'resolveDot', 'resolveText',
    'exportBtn', 'pauseBtn', 'pauseIcon', 'clearBtn',
    'confirm', 'confirmText', 'confirmNo', 'confirmYes',
    'diag', 'healthLine', 'diagGrid', 'copyDiag',
    'openNext', 'openNextCount', 'accelChip',
    'filters', 'filtersBadge', 'filtersCount', 'filtersReset', 'websiteSeg',
    'fMaxRating', 'fMaxReviews', 'fRadius', 'fCategory', 'fName', 'fKeepUnknown',
    'fExcludeExported', 'fExcludeExportedRow',
    'copyBtn', 'columnsBtn', 'columnsPanel', 'columnsList',
    'columnsAll', 'columnsDefault', 'columnsDone',
    'presetsRow', 'presetChips', 'presetSave', 'presetNameRow',
    'presetName', 'presetConfirm', 'presetCancel',
    'toast', 'rowTemplate'
  ].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  /** @type {object[]} every collected row, in the order they were seen */
  let rows = [];
  /** placeId -> index into `rows`, so a delta update is O(1) */
  const indexOf = new Map();
  let state = { state: K.STATE.CONNECTING, count: 0, health: {}, query: '' };
  let port = null;
  let toastTimer = 0;

  function msg(key, subs) {
    try {
      return chrome.i18n.getMessage(key, subs) || '';
    } catch (_) {
      return '';
    }
  }

  /* --------------------------------------------------------------------- i18n */

  function applyStaticText() {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      const text = msg(node.getAttribute('data-i18n'));
      if (text) node.textContent = text;
    });
    el.exportBtn.title = msg('btnExport');
    el.clearBtn.title = msg('btnClear');
    el.clearBtn.setAttribute('aria-label', msg('btnClear'));
    el.copyBtn.title = msg('btnCopy');
    el.copyBtn.setAttribute('aria-label', msg('btnCopy'));
    el.columnsBtn.setAttribute('aria-expanded', 'false');
  }

  /* ---------------------------------------------------------------------- list */

  const list = MLE.VirtualList({
    container: el.list,
    sizer: el.sizer,
    rowHeight: 64, // grows to ROW_HEIGHT_CONTACT once enrichment starts

    createRow: function () {
      return el.rowTemplate.content.firstElementChild.cloneNode(true);
    },
    renderRow: renderRow
  });

  function renderRow(node, row) {
    if (!row) return;

    const name = node.querySelector('.row-name');
    name.textContent = row.name;
    name.title = row.name;

    // Carried over from a previous session's export, so the user can see why
    // a row is here (or ask why it is not).
    const badge = node.querySelector('.row-exported');
    if (row.exportedAt) {
      badge.hidden = false;
      badge.textContent = msg('rowExported');
      badge.title = msg('rowExportedHint', [new Date(row.exportedAt).toLocaleDateString()]);
    } else {
      badge.hidden = true;
      badge.title = '';
    }

    const rating = node.querySelector('.row-rating');
    const ratingVal = node.querySelector('.row-rating-val');
    if (row.rating != null) {
      rating.hidden = false;
      // Review counts are absent on some verticals; showing the rating alone is
      // the honest rendering of "Maps did not say".
      ratingVal.textContent =
        ' ' + row.rating + (row.reviewCount != null ? ' · ' + T.formatCount(row.reviewCount) : '');
      rating.title = row.reviewCount != null ? '' : msg('noReviews');
    } else {
      rating.hidden = true;
      rating.title = msg('noRating');
    }

    const meta = node.querySelector('.row-meta');
    const parts = [];
    if (row.category) parts.push(row.category);
    if (row.addressLine) parts.push(row.addressLine);
    if (parts.length) {
      meta.textContent = parts.join(' · ');
      meta.title = meta.textContent;
      meta.classList.remove('faint');
    } else {
      meta.textContent = msg('noAddress');
      meta.title = '';
      meta.classList.add('faint');
    }

    const source = (row.provenance && row.provenance.website) || K.SOURCE.CARD;
    const pill = node.querySelector('.pill');
    pill.dataset.website = row.website;
    pill.dataset.source = source;
    if (row.website === K.WEBSITE.HAS) {
      pill.textContent = msg('websiteHas');
    } else if (row.website === K.WEBSITE.NONE) {
      pill.textContent = msg('websiteNone');
    } else {
      pill.textContent = msg('websiteUnknown');
    }
    // The tooltip is where has/none stops being a label and starts being a
    // claim with a basis: read off a card, or proven on the place's own page.
    pill.title =
      row.website === K.WEBSITE.UNKNOWN
        ? msg('websiteUnknownHint')
        : source === K.SOURCE.DETAIL
          ? msg('websiteConfirmedHint')
          : msg('websiteFromCardHint');

    const phone = node.querySelector('.row-phone');
    const site = node.querySelector('.row-site');
    phone.textContent = row.phone || '';
    if (row.websiteUrl) {
      site.textContent = prettyHost(row.websiteUrl);
      site.title = row.websiteUrl;
    } else {
      site.textContent = '';
      site.title = '';
    }

    // Enrichment status, so a partial read never looks like a clean one and
    // "nothing happened" is visible rather than inferred.
    const status = node.querySelector('.row-status');
    const enrich = row.enrich;
    // Before anything is enriched the third line is not drawn at all, and a
    // wall of "not opened" would be noise rather than signal.
    status.hidden = !contactMode;
    if (!enrich && row.aliasRepair === 'unrepairable') {
      // Opening this place can never fill it in, so say that rather than
      // leaving the user clicking at a row that will never respond.
      status.dataset.state = 'unrepairable';
      status.textContent = msg('rowStatusUnrepairable');
      status.title = msg('rowStatusUnrepairableHint');
    } else if (!enrich) {
      status.dataset.state = 'never';
      status.textContent = msg('rowStatusNever');
      status.title = msg('rowStatusNeverHint');
    } else if (enrich.state === 'partial') {
      status.dataset.state = 'partial';
      status.textContent = msg('rowStatusPartial');
      status.title = msg('rowStatusPartialHint', [(enrich.missing || []).join(', ')]);
    } else {
      status.dataset.state = 'ok';
      status.textContent = msg('rowStatusOk');
      status.title = msg('rowStatusOkHint');
    }
  }

  /** "https://www.lovenlatte.com/" -> "lovenlatte.com" */
  function prettyHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return url;
    }
  }

  const ROW_HEIGHT_PLAIN = 64;
  const ROW_HEIGHT_CONTACT = 82;
  /** True once the session has anything to show on the third line. */
  let contactMode = false;

  /**
   * Rows grow a contact line the moment the session has any contact data to
   * show, and every row shares that height so windowing stays arithmetic.
   */
  function syncRowHeight() {
    // Enrichment counts even when it yielded nothing: a place the user opened
    // that produced no phone still needs somewhere to say so.
    contactMode = rows.some(function (r) {
      return r.phone || r.websiteUrl || r.enrich;
    });
    list.setRowHeight(contactMode ? ROW_HEIGHT_CONTACT : ROW_HEIGHT_PLAIN);
  }

  /* -------------------------------------------------------------- filtering */

  let filters = MLE.filters.empty();
  /** Rows after filtering: what the list shows and what export writes. */
  let shown = [];
  /** Median centre of the session, recomputed when the row set changes. */
  let centre = null;
  let lastExcludedUnknown = 0;
  let lastExcludedExported = 0;
  /** Coverage is reported once per session, not on every recompute. */
  let coverageLogged = false;

  function recompute() {
    centre = MLE.geo.centroid(rows);
    const result = MLE.filters.apply(rows, filters, {
      centre: centre,
      crossSessionDedupe: MLE.entitlements.has('crossSessionDedupe')
    });
    shown = result.rows;
    lastExcludedUnknown = result.excludedUnknown;
    lastExcludedExported = result.excludedExported;
    list.setItems(shown);
  }

  function setRows(next) {
    rows = next;
    indexOf.clear();
    for (let i = 0; i < rows.length; i += 1) indexOf.set(rows[i].placeId, i);
    syncRowHeight();
    recompute();
    reportCoverage();
  }

  function applyDelta(added, updated) {
    for (let i = 0; i < updated.length; i += 1) {
      const at = indexOf.get(updated[i].placeId);
      if (at != null) rows[at] = updated[i];
    }
    for (let i = 0; i < added.length; i += 1) {
      indexOf.set(added[i].placeId, rows.length);
      rows.push(added[i]);
    }
    syncRowHeight();
    // Filters apply to new rows too, so the visible set is always recomputed
    // rather than appended to.
    recompute();
    reportCoverage();
  }

  /**
   * Coordinate coverage, logged once per session.
   *
   * The distance column is only as trustworthy as this number. If half the rows
   * carry no coordinates, a radius filter is holding half the session in
   * "unknown", and that should be visible in diagnostics rather than inferred.
   */
  function reportCoverage() {
    if (coverageLogged || rows.length < 5) return;
    coverageLogged = true;
    send({ type: K.MSG.GEO_COVERAGE, coverage: MLE.geo.coverage(rows) });
  }

  /** How many rows still have no confirmed answer on the website question. */
  function unresolvedCount() {
    let n = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].website === K.WEBSITE.UNKNOWN) n += 1;
    }
    return n;
  }

  function renderResolve(count) {
    if (!count) {
      el.resolve.hidden = true;
      return;
    }
    const left = unresolvedCount();
    el.resolve.hidden = false;
    el.resolve.dataset.done = left === 0 ? 'true' : 'false';
    el.resolveText.textContent = left
      ? msg('unresolvedSome', [T.formatCount(left)]) + ' — ' + msg('unresolvedHow')
      : msg('unresolvedNone');
  }

  /* -------------------------------------------------------------------- states */

  const TONE = {};
  TONE[K.STATE.COLLECTING] = 'live';
  TONE[K.STATE.SESSION_FULL] = 'warn';
  TONE[K.STATE.CAPTCHA] = 'warn';
  TONE[K.STATE.LAYOUT_CHANGED] = 'warn';
  TONE[K.STATE.DISCONNECTED] = 'warn';

  const STATUS_KEY = {};
  STATUS_KEY[K.STATE.COLLECTING] = 'statusCollecting';
  STATUS_KEY[K.STATE.CONNECTING] = 'statusConnecting';
  STATUS_KEY[K.STATE.PAUSED] = 'statusPaused';
  STATUS_KEY[K.STATE.CAPTCHA] = 'statusVerify';
  STATUS_KEY[K.STATE.DISCONNECTED] = 'statusReconnect';
  STATUS_KEY[K.STATE.NOT_MAPS] = 'statusNotMaps';
  STATUS_KEY[K.STATE.SESSION_FULL] = 'statusSessionFull';
  STATUS_KEY[K.STATE.LAYOUT_CHANGED] = 'statusLayoutChanged';
  STATUS_KEY[K.STATE.VIEWING_PLACE] = 'statusViewingPlace';

  /**
   * What, if anything, needs explaining right now.
   * @returns {{title:string, text:string, action?:{label:string, run:function}, tone?:string}|null}
   */
  function describe(s) {
    const healthPercent = percentOf(s.health);

    switch (s.state) {
      case K.STATE.NOT_MAPS:
        return {
          title: msg('notMapsTitle'),
          text: msg('notMapsBody'),
          action: { label: msg('notMapsCta'), run: openMaps },
          tone: 'accent'
        };
      case K.STATE.DISCONNECTED:
        return { title: msg('reconnectTitle'), text: msg('reconnectBody') };
      case K.STATE.CAPTCHA:
        return {
          title: msg('verifyTitle'),
          text: msg('verifyBody'),
          action: { label: msg('verifyResume'), run: resume }
        };
      case K.STATE.LAYOUT_CHANGED:
        return {
          title: msg('layoutChangedTitle'),
          text: msg('layoutChangedBody', [healthPercent || '0%']),
          action: { label: msg('verifyResume'), run: resume }
        };
      case K.STATE.SESSION_FULL:
        return {
          title: msg('sessionFullTitle'),
          text: msg('sessionFullBody', [T.formatCount(s.max || K.SESSION_MAX_ROWS)])
        };
      case K.STATE.VIEWING_PLACE:
        // Informational, not a fault: this is what enriching looks like.
        return {
          title: msg('viewingPlaceTitle'),
          text: msg('viewingPlaceBody'),
          tone: 'accent'
        };
      case K.STATE.PAUSED:
        return { title: msg('statusPaused'), text: msg('pausedNotice'), tone: 'accent' };
      default:
        return null;
    }
  }

  /** The filter summary line, and the badge on the collapsed control. */
  function renderFilters() {
    const active = MLE.filters.isActive(filters);
    el.filtersBadge.textContent = active ? T.formatCount(shown.length) : '';
    el.filtersBadge.hidden = !active;

    const parts = [];
    if (active) parts.push(msg('filterShowing', [T.formatCount(shown.length), T.formatCount(rows.length)]));
    if (lastExcludedUnknown) parts.push(msg('filterExcludedUnknown', [T.formatCount(lastExcludedUnknown)]));
    if (lastExcludedExported) {
      parts.push(msg('filterExcludedExported', [T.formatCount(lastExcludedExported)]));
    }
    el.filtersCount.textContent = parts.join(' · ');

    el.fExcludeExported.checked = filters.excludeExported;
    // Nothing to hide yet, so the control would only raise questions.
    el.fExcludeExportedRow.hidden = !lastExcludedExported && !rows.some(function (r) {
      return r.exportedAt;
    });

    // A radius filter is meaningless without coordinates to measure from.
    el.fRadius.disabled = !centre;
    el.filters.hidden = rows.length === 0;
  }

  function render() {
    const s = state;
    const count = shown.length;

    el.stateDot.dataset.tone = TONE[s.state] || 'idle';
    el.statusLine.textContent = msg(STATUS_KEY[s.state] || 'statusIdle');
    el.count.textContent = T.formatCount(count);

    const note = describe(s);

    // With no rows there is nothing to sit behind a banner, so the explanation
    // becomes the whole panel. With rows, the list stays put and the note
    // narrows to a banner above it.
    renderResolve(count);

    if (count === 0) {
      el.list.hidden = true;
      el.banner.hidden = true;
      el.resolve.hidden = true;
      el.stateView.hidden = false;
      // Filtered down to nothing is a different situation from having collected
      // nothing, and telling the user to go scroll Maps would be wrong advice.
      const filteredOut = rows.length > 0 && MLE.filters.isActive(filters);
      const empty = filteredOut
        ? {
            title: msg('filterNoMatches'),
            text: msg('filterNoMatchesBody'),
            action: { label: msg('filterReset'), run: function () { el.filtersReset.click(); } }
          }
        : note || { title: msg('emptyTitle'), text: msg('emptyBody') };
      el.stateTitle.textContent = empty.title;
      el.stateText.textContent = empty.text;
      setAction(el.stateAction, empty.action);
      el.stateArt.innerHTML = '';
      el.stateArt.appendChild(artFor(s.state, !note));
    } else {
      el.stateView.hidden = true;
      el.list.hidden = false;
      if (note) {
        el.banner.hidden = false;
        el.banner.dataset.tone = note.tone || 'warn';
        el.bannerTitle.textContent = note.title;
        el.bannerText.textContent = note.text;
        setAction(el.bannerAction, note.action);
      } else {
        el.banner.hidden = true;
      }
    }

    el.exportBtn.disabled = count === 0;
    el.copyBtn.disabled = count === 0;
    el.columnsBtn.title = msg('columnsBtn') + ' — ' + msg('columnsCount', [String(columnKeys.length)]);
    el.columnsBtn.setAttribute('aria-label', el.columnsBtn.title);

    const paused = s.state === K.STATE.PAUSED;
    el.pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    el.pauseBtn.title = paused ? msg('btnResume') : msg('btnPause');
    el.pauseBtn.setAttribute('aria-label', el.pauseBtn.title);
    renderPauseIcon(paused);

    // Clearing throws away the whole session, not just what is on screen, so it
    // follows the session count rather than the filtered one.
    el.clearBtn.disabled = rows.length === 0;
    renderFilters();
    renderAccelerator(s);
    renderDiagnostics(s, rows.length);
  }

  /**
   * The accelerator control.
   *
   * Disabled while a pane is being read — that is red line 8's gate, surfaced
   * so the user can see it rather than wonder why a press did nothing. The
   * count is informational; pressing still opens exactly one.
   */
  function renderAccelerator(s) {
    let remaining = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.enrich && row.aliasRepair !== 'unrepairable' && row.website === K.WEBSITE.UNKNOWN) {
        remaining += 1;
      }
    }

    const usable = remaining > 0 && s.canRelay !== false;
    el.openNext.hidden = !usable && !s.relayBusy;
    el.openNext.disabled = !!s.relayBusy || !usable;
    el.openNext.title = msg('btnOpenNextHint');

    const label = el.openNext.querySelector('.accel-label');
    label.textContent = s.relayBusy ? msg('btnOpenNextBusy') : msg('btnOpenNext');
    el.openNextCount.textContent = s.relayBusy ? '' : T.formatCount(remaining);

    // The chip names what just happened, in the accelerator's own words rather
    // than a red alert floating over the list.
    if (relayChip) {
      el.accelChip.hidden = false;
      el.accelChip.textContent = msg(relayChip.key);
      el.accelChip.dataset.tone = relayChip.tone;
    } else {
      el.accelChip.hidden = true;
    }
  }

  function setAction(button, action) {
    if (!action) {
      button.hidden = true;
      button.onclick = null;
      return;
    }
    button.hidden = false;
    button.textContent = action.label;
    button.onclick = action.run;
  }

  function renderPauseIcon(paused) {
    // Pause bars while running, a play triangle once paused.
    el.pauseIcon.textContent = '';
    const ns = 'http://www.w3.org/2000/svg';
    if (paused) {
      const play = document.createElementNS(ns, 'path');
      play.setAttribute('d', 'M5 3.2 12.2 8 5 12.8Z');
      play.setAttribute('fill', 'currentColor');
      el.pauseIcon.appendChild(play);
    } else {
      [4, 9].forEach(function (x) {
        const bar = document.createElementNS(ns, 'rect');
        bar.setAttribute('x', String(x));
        bar.setAttribute('y', '3');
        bar.setAttribute('width', '3');
        bar.setAttribute('height', '10');
        bar.setAttribute('rx', '1');
        bar.setAttribute('fill', 'currentColor');
        el.pauseIcon.appendChild(bar);
      });
    }
  }

  /** A quiet piece of line art so the empty panel is composed, not blank. */
  function artFor(stateName, isEmptyList) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('width', '40');
    svg.setAttribute('height', '40');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');

    if (stateName === K.STATE.NOT_MAPS || isEmptyList) {
      // A pin over a list: where the rows will come from.
      path.setAttribute(
        'd',
        'M24 8a7 7 0 0 1 7 7c0 5-7 13-7 13s-7-8-7-13a7 7 0 0 1 7-7Zm0 5.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2ZM12 34h24M12 40h16'
      );
    } else {
      // A plug pulled apart: something needs reconnecting.
      path.setAttribute('d', 'M18 30 8 40M30 18 40 8M20 12l16 16-6 6a6 6 0 0 1-8 0l-8-8a6 6 0 0 1 0-8Z');
    }

    svg.appendChild(path);
    return svg;
  }

  function percentOf(health) {
    if (!health || health.ratio == null) return '';
    return Math.round(health.ratio * 100) + '%';
  }

  function renderDiagnostics(s, count) {
    const health = s.health || {};
    const percent = percentOf(health);

    if (percent) {
      el.healthLine.textContent = msg('healthLabel', [percent]);
      el.healthLine.dataset.tone =
        health.ratio != null && health.ratio < K.PARSE_HEALTH_MIN ? 'warn' : '';
    } else {
      el.healthLine.textContent = msg('diagnosticsToggle');
      el.healthLine.dataset.tone = '';
    }

    // Only rebuild the open drawer; it is a disclosure, not a live readout.
    if (!el.diag.open) return;

    const entries = [
      [msg('healthLabel', [percent || '0%']), msg('healthDetail', [
        T.formatCount(health.parsed || 0),
        T.formatCount(health.seen || 0)
      ])],
      [msg('diagSession'), T.formatCount(count) + ' / ' + T.formatCount(s.max || K.SESSION_MAX_ROWS)],
      [msg('diagQuery'), s.query || msg('diagNone')],
      [msg('diagIdSources'), formatIdSources(health.idSources)]
    ];

    el.diagGrid.textContent = '';
    entries.forEach(function (pair) {
      const dt = document.createElement('dt');
      dt.textContent = pair[0];
      const dd = document.createElement('dd');
      dd.textContent = pair[1];
      el.diagGrid.appendChild(dt);
      el.diagGrid.appendChild(dd);
    });
  }

  function formatIdSources(sources) {
    if (!sources) return msg('diagNone');
    const keys = Object.keys(sources);
    if (!keys.length) return msg('diagNone');
    return keys
      .sort(function (a, b) {
        return sources[b] - sources[a];
      })
      .map(function (k) {
        return k + ' ' + sources[k];
      })
      .join(', ');
  }

  /* -------------------------------------------------------------------- toast */

  function toast(text, tone) {
    el.toast.textContent = text;
    el.toast.dataset.tone = tone || '';
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.hidden = true;
    }, tone === 'error' ? 5200 : 2600);
  }

  /* ------------------------------------------------------------------ actions */

  function openMaps() {
    chrome.tabs.create({ url: 'https://www.google.com/maps' });
  }

  function send(message) {
    if (!port) return;
    try {
      port.postMessage(message);
    } catch (_) {
      /* worker restarting; the next state push will resync */
    }
  }

  function resume() {
    send({ type: K.MSG.TOGGLE_PAUSE, paused: false });
  }

  function togglePause() {
    send({ type: K.MSG.TOGGLE_PAUSE, paused: state.state !== K.STATE.PAUSED });
  }

  function askClear() {
    if (!rows.length) return;
    el.confirmText.textContent = msg('btnClearConfirm', [T.formatCount(rows.length)]);
    el.confirm.hidden = false;
    el.confirmYes.focus();
  }

  function closeConfirm() {
    el.confirm.hidden = true;
    el.clearBtn.focus();
  }

  function doClear() {
    send({ type: K.MSG.CLEAR });
    closeConfirm();
  }

  /**
   * Build the CSV in the panel rather than the worker: a document can mint a
   * blob URL, a service worker cannot.
   */
  /**
   * Distance is derived, not stored: stamped at output time against the centre
   * the panel is actually showing, so it can never disagree with the UI.
   */
  function stampDistances(list) {
    for (let i = 0; i < list.length; i += 1) {
      list[i].distanceKm = MLE.geo.distanceFrom(centre, list[i]);
    }
  }

  function exportCsv() {
    if (!shown.length) {
      toast(msg('exportEmpty'));
      return;
    }

    // Export what is on screen. A filter the user can see is a filter they
    // meant; silently writing the unfiltered session would be a nasty surprise.
    // Free-tier gate. Under BETA_ALL_FREE every branch here reports "allowed",
    // but the path is live so M3's flip is a constant change and nothing else.
    const gate = MLE.entitlements.checkExport(state.exportUsage, shown.length);
    if (!gate.allowed) {
      toast(msg('capDailyReached', [String(MLE.entitlements.exportsPerDay())]), 'error');
      return;
    }
    if (gate.willTruncate) {
      toast(msg('capRowsTruncated', [
        T.formatCount(gate.rowLimit), T.formatCount(shown.length)
      ]));
    }

    const limit = gate.rowLimit;
    const slice = limit === Infinity ? shown : shown.slice(0, limit);
    stampDistances(slice);

    let url;
    try {
      const csv = MLE.csv.build(slice, { columns: columnKeys });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      url = URL.createObjectURL(blob);
    } catch (err) {
      console.error('[MapsLeadExport] could not build the CSV:', err);
      toast(msg('exportFailed'), 'error');
      return;
    }

    const filename = MLE.csv.filename(state.query);
    el.exportBtn.disabled = true;
    el.exportBtn.textContent = msg('btnExporting');

    chrome.downloads.download({ url: url, filename: filename, saveAs: false }, function (id) {
      el.exportBtn.textContent = msg('btnExport');
      el.exportBtn.disabled = rows.length === 0;

      if (chrome.runtime.lastError || id == null) {
        console.error('[MapsLeadExport] download failed:', chrome.runtime.lastError);
        toast(msg('exportFailed'), 'error');
        URL.revokeObjectURL(url);
        return;
      }
      toast(msg('exportedToast', [T.formatCount(slice.length)]));
      send({
        type: K.MSG.NOTE_EXPORT,
        count: slice.length,
        // What actually left the machine, so the index records exactly that
        // and not the whole session.
        placeIds: slice.map(function (r) { return r.placeId; }).filter(Boolean)
      });
      revokeWhenDone(id, url);
    });
  }

  /**
   * Hold the blob URL until Chrome has finished reading it. Revoking too early
   * interrupts the download; never revoking leaks the buffer for the life of
   * the panel.
   */
  function revokeWhenDone(downloadId, url) {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      URL.revokeObjectURL(url);
    }
    function onChanged(delta) {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') finish();
    }
    chrome.downloads.onChanged.addListener(onChanged);
    setTimeout(finish, 120000);
  }

  /* --------------------------------------------------------------------- wire */

  el.exportBtn.addEventListener('click', exportCsv);
  el.pauseBtn.addEventListener('click', togglePause);
  el.clearBtn.addEventListener('click', askClear);
  el.confirmNo.addEventListener('click', closeConfirm);
  el.confirmYes.addEventListener('click', doClear);
  el.diag.addEventListener('toggle', function () {
    if (el.diag.open) renderDiagnostics(state, rows.length);
  });
  el.copyDiag.addEventListener('click', copyDiagnostics);

  /* ------------------------------------------------ columns and clipboard */

  /** Chosen column keys. Persisted so a sheet keeps its shape between runs. */
  let columnKeys = MLE.csv.DEFAULT_KEYS.slice();

  function loadColumns() {
    try {
      chrome.storage.local.get([K.STORAGE.COLUMNS], function (data) {
        if (chrome.runtime.lastError) return;
        const saved = data && data[K.STORAGE.COLUMNS];
        if (Array.isArray(saved) && saved.length) columnKeys = saved;
        buildColumnList();
        render();
      });
    } catch (_) {
      buildColumnList();
    }
  }

  function saveColumns() {
    try {
      chrome.storage.local.set({ [K.STORAGE.COLUMNS]: columnKeys });
    } catch (_) {
      /* a failed preference write is not worth interrupting an export for */
    }
  }

  function buildColumnList() {
    el.columnsList.textContent = '';
    MLE.csv.COLUMNS.forEach(function (col) {
      const label = document.createElement('label');
      label.className = 'fcheck';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = columnKeys.indexOf(col.key) !== -1;
      box.addEventListener('change', function () {
        const at = columnKeys.indexOf(col.key);
        if (box.checked && at === -1) columnKeys.push(col.key);
        else if (!box.checked && at !== -1) columnKeys.splice(at, 1);
        saveColumns();
        render();
      });

      const text = document.createElement('span');
      text.textContent = col.header;

      label.appendChild(box);
      label.appendChild(text);
      el.columnsList.appendChild(label);
    });
  }

  function setColumns(keys) {
    columnKeys = keys.slice();
    saveColumns();
    buildColumnList();
    render();
  }

  el.columnsBtn.addEventListener('click', function () {
    el.columnsPanel.hidden = !el.columnsPanel.hidden;
    el.columnsBtn.setAttribute('aria-expanded', el.columnsPanel.hidden ? 'false' : 'true');
  });
  el.columnsDone.addEventListener('click', function () {
    el.columnsPanel.hidden = true;
    el.columnsBtn.setAttribute('aria-expanded', 'false');
  });
  el.columnsAll.addEventListener('click', function () {
    setColumns(MLE.csv.COLUMNS.map(function (c) { return c.key; }));
  });
  el.columnsDefault.addEventListener('click', function () {
    setColumns(MLE.csv.DEFAULT_KEYS);
  });

  /**
   * Clipboard TSV: the same rows and columns as the export, as text a
   * spreadsheet pastes straight into cells.
   */
  function copyRows() {
    if (!shown.length) {
      toast(msg('exportEmpty'));
      return;
    }
    stampDistances(shown);
    const text = MLE.csv.buildTsv(shown, { columns: columnKeys });
    navigator.clipboard.writeText(text).then(
      function () {
        toast(msg('copiedToast', [T.formatCount(shown.length)]));
      },
      function () {
        toast(msg('copyFailed'), 'error');
      }
    );
  }

  el.copyBtn.addEventListener('click', copyRows);

  /* ---------------------------------------------------------- filter wiring */

  function numOrNull(input) {
    const v = input.value.trim();
    if (!v) return null;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function readFilters() {
    filters.maxRating = numOrNull(el.fMaxRating);
    filters.maxReviews = numOrNull(el.fMaxReviews);
    filters.radiusKm = numOrNull(el.fRadius);
    filters.category = el.fCategory.value.trim();
    filters.name = el.fName.value.trim();
    filters.keepUnknown = el.fKeepUnknown.checked;
    recompute();
    render();
  }

  ['fMaxRating', 'fMaxReviews', 'fRadius', 'fCategory', 'fName'].forEach(function (id) {
    el[id].addEventListener('input', readFilters);
  });
  el.fKeepUnknown.addEventListener('change', readFilters);
  el.fKeepUnknown.title = msg('filterKeepUnknownHint');
  el.fExcludeExported.addEventListener('change', function () {
    filters.excludeExported = el.fExcludeExported.checked;
    recompute();
    render();
  });

  el.websiteSeg.addEventListener('click', function (event) {
    const btn = event.target && event.target.closest ? event.target.closest('[data-website]') : null;
    if (!btn) return;
    filters.website = btn.getAttribute('data-website');
    syncWebsiteSeg();
    recompute();
    render();
  });

  function syncWebsiteSeg() {
    const buttons = el.websiteSeg.querySelectorAll('[data-website]');
    for (let i = 0; i < buttons.length; i += 1) {
      const on = buttons[i].getAttribute('data-website') === filters.website;
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /* --------------------------------------------------------------- presets */

  /** Push the current filter object back into the controls. */
  function writeFiltersToUi() {
    el.fMaxRating.value = filters.maxRating == null ? '' : String(filters.maxRating);
    el.fMaxReviews.value = filters.maxReviews == null ? '' : String(filters.maxReviews);
    el.fRadius.value = filters.radiusKm == null ? '' : String(filters.radiusKm);
    el.fCategory.value = filters.category || '';
    el.fName.value = filters.name || '';
    el.fKeepUnknown.checked = filters.keepUnknown !== false;
    el.fExcludeExported.checked = filters.excludeExported !== false;
    syncWebsiteSeg();
  }

  function renderPresets() {
    if (!MLE.entitlements.has('savedPresets')) {
      el.presetsRow.hidden = true;
      el.presetSave.hidden = true;
      return;
    }
    el.presetSave.hidden = false;

    const items = MLE.presets.all();
    el.presetsRow.hidden = items.length === 0;
    el.presetChips.textContent = '';

    items.forEach(function (preset) {
      const chip = document.createElement('span');
      chip.className = 'preset-chip';

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'preset-apply';
      apply.textContent = preset.name;
      apply.title = msg('presetApplyHint');
      apply.addEventListener('click', function () {
        const restored = MLE.presets.get(preset.name);
        if (!restored) return;
        filters = restored;
        writeFiltersToUi();
        recompute();
        render();
      });

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'preset-remove';
      drop.textContent = '×';
      drop.title = msg('presetRemoveHint');
      drop.setAttribute('aria-label', msg('presetRemoveHint') + ': ' + preset.name);
      drop.addEventListener('click', function () {
        MLE.presets.remove(preset.name);
        toast(msg('presetRemoved', [preset.name]));
        renderPresets();
      });

      chip.appendChild(apply);
      chip.appendChild(drop);
      el.presetChips.appendChild(chip);
    });
  }

  el.presetSave.addEventListener('click', function () {
    el.presetNameRow.hidden = false;
    el.presetName.placeholder = msg('presetNamePlaceholder');
    el.presetName.focus();
  });
  el.presetCancel.addEventListener('click', function () {
    el.presetNameRow.hidden = true;
    el.presetName.value = '';
  });
  el.presetConfirm.addEventListener('click', savePreset);
  el.presetName.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      savePreset();
    } else if (event.key === 'Escape') {
      el.presetCancel.click();
    }
    // Enter inside the name field must not reach the accelerator's binding.
    event.stopPropagation();
  });

  function savePreset() {
    const name = el.presetName.value.trim();
    const result = MLE.presets.save(name, filters);
    if (!result.ok) {
      if (result.reason === 'full') toast(msg('presetFull', [String(MLE.presets.MAX)]), 'error');
      return;
    }
    el.presetNameRow.hidden = true;
    el.presetName.value = '';
    toast(msg('presetSaved', [name]));
    renderPresets();
  }

  el.filtersReset.addEventListener('click', function () {
    filters = MLE.filters.empty();
    el.fMaxRating.value = '';
    el.fMaxReviews.value = '';
    el.fRadius.value = '';
    el.fCategory.value = '';
    el.fName.value = '';
    el.fKeepUnknown.checked = true;
    syncWebsiteSeg();
    recompute();
    render();
  });

  /**
   * Row click -> open that place in Maps (E1 ruling).
   *
   * This is the gesture the collector relays 1:1 to the card's own link. The
   * panel originates nothing on its own: there is no queue, no "open all", and
   * no follow-up request after a result comes back. One human click, one relay.
   */
  let openToken = 0;

  function requestOpen(row, via) {
    const aliases = [row.placeId, row.ftid, row.mid].filter(Boolean);
    if (!aliases.length) return;
    openToken += 1;
    send({
      type: K.MSG.OPEN_ROW,
      aliases: aliases,
      token: String(openToken),
      placeId: row.placeId,
      via: via || 'row',
      // Stamped here, at the gesture, so the collector can refuse anything
      // that is not the direct consequence of this click.
      gestureAt: Date.now()
    });
  }

  function rowFromEvent(event) {
    const node = event.target && event.target.closest ? event.target.closest('.row') : null;
    if (!node || node.__index == null || node.__index < 0) return null;
    return rows[node.__index] || null;
  }

  el.list.addEventListener('click', function (event) {
    const row = rowFromEvent(event);
    if (row) requestOpen(row);
  });

  el.list.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = rowFromEvent(event);
    if (!row) return;
    event.preventDefault();
    requestOpen(row);
  });

  /* ------------------------------------------------- open-next accelerator */

  /**
   * The next row worth opening: still unresolved, and actually openable.
   *
   * Rows marked unrepairable are skipped — they can never match a pane, so
   * offering them would strand the user on a row that cannot respond.
   */
  function nextUnenriched() {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.enrich) continue;
      if (row.aliasRepair === 'unrepairable') continue;
      if (row.website !== K.WEBSITE.UNKNOWN) continue;
      if (!row.placeId && !row.ftid && !row.mid) continue;
      return row;
    }
    return null;
  }

  /**
   * One press, one navigation.
   *
   * This is the accelerator in full. It picks the next row and fires exactly
   * the same relay a row-click does. There is deliberately no loop, no queue
   * and no timer here: the control re-enables when the pane finishes, and the
   * next place opens only because a human pressed again.
   */
  function openNext() {
    if (state.relayBusy || !state.canRelay) return;
    const row = nextUnenriched();
    if (!row) {
      toast(msg('accelNoneLeft'));
      return;
    }
    // A fresh press supersedes whatever the last one had to say.
    setRelayChip(null);
    requestOpen(row, 'accel');
  }

  el.openNext.addEventListener('click', openNext);

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    // Only when the press is not already meant for something else.
    const active = document.activeElement;
    if (active && active !== document.body && active.closest('.list, button, details, input')) return;
    if (el.openNext.disabled) return;
    event.preventDefault();
    openNext();
  });

  /**
   * What the accelerator says about its own last attempt.
   *
   * These are chip states, not alerts. Most of them describe work in progress —
   * Maps is being scrolled, or a pruned card is coming back — and a red toast
   * for those read as failure when nothing had failed. Only the genuine dead
   * end, a feed re-rendered out from under us, asks the user to do anything.
   */
  const RELAY_CHIP = {
    positioned: { key: 'relayPositioning', tone: 'working' },
    pruned: { key: 'relayRestoring', tone: 'working' },
    'relink-timeout': { key: 'relayScrollToIt', tone: 'ask' },
    'not-rendered': { key: 'relayScrollToIt', tone: 'ask' },
    'activation-noop': { key: 'relayNoop', tone: 'ask' },
    'pane-timeout': { key: 'relayPaneTimeout', tone: 'ask' },
    'stale-gesture': { key: 'relayStale', tone: 'ask' },
    busy: { key: 'relayBusyChip', tone: 'working' }
  };

  /** Cleared on the next press, or when a pane finally reads. */
  let relayChip = null;

  function setRelayChip(reason) {
    relayChip = reason ? RELAY_CHIP[reason] || { key: 'relayUnknown', tone: 'ask' } : null;
    renderAccelerator(state);
  }

  /**
   * Hand the user a self-contained report they can paste into an issue.
   *
   * Local only: it goes to their clipboard and nowhere else. Nothing is
   * uploaded, and the buffer holds identifiers and counts rather than rows.
   */
  let pendingReport = null;

  function copyDiagnostics() {
    pendingReport = function (report) {
      const text = JSON.stringify(report, null, 2);
      navigator.clipboard.writeText(text).then(
        function () {
          toast(msg('diagCopied'));
        },
        function () {
          console.log('[MapsLeadExport] diagnostics:\n' + text);
          toast(msg('diagCopyFailed'), 'error');
        }
      );
    };
    send({ type: K.MSG.DEBUG_REPORT });
  }

  // Escape hatch for when the clipboard is blocked: callable from the console.
  root.mleDiagnostics = function () {
    return new Promise(function (resolve) {
      pendingReport = resolve;
      send({ type: K.MSG.DEBUG_REPORT });
    });
  };

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !el.confirm.hidden) closeConfirm();
  });

  /* --------------------------------------------------------------------- port */

  function connect() {
    port = chrome.runtime.connect({ name: K.PORT.PANEL });

    port.onMessage.addListener(function (message) {
      if (!message) return;
      if (message.type === K.MSG.SNAPSHOT) {
        state = message.state || state;
        setRows(message.rows || []);
        render();
      } else if (message.type === K.MSG.DELTA) {
        state = message.state || state;
        applyDelta(message.added || [], message.updated || []);
        render();
      } else if (message.type === K.MSG.STATE) {
        state = message.state || state;
        render();
      } else if (message.type === K.MSG.OPEN_RESULT) {
        state = message.state || state;
        // Success while positioning still shows a chip, because the user just
        // watched Maps scroll and deserves to know that was us.
        setRelayChip(message.ok ? (message.how === 'positioned' ? 'positioned' : null) : message.reason);
        render();
      } else if (message.type === K.MSG.RELAY_REARM) {
        state = message.state || state;
        // Re-armed: the card is back and the control is pressable. Nothing
        // opens until the user presses again.
        setRelayChip(message.ok ? null : 'relink-timeout');
        render();
      } else if (message.type === K.MSG.DEBUG_REPORT) {
        const deliver = pendingReport;
        pendingReport = null;
        if (deliver) deliver(message.report);
      }
    });

    port.onDisconnect.addListener(function () {
      port = null;
      // The worker idles out; reconnecting on demand is normal, not an error.
      setTimeout(connect, 250);
    });

    send({ type: K.MSG.PANEL_HELLO });
  }

  applyStaticText();
  buildColumnList();
  loadColumns();
  syncWebsiteSeg();
  MLE.presets.load().then(renderPresets);
  render();
  connect();
})(typeof self !== 'undefined' ? self : this);
