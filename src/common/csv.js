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
    // Contact first: this is the half of the row an outreach list is actually
    // worked from, and it only exists once a place has been enriched.
    { key: 'phone', header: 'phone', get: (r) => r.phone || '' },
    { key: 'website_status', header: 'website_status', get: (r) => r.website },
    { key: 'website_url', header: 'website_url', get: (r) => r.websiteUrl || '' },
    /**
     * Whether website_status came from the result card or from the place's own
     * detail pane. "none" from a card is an inference; "none" from a detail pane
     * is proof. A pitch list is only as good as knowing which one you have.
     */
    {
      key: 'website_source',
      header: 'website_source',
      get: (r) => (r.provenance && r.provenance.website) || ''
    },
    { key: 'address_line', header: 'address_line', get: (r) => r.addressLine },
    { key: 'full_address', header: 'full_address', get: (r) => r.fullAddress || '' },
    { key: 'plus_code', header: 'plus_code', get: (r) => r.plusCode || '' },
    { key: 'place_url', header: 'place_url', get: (r) => r.placeUrl },
    { key: 'place_id', header: 'place_id', get: (r) => r.placeId },
    { key: 'id_source', header: 'id_source', get: (r) => r.idSource },
    { key: 'source_query', header: 'source_query', get: (r) => r.query },
    { key: 'collected_at', header: 'collected_at', get: (r) => toIso(r.collectedAt) },
    /**
     * When the place's own page was read. Blank on Level-1 rows, which is the
     * point: it separates "seen in a list" from "confirmed at source", and
     * dates the confirmation so a stale list can be re-checked.
     */
    { key: 'enriched_at', header: 'enriched_at', get: (r) => toIso(r.enrichedAt) },
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
   * be the more common harm.
   *
   * International phone numbers keep the apostrophe deliberately. Quoting the
   * field does NOT exempt it -- Excel strips the quotes before deciding what a
   * cell is -- so a bare "+91 22 1234 5678" renders as #NAME? and the number is
   * simply lost. An apostrophe that a CRM strips on import is the smaller harm.
   * Indian numbers in the form Maps returns them ("072089 35965") begin with a
   * digit and never reach this branch at all.
   */
  function neutralise(value) {
    if (!/^[=+\-@\t\r]/.test(value)) return value;
    if (/^[+-]?\d+(\.\d+)?$/.test(value)) return value;
    return "'" + value;
  }

  /** A leading + or -, then only telephone punctuation, 6-20 digits total. */
  const PHONE_LIKE = /^[+-][\d\s().\- ]{5,24}$/;

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
