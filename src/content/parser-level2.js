/**
 * Level-2 parser: reads a place detail pane that the user opened.
 *
 * It never causes a pane to appear. Under the conservative reading of red line
 * 8 currently in force (see docs/RED-LINES.md, escalation E1), the extension
 * initiates no navigation at all — this module only reads whatever the user is
 * already looking at.
 *
 * The pane anchors on `data-item-id`, which is a code value rather than display
 * text, so it holds across locales in a way that reading labels never would.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;
  const T = MLE.text;

  const pick = function (el, list) {
    return MLE.parserL1.pick(el, list);
  };

  /**
   * Read an element's own text, dropping the icon glyphs and separators Maps
   * renders inside it.
   *
   * Deliberately not the aria-label: those are localised and prefixed
   * ("Address: ...", "Phone: ...", "फ़ोन: ..."), so parsing them would mean
   * stripping a different prefix per language. The visible text is the value.
   */
  function valueOf(el, sel) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    const hidden = (sel.card && sel.card.hidden) || ['[aria-hidden="true"]'];
    for (let i = 0; i < hidden.length; i += 1) {
      let nodes;
      try {
        nodes = clone.querySelectorAll(hidden[i]);
      } catch (_) {
        continue;
      }
      for (let j = 0; j < nodes.length; j += 1) nodes[j].remove();
    }
    return T.clean(clone.textContent);
  }

  /**
   * Unwrap a Google redirect so the stored URL is the business's own.
   *
   * Pure string work on a URL we already have. Nothing is ever requested — red
   * line 4 forbids visiting third-party sites, and this module makes no network
   * calls of any kind.
   */
  function cleanWebsiteUrl(href) {
    if (!href) return '';
    let url;
    try {
      url = new URL(href, location.href);
    } catch (_) {
      return '';
    }
    if (/(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === '/url') {
      const target = url.searchParams.get('q') || url.searchParams.get('url');
      if (target) {
        try {
          const inner = new URL(target);
          if (inner.protocol === 'http:' || inner.protocol === 'https:') return inner.href;
        } catch (_) {
          /* fall through and keep the wrapper */
        }
      }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  }

  /** The phone in `data-item-id="phone:tel:09967797857"` needs no text parsing. */
  function phoneFrom(el) {
    if (!el) return '';
    const raw = el.getAttribute('data-item-id') || '';
    const m = raw.match(/^phone:tel:(.+)$/);
    return m ? T.clean(m[1]) : '';
  }

  /**
   * Has the pane's info list actually rendered?
   *
   * This gates the whole read, and especially the "no website" conclusion. A
   * half-hydrated pane has no website link either, and calling that `none`
   * would be exactly the false negative the tri-state exists to prevent. So we
   * require at least one other info item to have appeared before believing an
   * absence.
   *
   * An address is not a usable signal on its own: service-area businesses
   * legitimately have none.
   */
  function isHydrated(pane, sel) {
    if (!pane) return false;
    if (!T.clean(pane.getAttribute('aria-label'))) return false;
    return !!pick(pane, sel.detail.anyItem);
  }

  /**
   * Read the open detail pane.
   *
   * @returns {{name: string, aliases: string[], patch: object}|null}
   *   null when no pane is open or it has not hydrated yet — the caller retries.
   */
  function readDetail(doc, sel, href) {
    if (!sel || !sel.detail) return null;

    const pane = pick(doc, sel.detail.pane);
    if (!isHydrated(pane, sel)) return null;

    const name = T.clean(pane.getAttribute('aria-label'));
    if (!name) return null;

    // The detail URL carries !1s (ftid) and !16s (mid) but no !19s, so the
    // row's own place_id will not be among these. Matching walks every alias.
    const ids = MLE.parserL1.extractIdentifiers(href || location.href, name);
    const aliases = [];
    [ids.placeId, ids.ftid, ids.mid].forEach(function (id) {
      if (id && aliases.indexOf(id) === -1) aliases.push(id);
    });
    if (!aliases.length) return null;

    const patch = {};

    const websiteEl = pick(pane, sel.detail.website);
    if (websiteEl) {
      const url = cleanWebsiteUrl(websiteEl.getAttribute('href'));
      if (url) {
        patch.websiteUrl = url;
        patch.website = K.WEBSITE.HAS;
        patch.websiteReason = K.WEBSITE_REASON.DETAIL_LINK;
      }
    } else {
      // Hydrated, info list present, no website link: a real absence, and the
      // only place in the product where "none" can be stated with confidence.
      patch.website = K.WEBSITE.NONE;
      patch.websiteReason = K.WEBSITE_REASON.DETAIL_NO_LINK;
    }

    const phone = phoneFrom(pick(pane, sel.detail.phone));
    if (phone) patch.phone = phone;

    const address = valueOf(pick(pane, sel.detail.address), sel);
    if (address) patch.fullAddress = address;

    const plusCode = valueOf(pick(pane, sel.detail.plusCode), sel);
    if (plusCode) patch.plusCode = plusCode;

    return { name: name, aliases: aliases, patch: patch };
  }

  MLE.parserL2 = { readDetail, cleanWebsiteUrl, phoneFrom, isHydrated, valueOf };
})(typeof self !== 'undefined' ? self : this);
