/**
 * Entitlement scaffold.
 *
 * M1 ships the shape, not the gate: BETA_ALL_FREE is true, so every call
 * returns "allowed" and the panel never nags. M3 flips the constant and wires
 * the caps to real state; nothing else in the codebase should need to change,
 * because callers already ask this module instead of testing flags inline.
 *
 * There is no payment code here and none is planned for the MVP.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;

  /** While true, every Pro flag reads as granted. */
  const BETA_ALL_FREE = true;

  /**
   * Pro-only capabilities. The free tier keeps live collection, every filter,
   * and CSV export within caps, permanently.
   */
  const FLAGS = ['unlimitedRows', 'crossSessionDedupe', 'savedPresets'];

  /** Populated from storage in M3. Beta reads straight through. */
  let granted = { unlimitedRows: false, crossSessionDedupe: false, savedPresets: false };

  function has(flag) {
    if (BETA_ALL_FREE) return true;
    return !!granted[flag];
  }

  /** Rows a single export may write. */
  function exportRowLimit() {
    return has('unlimitedRows') ? Infinity : K.FREE_ROWS_PER_EXPORT;
  }

  /** Exports allowed per calendar day. */
  function exportsPerDay() {
    return has('unlimitedRows') ? Infinity : K.FREE_EXPORTS_PER_DAY;
  }

  /**
   * Whether an export may proceed, given today's usage.
   * @param {{count: number, day: string}} usage
   * @returns {{allowed: boolean, reason: string|null, rowLimit: number}}
   */
  function checkExport(usage) {
    const limit = exportsPerDay();
    const used = usage && usage.day === today() ? usage.count : 0;
    if (used >= limit) {
      return { allowed: false, reason: 'dailyExports', rowLimit: exportRowLimit() };
    }
    return { allowed: true, reason: null, rowLimit: exportRowLimit() };
  }

  /** Local calendar day, matching how a user thinks about "today". */
  function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function setGranted(next) {
    granted = Object.assign({ unlimitedRows: false, crossSessionDedupe: false, savedPresets: false }, next);
  }

  MLE.entitlements = {
    BETA_ALL_FREE,
    FLAGS,
    has,
    exportRowLimit,
    exportsPerDay,
    checkExport,
    setGranted,
    today
  };
})(typeof self !== 'undefined' ? self : this);
