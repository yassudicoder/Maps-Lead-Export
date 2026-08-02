/**
 * Entitlement scaffold.
 *
 * The shape, not the gate. BETA_ALL_FREE is true, so every call returns
 * "allowed" and the panel never nags. The cap machinery below is built and
 * tested but inert, so turning it on later changes one constant rather than
 * threading flags through the codebase — callers already ask this module.
 *
 * There is no payment code here and none is planned.
 *
 * See docs/MONETIZATION.md for the decision this encodes.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});
  const K = MLE.K;

  /**
   * While true, every Pro flag reads as granted. Decided 2026-08-02: the
   * product launches free and premium is revisited around 2027-02.
   *
   * Flipped by a human, in a release, with a version bump — never compared
   * against a date at runtime. A timer here would mean the extension quietly
   * starts refusing to do what it did yesterday, on a machine nobody touched,
   * for a user who never agreed to it.
   */
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
   *
   * `usage.day` is a local calendar date, so the daily allowance resets at the
   * user's midnight rather than UTC's — a cap that resets mid-afternoon would
   * read as a bug.
   *
   * @param {{count: number, day: string}} usage
   * @param {number} [wanted] rows the user is trying to export
   * @returns {{allowed: boolean, reason: string|null, rowLimit: number,
   *            willTruncate: boolean, remainingToday: number}}
   */
  function checkExport(usage, wanted) {
    const perDay = exportsPerDay();
    const rowLimit = exportRowLimit();
    const used = usage && usage.day === today() ? usage.count || 0 : 0;
    const remainingToday = perDay === Infinity ? Infinity : Math.max(0, perDay - used);

    if (remainingToday <= 0) {
      return {
        allowed: false,
        reason: 'dailyExports',
        rowLimit: rowLimit,
        willTruncate: false,
        remainingToday: 0
      };
    }

    return {
      allowed: true,
      reason: null,
      rowLimit: rowLimit,
      // Say so before the file is written, not after: silently exporting the
      // first 25 of 240 rows is the kind of surprise that loses trust.
      willTruncate: typeof wanted === 'number' && rowLimit !== Infinity && wanted > rowLimit,
      remainingToday: remainingToday
    };
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
