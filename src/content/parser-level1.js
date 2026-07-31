/**
 * Level-1 parser: reads the result cards Google Maps has already rendered in
 * the user's own tab.
 *
 * It never opens a place, never scrolls, never fetches. Given a feed element it
 * returns rows plus a health count, and nothing else.
 *
 * Two rules run through the whole file:
 *   - Prefer structure and ARIA over class names. Google rotates classes; roles
 *     and aria-labels are load-bearing for their own accessibility and change
 *     far less often.
 *   - A field we cannot read is null, never a guess. "unknown" is a product
 *     feature here, not a failure mode.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;
  const T = MLE.text;

  /** First element matching any selector in the list. */
  function pick(el, list) {
    if (!el || !list) return null;
    for (let i = 0; i < list.length; i += 1) {
      try {
        const found = el.querySelector(list[i]);
        if (found) return found;
      } catch (_) {
        /* selector already compile-checked; skip defensively */
      }
    }
    return null;
  }

  /** All elements for the first selector in the list that matches anything. */
  function pickAll(el, list) {
    if (!el || !list) return [];
    for (let i = 0; i < list.length; i += 1) {
      try {
        const found = el.querySelectorAll(list[i]);
        if (found && found.length) return Array.prototype.slice.call(found);
      } catch (_) {
        /* as above */
      }
    }
    return [];
  }

  function textOf(el) {
    return el ? T.clean(el.textContent) : '';
  }

  /* ---------------------------------------------------------------- place id */

  /**
   * The place href carries several identifiers in its `!`-delimited data
   * segment. In descending order of durability:
   *
   *   !19s  ChIJ...            canonical Google Place ID
   *   !1s   0x<hex>:0x<hex>    feature id (ftid)
   *   !16s  %2Fg%2F11f...      Knowledge Graph mid
   *   !3d/!4d                  lat/lng, last resort before the name
   *
   * All four were present on every card sampled, but the chain matters: a row
   * whose id came from coordinates is a weaker dedupe key than one with a real
   * place id, and `idSource` says which you got.
   */
  /**
   * Identifier extraction lives in common/place-id.js: the service worker needs
   * the same logic to repair rows that were persisted before Level-2 existed.
   */
  const extractIdentifiers = function (href, name) {
    return MLE.placeId.extractIdentifiers(href, name);
  };
  const aliasesOf = function (row) {
    return MLE.placeId.aliasesOf(row);
  };

  /** Strip the tracking query string; the data segment lives in the path. */
  function cleanPlaceUrl(href) {
    if (!href) return '';
    try {
      const u = new URL(href);
      return u.origin + u.pathname;
    } catch (_) {
      return href;
    }
  }

  /* ------------------------------------------------------------- info chunks */

  /**
   * Split an info row into its text chunks.
   *
   * The row reads "Plumber / 3432 Greystone Dr" with the separator inside an
   * aria-hidden span. Dropping aria-hidden nodes and cleaning what remains also
   * removes the Material icon glyph Maps sometimes wedges between the two,
   * which would otherwise shift the address into the category slot.
   */
  function chunksOf(row, sel) {
    if (!row) return [];
    const clone = row.cloneNode(true);
    const hidden = sel.card.hidden || [];
    for (let i = 0; i < hidden.length; i += 1) {
      let nodes;
      try {
        nodes = clone.querySelectorAll(hidden[i]);
      } catch (_) {
        continue;
      }
      for (let j = 0; j < nodes.length; j += 1) nodes[j].remove();
    }
    const out = [];
    for (let i = 0; i < clone.children.length; i += 1) {
      const t = T.clean(clone.children[i].textContent);
      if (t) out.push(t);
    }
    return out;
  }

  /**
   * Structural fallback for the info row when the class selector misses.
   *
   * Signature: a div whose direct children are two or more spans, holding no
   * rating widget. The rating block matches the span-children test and sits
   * earlier in the document, so excluding [role="img"] is what keeps "4.9" out
   * of the category column.
   */
  function findInfoRowsStructural(card) {
    const divs = card.getElementsByTagName('div');
    const rows = [];
    for (let i = 0; i < divs.length && rows.length < 4; i += 1) {
      const d = divs[i];
      const kids = d.children;
      if (kids.length < 2) continue;
      let allSpans = true;
      for (let j = 0; j < kids.length; j += 1) {
        if (kids[j].tagName !== 'SPAN') {
          allSpans = false;
          break;
        }
      }
      if (!allSpans) continue;
      if (d.querySelector('[role="img"]')) continue;
      rows.push(d);
    }
    return rows;
  }

  /* ----------------------------------------------------------------- website */

  function isOffGoogleHref(href) {
    if (!href) return false;
    try {
      const u = new URL(href, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      return !/(^|\.)(google|goo|gstatic|withgoogle)\.[a-z.]+$/i.test(u.hostname);
    } catch (_) {
      return false;
    }
  }

  /**
   * Website presence, tri-state and provable.
   *
   *   has     - the card renders a Website chip.
   *   none    - the card renders an action-chip row and no Website chip in it.
   *   unknown - the card renders no chip row at all, so absence proves nothing.
   *
   * That last branch is the whole point. Restaurant cards carry no chip row,
   * so an extractor that treats "no chip" as "no website" reports every
   * restaurant in a city as a no-website lead. Ours says it does not know and
   * asks the user to open the place.
   *
   * Where the chip exists but `data-value` is not the English "Website" (a
   * locale we have not sampled), an off-Google chip href stands in. That can
   * over-report `has`, which costs a missed lead; under-reporting would put a
   * business with a website onto a "no website" pitch list, which is worse.
   */
  function readWebsite(card, sel) {
    if (pick(card, sel.card.websiteChip)) {
      return { website: K.WEBSITE.HAS, reason: K.WEBSITE_REASON.CHIP };
    }
    const chips = pickAll(card, sel.card.actionChip);
    if (chips.length) {
      for (let i = 0; i < chips.length; i += 1) {
        if (chips[i].tagName === 'A' && isOffGoogleHref(chips[i].getAttribute('href'))) {
          return { website: K.WEBSITE.HAS, reason: K.WEBSITE_REASON.CHIP };
        }
      }
      return { website: K.WEBSITE.NONE, reason: K.WEBSITE_REASON.CHIP_ROW_WITHOUT_WEBSITE };
    }
    return { website: K.WEBSITE.UNKNOWN, reason: K.WEBSITE_REASON.NO_CHIP_ROW };
  }

  /* -------------------------------------------------------------------- card */

  /**
   * Parse one result card.
   * @returns {object|null} a row, or null when the element yielded no usable
   *   identity — the caller counts those against parse health.
   */
  function parseCard(card, sel, ctx) {
    const link = pick(card, sel.feed.placeLink);
    if (!link) return null;

    const href = link.href || link.getAttribute('href') || '';
    const name = T.clean(link.getAttribute('aria-label')) || textOf(pick(card, sel.card.name));
    const id = extractIdentifiers(href, name);

    // Identity is non-negotiable: without both we cannot dedupe or attribute,
    // so the row is dropped rather than exported half-formed.
    if (!id.placeId || !name) return null;

    // Rating and review count share one aria-label, "4.4 stars 677 Reviews".
    // Numbers keep their order across locales, so position beats word-matching.
    let rating = null;
    let reviewCount = null;
    const ratingHost = pick(card, sel.card.ratingHost);
    if (ratingHost) {
      const tokens = T.numericTokens(ratingHost.getAttribute('aria-label') || '');
      if (tokens.length > 0) rating = T.asRating(tokens[0]);
      if (tokens.length > 1) reviewCount = T.asInteger(tokens[1]);
    }
    if (rating == null) rating = T.asRating(textOf(pick(card, sel.card.ratingText)));
    if (reviewCount == null) reviewCount = T.asInteger(textOf(pick(card, sel.card.reviewCountText)));

    // Review counts are genuinely absent on some verticals, so null here means
    // "Maps did not show it", not zero. M2's "fewer than n reviews" filter has
    // to exclude these rather than treat them as the lowest value.

    let rows = pickAll(card, sel.card.infoRows);
    if (!rows.length) rows = findInfoRowsStructural(card);
    const chunks = chunksOf(rows[0], sel);
    const category = chunks[0] || '';
    const addressLine = chunks[1] || '';

    const web = readWebsite(card, sel);

    const provenance = { name: K.SOURCE.CARD, website: K.SOURCE.CARD };
    if (category) provenance.category = K.SOURCE.CARD;
    if (addressLine) provenance.addressLine = K.SOURCE.CARD;
    if (rating != null) provenance.rating = K.SOURCE.CARD;
    if (reviewCount != null) provenance.reviewCount = K.SOURCE.CARD;

    return {
      placeId: id.placeId,
      idSource: id.idSource,
      // Aliases, kept so an opened detail pane can be matched back to this row.
      ftid: id.ftid,
      mid: id.mid,
      geo: id.geo,
      name: name,
      category: category,
      addressLine: addressLine,
      rating: rating,
      reviewCount: reviewCount,
      website: web.website,
      websiteReason: web.reason,
      placeUrl: cleanPlaceUrl(href),
      query: (ctx && ctx.query) || '',
      collectedAt: Date.now(),
      level: 1,
      provenance: provenance
    };
  }

  /**
   * Parse every result card currently rendered in the feed.
   * @returns {{rows: object[], stats: {seen:number, parsed:number, idSources:object}}}
   */
  function parseFeed(feed, sel, ctx) {
    const cards = pickAll(feed, sel.feed.card);
    const rows = [];
    const idSources = {};
    let parsed = 0;

    for (let i = 0; i < cards.length; i += 1) {
      let row = null;
      try {
        row = parseCard(cards[i], sel, ctx);
      } catch (_) {
        row = null;
      }
      if (row) {
        parsed += 1;
        rows.push(row);
        idSources[row.idSource] = (idSources[row.idSource] || 0) + 1;
      }
    }

    // If the card selectors matched nothing at all but the feed clearly holds
    // content, report the children as seen-and-failed so parse health drops and
    // the panel says the layout moved instead of showing an empty list.
    const seen = cards.length || (feed.children ? feed.children.length : 0);

    return { rows: rows, stats: { seen: seen, parsed: parsed, idSources: idSources } };
  }

  MLE.parserL1 = {
    parseFeed,
    parseCard,
    extractIdentifiers,
    aliasesOf,
    readWebsite,
    chunksOf,
    pick,
    pickAll
  };
})(typeof self !== 'undefined' ? self : this);
