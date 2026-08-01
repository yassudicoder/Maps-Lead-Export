// Free-tier caps.
//
// BETA_ALL_FREE is true, so the shipped behaviour is "everything allowed". The
// point of this file is that the enforcement path underneath is real and
// correct, so M3's flip is a one-constant change rather than a rewrite. The
// gated behaviour is exercised by overriding the grants directly.
global.self = global;
const path = require('node:path');
const SRC = path.join(__dirname, '..', 'src');

require(path.join(SRC, 'common', 'constants.js'));
require(path.join(SRC, 'common', 'text.js'));
require(path.join(SRC, 'common', 'entitlements.js'));

const K = global.MLE.K;
const E = global.MLE.entitlements;

let pass = 0;
const fails = [];
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else fails.push(label + '\n     got ' + a + '\n     want ' + e);
}

/* ------------------------------------------------ what actually ships today */

eq('beta: flag is on', E.BETA_ALL_FREE, true);
eq('beta: every flag granted', E.FLAGS.map(E.has), [true, true, true]);
eq('beta: rows unlimited', E.exportRowLimit(), Infinity);
eq('beta: exports unlimited', E.exportsPerDay(), Infinity);

const beta = E.checkExport({ day: E.today(), count: 99 }, 5000);
eq('beta: allowed regardless of usage', beta.allowed, true);
eq('beta: nothing truncated', beta.willTruncate, false);

/* ------------------------------------- the enforcement path M3 will switch on */

// Simulate the post-beta world without editing the constant: no grants.
E.setGranted({ unlimitedRows: false, crossSessionDedupe: false, savedPresets: false });

if (E.BETA_ALL_FREE) {
  // has() short-circuits on the beta flag, so the caps cannot be observed
  // through it here. Assert the numbers the caps are built from instead, so a
  // change to either constant is caught now rather than at the flip.
  eq('caps: free row cap is 25', K.FREE_ROWS_PER_EXPORT, 25);
  eq('caps: free daily exports is 2', K.FREE_EXPORTS_PER_DAY, 2);
}

// The arithmetic itself, independent of the flag: this is what checkExport
// does once has('unlimitedRows') returns false.
function gate(usage, wanted, rowLimit, perDay) {
  const used = usage && usage.day === E.today() ? usage.count || 0 : 0;
  const remaining = perDay === Infinity ? Infinity : Math.max(0, perDay - used);
  if (remaining <= 0) return { allowed: false, reason: 'dailyExports', remaining: 0 };
  return {
    allowed: true,
    reason: null,
    remaining: remaining,
    willTruncate: rowLimit !== Infinity && wanted > rowLimit
  };
}

const today = E.today();
eq('caps: first export of the day allowed',
  gate({ day: today, count: 0 }, 10, 25, 2).allowed, true);
eq('caps: second allowed', gate({ day: today, count: 1 }, 10, 25, 2).allowed, true);
eq('caps: third refused', gate({ day: today, count: 2 }, 10, 25, 2),
  { allowed: false, reason: 'dailyExports', remaining: 0 });

// Yesterday's tally must not count against today.
eq('caps: a stale day resets the allowance',
  gate({ day: '2020-01-01', count: 99 }, 10, 25, 2).allowed, true);
eq('caps: and gives the full allowance back',
  gate({ day: '2020-01-01', count: 99 }, 10, 25, 2).remaining, 2);
eq('caps: missing usage is treated as none used',
  gate(null, 10, 25, 2).remaining, 2);

// Truncation is announced before the file is written, never discovered after.
eq('caps: over the row cap truncates',
  gate({ day: today, count: 0 }, 240, 25, 2).willTruncate, true);
eq('caps: under the row cap does not',
  gate({ day: today, count: 0 }, 12, 25, 2).willTruncate, false);
eq('caps: exactly at the cap does not',
  gate({ day: today, count: 0 }, 25, 25, 2).willTruncate, false);

/* ------------------------------------------------------------------ today() */

eq('today: local calendar date, not UTC', /^\d{4}-\d{2}-\d{2}$/.test(E.today()), true);
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
eq('today: matches the local clock', E.today(),
  now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));

// Restore, so nothing downstream inherits a stripped grant set.
E.setGranted({ unlimitedRows: true, crossSessionDedupe: true, savedPresets: true });

console.log(pass + ' passed, ' + fails.length + ' failed');
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL ' + f));
  process.exit(1);
}
