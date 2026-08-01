/**
 * Coordinates and distance.
 *
 * Every row already carries `geo` ("lat,lng") pulled from the !3d/!4d segment
 * of the place href, so this needs no extra reading of the page and no network.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});

  /** @returns {{lat:number, lng:number}|null} */
  function parse(geo) {
    if (!geo || typeof geo !== 'string') return null;
    const parts = geo.split(',');
    if (parts.length !== 2) return null;
    const lat = Number.parseFloat(parts[0]);
    const lng = Number.parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * The session's centre, as the median of each axis rather than the mean.
   *
   * A search for "gym in malad" returned a result in Bandra, ~15km away, and
   * another in Kandivali. A mean is dragged by those; a median is not, which
   * matters because the centroid is the reference every distance is measured
   * from — one stray result should not move the whole column.
   *
   * @returns {{lat:number, lng:number, from:number}|null}
   */
  function centroid(rows) {
    const lats = [];
    const lngs = [];
    for (let i = 0; i < rows.length; i += 1) {
      const p = parse(rows[i].geo);
      if (!p) continue;
      lats.push(p.lat);
      lngs.push(p.lng);
    }
    if (!lats.length) return null;
    return { lat: median(lats), lng: median(lngs), from: lats.length };
  }

  const EARTH_KM = 6371;
  const RAD = Math.PI / 180;

  /** Great-circle distance in km. */
  function distanceKm(a, b) {
    if (!a || !b) return null;
    const dLat = (b.lat - a.lat) * RAD;
    const dLng = (b.lng - a.lng) * RAD;
    const s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return EARTH_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  /**
   * Distance from the centroid, to one decimal.
   * @returns {number|null} null when the row has no usable coordinates — which
   *   the filter must treat as unknown, never as zero or as out of range.
   */
  function distanceFrom(centre, row) {
    const p = parse(row && row.geo);
    if (!centre || !p) return null;
    const km = distanceKm(centre, p);
    if (km == null || !Number.isFinite(km)) return null;
    return Math.round(km * 10) / 10;
  }

  /** How many rows carry usable coordinates. */
  function coverage(rows) {
    let withGeo = 0;
    for (let i = 0; i < rows.length; i += 1) if (parse(rows[i].geo)) withGeo += 1;
    return {
      withGeo: withGeo,
      total: rows.length,
      rate: rows.length ? Math.round((withGeo / rows.length) * 100) / 100 : null
    };
  }

  MLE.geo = { parse, centroid, distanceKm, distanceFrom, coverage, median };
})(typeof self !== 'undefined' ? self : this);
