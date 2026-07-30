/**
 * CSV assembly: RFC 4180, UTF-8 with BOM so Excel reads non-Latin names and
 * commas in addresses without a wizard.
 *
 * The column set is fixed in M1; the picker arrives in M3.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});

  /**
   * Column order is deliberate: the pitch-relevant fields first, provenance
   * last, so the sheet reads left-to-right the way a freelancer works it.
   */
  const COLUMNS = [
    { key: 'name', header: 'name', get: (r) => r.name },
    { key: 'category', header: 'category', get: (r) => r.category },
    { key: 'rating', header: 'rating', get: (r) => (r.rating == null ? '' : String(r.rating)) },
    { key: 'reviews', header: 'reviews', get: (r) => (r.reviewCount == null ? '' : String(r.reviewCount)) },
    { key: 'address_line', header: 'address_line', get: (r) => r.addressLine },
    { key: 'website_status', header: 'website_status', get: (r) => r.website },
    { key: 'place_url', header: 'place_url', get: (r) => r.placeUrl },
    { key: 'place_id', header: 'place_id', get: (r) => r.placeId },
    { key: 'id_source', header: 'id_source', get: (r) => r.idSource },
    { key: 'source_query', header: 'source_query', get: (r) => r.query },
    { key: 'collected_at', header: 'collected_at', get: (r) => toIso(r.collectedAt) },
    { key: 'data_level', header: 'data_level', get: (r) => String(r.level || 1) }
  ];

  function toIso(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toISOString();
    } catch (_) {
      return '';
    }
  }

  /**
   * Neutralise spreadsheet formula injection.
   *
   * Excel and Sheets evaluate a cell beginning with = + - @ (or a leading
   * tab/CR), so a business literally named "=cmd|..." would execute on open.
   * Prefixing an apostrophe forces the cell to text.
   *
   * Plain numbers are exempt: "-4" and "+1" are data, and mangling them would
   * be the more common harm. This matters more once phone numbers arrive in M2,
   * where a leading "+" is the norm rather than the exception.
   */
  function neutralise(value) {
    if (!/^[=+\-@\t\r]/.test(value)) return value;
    if (/^[+-]?\d+(\.\d+)?$/.test(value)) return value;
    return "'" + value;
  }

  /** Quote a single field per RFC 4180. */
  function field(value) {
    const s = neutralise(value == null ? '' : String(value));
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * Build the CSV document.
   * @param {Array<object>} rows
   * @param {{columns?: string[], bom?: boolean}} [options]
   */
  function build(rows, options) {
    const opts = options || {};
    const cols = opts.columns
      ? COLUMNS.filter((c) => opts.columns.indexOf(c.key) !== -1)
      : COLUMNS;

    const lines = [cols.map((c) => field(c.header)).join(',')];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const cells = new Array(cols.length);
      for (let j = 0; j < cols.length; j += 1) {
        let v;
        try {
          v = cols[j].get(row);
        } catch (_) {
          v = '';
        }
        cells[j] = field(v);
      }
      lines.push(cells.join(','));
    }

    // CRLF terminators, including a trailing one: RFC 4180 allows it and some
    // importers are happier for it.
    const body = lines.join('\r\n') + '\r\n';
    return opts.bom === false ? body : '\uFEFF' + body;
  }

  /** `maps-leads-{query}-{yyyy-mm-dd}.csv` */
  function filename(query, date) {
    const d = date instanceof Date ? date : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const q = MLE.text.slug(query);
    return 'maps-leads-' + (q ? q + '-' : '') + stamp + '.csv';
  }

  MLE.csv = { COLUMNS, build, filename, field, neutralise };
})(typeof self !== 'undefined' ? self : this);
