/**
 * Google Maps place identifiers.
 *
 * Lives in common/ rather than the parser because the service worker needs it
 * too: rows persisted before Level-2 existed carry no aliases, and the worker
 * has to rebuild them from the stored place URL on load.
 *
 * A result-card href and a place-detail URL do NOT carry the same identifiers.
 * Cards have !19s (the canonical ChIJ place id), !1s (feature id) and !16s
 * (Knowledge Graph mid). Opening a place rewrites the URL to one with !1s and
 * !16s but NO !19s — so a row keyed only on its place id can never be matched
 * to the pane the user opened. Every id is kept, and matching walks them all.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});

  const ID_RULES = [
    { source: 'place_id', re: /!19s([A-Za-z0-9_-]{10,})/ },
    { source: 'ftid', re: /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i },
    { source: 'mid', re: /!16s([^!?&]+)/ }
  ];

  /**
   * @returns {{placeId: string|null, idSource: string|null,
   *            ftid: string|null, mid: string|null, geo: string|null}}
   */
  function extractIdentifiers(href, name) {
    const out = { placeId: null, idSource: null, ftid: null, mid: null, geo: null };

    if (href) {
      for (let i = 0; i < ID_RULES.length; i += 1) {
        const rule = ID_RULES[i];
        const m = href.match(rule.re);
        if (!m || !m[1]) continue;

        let value = m[1];
        if (rule.source === 'mid') {
          try {
            value = decodeURIComponent(value);
          } catch (_) {
            /* keep the raw form */
          }
          // A bare "/g/" or "/m/" prefix with nothing after it is not an id.
          if (!/^\/[gm]\/\w+/.test(value)) continue;
        }

        if (rule.source === 'ftid') out.ftid = value;
        else if (rule.source === 'mid') out.mid = value;

        // First rule to match sets the primary key; later ones only add aliases.
        if (!out.placeId) {
          out.placeId = value;
          out.idSource = rule.source;
        }
      }

      const coords = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
      if (coords) {
        out.geo = coords[1] + ',' + coords[2];
        if (!out.placeId) {
          out.placeId = 'geo:' + out.geo;
          out.idSource = 'coords';
        }
      }
    }

    if (!out.placeId && MLE.text) {
      const slug = MLE.text.slug(name, 80);
      if (slug) {
        out.placeId = 'name:' + slug;
        out.idSource = 'name';
      }
    }
    return out;
  }

  /** Every key a row can be recognised by, strongest first. */
  function aliasesOf(row) {
    const out = [];
    if (!row) return out;
    if (row.placeId) out.push(row.placeId);
    if (row.ftid && out.indexOf(row.ftid) === -1) out.push(row.ftid);
    if (row.mid && out.indexOf(row.mid) === -1) out.push(row.mid);
    return out;
  }

  MLE.placeId = { extractIdentifiers, aliasesOf };
})(typeof self !== 'undefined' ? self : this);
