// Saved filter presets: what is stored, what is refused, and the sanitising
// that stops a stale record behaving differently from the panel.
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
require(path.join(SRC, 'common', 'geo.js'));
require(path.join(SRC, 'common', 'filters.js'));
require(path.join(SRC, 'common', 'presets.js'));

const K = global.MLE.K;
const P = global.MLE.presets;
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
  await P.load();
  eq('presets: starts empty', P.all().length, 0);

  const prospecting = Object.assign(F.empty(), {
    website: 'none', maxReviews: 50, radiusKm: 5, category: 'cafe'
  });

  eq('presets: saves', P.save('No website, near me', prospecting), { ok: true });
  eq('presets: listed', P.all().map((p) => p.name), ['No website, near me']);

  const back = P.get('No website, near me');
  eq('presets: restores the values', {
    website: back.website, maxReviews: back.maxReviews,
    radiusKm: back.radiusKm, category: back.category
  }, { website: 'none', maxReviews: 50, radiusKm: 5, category: 'cafe' });

  // A restored preset must be a fresh object, or editing the filters would
  // silently rewrite the saved one.
  back.website = 'has';
  eq('presets: get returns a copy', P.get('No website, near me').website, 'none');

  eq('presets: unknown name', P.get('nope'), null);
  eq('presets: blank name refused', P.save('   ', prospecting), { ok: false, reason: 'empty-name' });
  eq('presets: still one', P.all().length, 1);

  // Same name replaces rather than duplicating.
  P.save('No website, near me', Object.assign(F.empty(), { website: 'unknown' }));
  eq('presets: same name replaces', P.all().length, 1);
  eq('presets: replaced value', P.get('No website, near me').website, 'unknown');
  eq('presets: name match is case-insensitive',
    P.save('NO WEBSITE, NEAR ME', F.empty()).ok, true);
  eq('presets: and did not add a second', P.all().length, 1);

  // Only fields the filter engine knows survive. A hand-edited or stale record
  // must not smuggle keys back in.
  const dirty = Object.assign(F.empty(), { website: 'has', somethingElse: 'x', __proto__x: 1 });
  P.save('Dirty', dirty);
  const cleaned = P.get('Dirty');
  eq('presets: unknown keys dropped', Object.prototype.hasOwnProperty.call(cleaned, 'somethingElse'), false);
  eq('presets: known keys kept', cleaned.website, 'has');
  eq('presets: shape matches the filter engine',
    Object.keys(cleaned).sort(), Object.keys(F.empty()).sort());

  // A record missing a field gets the current default rather than undefined.
  P.save('Partial', { website: 'none' });
  eq('presets: missing fields take defaults', P.get('Partial').keepUnknown, true);

  eq('presets: removes', P.remove('Dirty'), true);
  eq('presets: removing twice is harmless', P.remove('Dirty'), false);

  /* ------------------------------------------------------------------ cap */

  for (let i = 0; i < P.MAX + 5; i += 1) P.save('preset-' + i, F.empty());
  eq('presets: capped', P.all().length, P.MAX);
  eq('presets: refuses past the cap', P.save('one-more', F.empty()),
    { ok: false, reason: 'full' });
  // Replacing an existing one is still allowed at the cap.
  eq('presets: replace still works when full', P.save('preset-0', F.empty()).ok, true);

  const name = 'x'.repeat(200);
  P.remove('preset-1');
  P.save(name, F.empty());
  eq('presets: long names truncated',
    P.all().some((p) => p.name.length === P.MAX_NAME), true);

  eq('presets: persisted under their own key', !!stored[K.STORAGE.PRESETS], true);
  eq('presets: persisted shape', Array.isArray(stored[K.STORAGE.PRESETS].items), true);

  console.log(pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) {
    fails.forEach((f) => console.log('  FAIL ' + f));
    process.exit(1);
  }
})();
