/**
 * The filter set.
 *
 * One rule runs through all of it: a row we do not know about is never quietly
 * excluded. Maps omits review counts on whole verticals and website presence on
 * others, and "fewer than 50 reviews" must not silently recommend every
 * business Maps happened to be quiet about. So each numeric filter carries an
 * explicit decision about unknowns, defaulting to keeping them and saying so.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;

  /** Everything off. This shape is what presets serialise (M3 A3). */
  function empty() {
    return {
      website: 'any', // any | has | none | unknown
      maxRating: null, // keep rows rated at most this
      maxReviews: null, // keep rows with fewer than this many reviews
      category: '', // substring, case-insensitive
      name: '', // substring, case-insensitive
      radiusKm: null, // keep rows within this many km of the centroid
      /**
       * Hide places exported in a previous session. On by default: the whole
       * point of keeping the index is not pitching the same business twice.
       */
      excludeExported: true,
      /**
       * Whether a row whose value is unknown survives a numeric filter.
       * On by default: excluding unknowns is a claim we cannot support.
       */
      keepUnknown: true
    };
  }

  /**
   * Whether the user has narrowed anything explicitly.
   *
   * `excludeExported` is deliberately not counted: it is on by default, so
   * including it would report an untouched filter set as active. What it hides
   * is surfaced as a count instead, which is the honest way to show a default
   * that removes rows.
   */
  function isActive(f) {
    if (!f) return false;
    return (
      f.website !== 'any' ||
      f.maxRating != null ||
      f.maxReviews != null ||
      !!f.category ||
      !!f.name ||
      f.radiusKm != null
    );
  }

  function contains(haystack, needle) {
    if (!needle) return true;
    return String(haystack || '').toLowerCase().indexOf(String(needle).toLowerCase()) !== -1;
  }

  /**
   * Apply the filters.
   *
   * @param {object[]} rows
   * @param {object} f
   * @param {{centre?: object}} [ctx] centroid, for the radius filter
   * @returns {{rows: object[], excludedUnknown: number}} `excludedUnknown`
   *   counts rows dropped purely because a value was missing, so the UI can
   *   offer to put them back rather than leaving them invisible.
   */
  function apply(rows, f, ctx) {
    const out = [];
    let excludedUnknown = 0;
    let excludedExported = 0;
    const centre = ctx && ctx.centre;
    const dedupeOn = !ctx || ctx.crossSessionDedupe !== false;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];

      // Counted separately from the user's own filters: this one is on by
      // default, so hiding rows silently would be the wrong kind of helpful.
      if (dedupeOn && f.excludeExported && row.exportedAt) {
        excludedExported += 1;
        continue;
      }

      if (f.website !== 'any' && row.website !== f.website) continue;
      if (!contains(row.category, f.category)) continue;
      if (!contains(row.name, f.name)) continue;

      if (f.maxRating != null) {
        if (row.rating == null) {
          if (!f.keepUnknown) { excludedUnknown += 1; continue; }
        } else if (row.rating > f.maxRating) continue;
      }

      if (f.maxReviews != null) {
        if (row.reviewCount == null) {
          // The case that makes this rule matter: no count shown at all.
          if (!f.keepUnknown) { excludedUnknown += 1; continue; }
        } else if (row.reviewCount >= f.maxReviews) continue;
      }

      if (f.radiusKm != null) {
        const km = MLE.geo.distanceFrom(centre, row);
        if (km == null) {
          if (!f.keepUnknown) { excludedUnknown += 1; continue; }
        } else if (km > f.radiusKm) continue;
      }

      out.push(row);
    }

    return {
      rows: out,
      excludedUnknown: excludedUnknown,
      excludedExported: excludedExported
    };
  }

  /** How many rows each website state accounts for, for the filter chips. */
  function websiteTally(rows) {
    const tally = { has: 0, none: 0, unknown: 0 };
    for (let i = 0; i < rows.length; i += 1) {
      const w = rows[i].website;
      if (tally[w] != null) tally[w] += 1;
    }
    return tally;
  }

  MLE.filters = { empty, isActive, apply, websiteTally };
})(typeof self !== 'undefined' ? self : this);
