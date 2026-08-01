// The cross-session exported index: LRU behaviour, persistence shape, and the
// filter that acts on it.
global.self = global;
const path = require('node:path');
const SRC = path.join(__dirname, '..', 'src');

let stored = {};
global.chrome = {
  runtime: { lastError: null },
  storage: {
    local: {
      get: (keys, cb) => cb(stored),
      set: (obj, cb) => { Object.assign(stored, obj); if (cb) cb(); }
    }
  }
};

require(path.join(SRC, 'common', 'constants.js'));
require(path.join(SRC, 'common', 'text.js'));
require(path.join(SRC, 'common', 'debug-log.js'));
require(path.join(SRC, 'common', 'geo.js'));
require(path.join(SRC, 'common', 'filters.js'));
require(path.join(SRC, 'common', 'exported-index.js'));

const K = global.MLE.K;
const index = global.MLE.exportedIndex;
const F = global.MLE.filters;

let pass = 0;
const fails = [];
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else fails.push(label + '\n     got ' + a + '\n     want ' + e);
}

(async () => {
  await index.load();

  eq('index: starts empty', index.size(), 0);
  eq('index: knows nothing', index.has('ChIJa'), false);

  const first = index.add(['ChIJa', 'ChIJb', 'ChIJc']);
  eq('index: adds', first, { added: 3, refreshed: 0, evicted: 0 });
  eq('index: remembers', index.has('ChIJb'), true);
  eq('index: size', index.size(), 3);
  eq('index: timestamps', typeof index.at('ChIJa'), 'number');
  eq('index: unknown id has no timestamp', index.at('nope'), null);

  // Re-exporting refreshes rather than duplicating, and moves the entry to the
  // back so eviction stays oldest-first.
  const again = index.add(['ChIJa']);
  eq('index: re-export refreshes', again, { added: 0, refreshed: 1, evicted: 0 });
  eq('index: no duplicate', index.size(), 3);
  eq('index: refreshed entry is now newest', index.all()[2].placeId, 'ChIJa');

  index.add(['', null, undefined]);
  eq('index: ignores empty ids', index.size(), 3);

  /* ------------------------------------------------------------- eviction */

  index.clear();
  eq('index: cleared', index.size(), 0);

  const many = [];
  for (let i = 0; i < K.EXPORTED_INDEX_MAX + 250; i += 1) many.push('id-' + i);
  const big = index.add(many);
  eq('index: capped at the maximum', index.size(), K.EXPORTED_INDEX_MAX);
  eq('index: eviction counted', big.evicted, 250);
  // Oldest go first, newest survive.
  eq('index: evicted the oldest', index.has('id-0'), false);
  eq('index: kept the newest', index.has('id-' + (K.EXPORTED_INDEX_MAX + 249)), true);

  /* ------------------------------------------------------- the filter side */

  index.clear();
  index.add(['ChIJold']);
  const when = index.at('ChIJold');

  const rows = [
    { name: 'Old Cafe', placeId: 'ChIJold', website: 'unknown', exportedAt: when },
    { name: 'New Cafe', placeId: 'ChIJnew', website: 'unknown' }
  ];

  const on = F.apply(rows, F.empty(), { crossSessionDedupe: true });
  eq('filter: previously exported hidden by default', on.rows.map((r) => r.name), ['New Cafe']);
  eq('filter: and counted rather than vanishing', on.excludedExported, 1);

  const off = F.apply(rows, Object.assign(F.empty(), { excludeExported: false }),
    { crossSessionDedupe: true });
  eq('filter: the toggle brings them back', off.rows.length, 2);
  eq('filter: nothing excluded then', off.excludedExported, 0);

  // Without the Pro flag the index must not silently remove rows.
  const noFlag = F.apply(rows, F.empty(), { crossSessionDedupe: false });
  eq('filter: inert without the entitlement', noFlag.rows.length, 2);

  // The default filter set is still "inactive": excludeExported is on by
  // default, so counting it would report an untouched panel as filtered.
  eq('filter: default set reads as inactive', F.isActive(F.empty()), false);

  /* ----------------------------------------------------------- persistence */

  // Writes are debounced, so force one rather than racing the timer.
  index.flush();
  eq('index: persisted under its own key', !!stored[K.STORAGE.EXPORTED_INDEX], true);
  const saved = stored[K.STORAGE.EXPORTED_INDEX];
  eq('index: persisted shape', Array.isArray(saved.entries), true);
  eq('index: persists ids and dates only',
    Object.keys(saved.entries[0]).sort(), ['at', 'id']);

  console.log(pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) {
    fails.forEach((f) => console.log('  FAIL ' + f));
    process.exit(1);
  }
})();
