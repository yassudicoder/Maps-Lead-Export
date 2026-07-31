/**
 * Strict validation for the selector map.
 *
 * The map is pure data (CSS selector strings + a schema version). MV3 bans
 * remote code, not remote configuration, and this module is what keeps the
 * distinction honest: nothing here ever evaluates a string, and anything that
 * fails validation is discarded in favour of the bundled map.
 *
 * The remote refresh itself lands in M4; the validator ships now so the
 * bundled map is checked by exactly the code that will check the remote one.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;

  /** Every section and key the parser relies on, and whether it may be absent. */
  const SPEC = {
    feed: { required: ['container', 'card', 'placeLink'], optional: [] },
    card: {
      required: ['name', 'ratingHost', 'infoRows', 'websiteChip', 'actionChip', 'hidden'],
      optional: ['ratingText', 'reviewCountText']
    },
    context: { required: [], optional: ['searchInput'] },
    detail: {
      required: ['pane', 'website', 'phone', 'address', 'anyItem'],
      optional: ['title', 'plusCode']
    },
    captcha: { required: ['signals'], optional: [] }
  };

  const MAX_SELECTOR_LENGTH = 200;
  const MAX_SELECTORS_PER_KEY = 12;
  const MAX_TOTAL_SELECTORS = 120;

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  /**
   * Validate the shape of a selector map. DOM-free, so the service worker can
   * run it before ever handing the map to a tab.
   * @returns {{ok: boolean, errors: string[], value: object|null}}
   */
  function validate(map) {
    const errors = [];

    if (!isPlainObject(map)) {
      return { ok: false, errors: ['selector map is not an object'], value: null };
    }
    if (map.schemaVersion !== K.SELECTOR_SCHEMA_VERSION) {
      errors.push(
        'schemaVersion ' + String(map.schemaVersion) + ' != ' + K.SELECTOR_SCHEMA_VERSION
      );
      return { ok: false, errors, value: null };
    }

    let total = 0;
    const out = { schemaVersion: map.schemaVersion };

    Object.keys(SPEC).forEach((section) => {
      const spec = SPEC[section];
      const src = map[section];
      if (!isPlainObject(src)) {
        if (spec.required.length) errors.push('missing section "' + section + '"');
        return;
      }
      const dest = {};
      spec.required.concat(spec.optional).forEach((key) => {
        const list = src[key];
        const isRequired = spec.required.indexOf(key) !== -1;

        if (list === undefined) {
          if (isRequired) errors.push('missing ' + section + '.' + key);
          return;
        }
        if (!Array.isArray(list) || list.length === 0) {
          errors.push(section + '.' + key + ' must be a non-empty array');
          return;
        }
        if (list.length > MAX_SELECTORS_PER_KEY) {
          errors.push(section + '.' + key + ' has too many selectors');
          return;
        }
        const cleaned = [];
        for (let i = 0; i < list.length; i += 1) {
          const sel = list[i];
          if (typeof sel !== 'string') {
            errors.push(section + '.' + key + '[' + i + '] is not a string');
            return;
          }
          const trimmed = sel.trim();
          if (!trimmed || trimmed.length > MAX_SELECTOR_LENGTH) {
            errors.push(section + '.' + key + '[' + i + '] has an implausible length');
            return;
          }
          cleaned.push(trimmed);
          total += 1;
        }
        dest[key] = cleaned;
      });
      out[section] = dest;
    });

    if (total > MAX_TOTAL_SELECTORS) errors.push('selector map is too large');

    return { ok: errors.length === 0, errors, value: errors.length === 0 ? out : null };
  }

  /**
   * Drop selectors the browser cannot parse. Requires a DOM, so this runs in
   * the content script rather than the worker.
   *
   * A single malformed selector would otherwise make querySelector throw and
   * take the whole parse down; here it is dropped and reported instead.
   * @returns {{value: object, dropped: string[]}}
   */
  function compileFilter(map, doc) {
    const probe = doc.createDocumentFragment();
    const dropped = [];
    const out = { schemaVersion: map.schemaVersion };

    Object.keys(map).forEach((section) => {
      if (section === 'schemaVersion' || !isPlainObject(map[section])) return;
      const dest = {};
      Object.keys(map[section]).forEach((key) => {
        const kept = map[section][key].filter((sel) => {
          try {
            probe.querySelector(sel);
            return true;
          } catch (_) {
            dropped.push(section + '.' + key + ': ' + sel);
            return false;
          }
        });
        if (kept.length) dest[key] = kept;
      });
      out[section] = dest;
    });

    return { value: out, dropped };
  }

  MLE.selectorSchema = { validate, compileFilter, SPEC };
})(typeof self !== 'undefined' ? self : this);
