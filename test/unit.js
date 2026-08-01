// Exercises the pure logic the browser test cannot reach: number parsing
// across locales, and CSV assembly against RFC 4180 + injection rules.
global.self = global;
const base = require('node:path').join(__dirname, '..', 'src', 'common') + require('node:path').sep;
require(base + 'constants.js');
require(base + 'text.js');
require(base + 'csv.js');

const T = global.MLE.text;
const CSV = global.MLE.csv;

let pass = 0;
const fails = [];
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else fails.push(label + '\n     got ' + a + '\n     want ' + e);
}

/* ------------------------------------------------------------ number parsing */

eq('rating 4.9', T.asRating('4.9'), 4.9);
eq('rating comma decimal 4,9 (de)', T.asRating('4,9'), 4.9);
eq('rating integer 5', T.asRating('5'), 5);
eq('rating 0', T.asRating('0'), 0);
eq('rating rejects out-of-range 18.188', T.asRating('18.188'), null);
eq('rating rejects empty', T.asRating(''), null);
eq('rating devanagari 4.9', T.asRating('\u096A.\u096F'), 4.9);

eq('int grouped comma', T.asInteger('18,188'), 18188);
eq('int grouped dot (de)', T.asInteger('18.188'), 18188);
eq('int grouped nbsp (fr)', T.asInteger('18\u00a0188'), 18188);
eq('int narrow nbsp', T.asInteger('18\u202f188'), 18188);
eq('int parenthesised', T.asInteger('(677)'), 677);
eq('int devanagari', T.asInteger('\u096e\u096b'), 85);
eq('int arabic-indic', T.asInteger('\u0664\u0662'), 42);
eq('int empty', T.asInteger('no reviews'), null);

eq('tokens en', T.numericTokens('4.4 stars 677 Reviews'), ['4.4', '677']);
eq('tokens de', T.numericTokens('4,8 Sterne 18.188 Rezensionen'), ['4,8', '18.188']);
eq('tokens hi', T.numericTokens('\u096A.\u096F \u0938\u094D\u091F\u093E\u0930 \u096e\u096b'), ['4.9', '85']);
eq('tokens rating only', T.numericTokens('4.9 stars'), ['4.9']);

// The real hi-IN aria-label observed on Maps.
const hiAria = '4.9 \u0938\u094D\u091F\u093E\u0930 85 \u0938\u092E\u0940\u0915\u094D\u0937\u093E\u090F\u0902';
const hiTokens = T.numericTokens(hiAria);
eq('live hi-IN aria rating', T.asRating(hiTokens[0]), 4.9);
eq('live hi-IN aria reviews', T.asInteger(hiTokens[1]), 85);

/* -------------------------------------------------------------- text cleanup */

eq('clean strips private-use glyph', T.clean('  \ue934  110 E 2nd St '), '110 E 2nd St');
eq('clean strips bidi marks', T.clean('\u200eAcme\u200f'), 'Acme');
eq('clean collapses nbsp', T.clean('A\u00a0\u00a0B'), 'A B');
eq('clean of pure glyph is empty', T.clean('\ue934'), '');

eq('slug basic', T.slug('Plumbers in Austin, TX'), 'plumbers-in-austin-tx');
eq('slug non-latin kept', T.slug('\u092A\u094D\u0932\u0902\u092C\u0930'), '\u092A\u094D\u0932\u0902\u092C\u0930');
eq('slug empty', T.slug('   '), '');
eq('slug trims to word boundary', T.slug('aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeee', 30), 'aaaaaaaaaa-bbbbbbbbbb');

/* ------------------------------------------------------------------ csv rules */

eq('injection: formula neutralised', CSV.neutralise('=SUM(A1)'), "'=SUM(A1)");
eq('injection: at-command neutralised', CSV.neutralise('@import'), "'@import");
eq('injection: phone number preserved', CSV.neutralise('+15125551212'), '+15125551212');
eq('injection: negative number preserved', CSV.neutralise('-4.5'), '-4.5');
eq('injection: ordinary name untouched', CSV.neutralise("Joe's Plumbing"), "Joe's Plumbing");

eq('quote: comma', CSV.field('Austin, TX'), '"Austin, TX"');
eq('quote: embedded quotes', CSV.field('The "Best" Co'), '"The ""Best"" Co"');
eq('quote: newline', CSV.field('a\nb'), '"a\nb"');
eq('quote: plain passes through', CSV.field('Plumber'), 'Plumber');

const rows = [
  {
    placeId: 'ChIJabc', idSource: 'place_id', name: 'Joe\'s, "Best" Plumbing',
    category: '=cmd', addressLine: 'Austin, TX', rating: 4.9, reviewCount: 18188,
    website: 'none', placeUrl: 'https://www.google.com/maps/place/x', query: 'plumbers',
    collectedAt: 1750000000000, level: 1
  },
  {
    placeId: 'ChIJxyz', idSource: 'ftid', name: '\u0915\u0948\u0932\u093E\u0936 \u091C\u0940',
    category: '\u0928\u0932\u0938\u093E\u095B', addressLine: '', rating: null, reviewCount: null,
    website: 'unknown', placeUrl: 'https://www.google.com/maps/place/y', query: 'plumbers',
    collectedAt: 1750000000000, level: 1
  }
];

const csv = CSV.build(rows);
eq('csv starts with BOM', csv.charCodeAt(0), 0xfeff);
eq('csv uses CRLF', csv.indexOf('\r\n') > 0, true);
eq('csv ends with CRLF', csv.slice(-2), '\r\n');
eq('csv row count', csv.replace(/^\ufeff/, '').trimEnd().split('\r\n').length, 3);

const lines = csv.replace(/^\ufeff/, '').split('\r\n');
eq('csv header', lines[0].split(',')[0], 'name');
eq('csv escapes name', lines[1].indexOf('"Joe\'s, ""Best"" Plumbing"') === 0, true);
eq('csv neutralises category', lines[1].indexOf(",'=cmd,") > 0, true);
eq('csv empty numerics blank', lines[2].indexOf(',,') > 0, true);
eq('csv null rating is empty not 0', lines[2].split(',')[2], '');

eq('filename', CSV.filename('Plumbers in Austin, TX', new Date(2026, 6, 31)),
   'maps-leads-plumbers-in-austin-tx-2026-07-31.csv');
eq('filename without query', CSV.filename('', new Date(2026, 6, 31)),
   'maps-leads-2026-07-31.csv');

/* ------------------------------------------------- identifiers and merging */

// chrome is stubbed just enough for the session store to load and persist.
let persisted = null;
global.chrome = {
  runtime: { lastError: null },
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: (obj, cb) => { persisted = obj; if (cb) cb(); }
    }
  }
};

const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'common', 'debug-log.js'));
require(path.join(__dirname, '..', 'src', 'common', 'place-id.js'));
require(path.join(__dirname, '..', 'src', 'common', 'geo.js'));
require(path.join(__dirname, '..', 'src', 'common', 'filters.js'));
require(path.join(__dirname, '..', 'src', 'content', 'parser-level1.js'));
require(path.join(__dirname, '..', 'src', 'background', 'session-store.js'));
const L1 = global.MLE.parserL1;
const store = global.MLE.sessionStore;

// A result-card href carries all three identifiers.
const cardHref = 'https://www.google.com/maps/place/Love+%26+Latte/data=!4m7!3m6!1s0x3be7b6ed0a58cf27:0xe6857d3079009eb0!8m2!3d19.1858849!4d72.83024!16s%2Fg%2F11bw5t55ng!19sChIJJ89YCu225zsRsJ4AeTB9heY';
const cardIds = L1.extractIdentifiers(cardHref, 'Love & Latte');
eq('card: primary is place_id', cardIds.placeId, 'ChIJJ89YCu225zsRsJ4AeTB9heY');
eq('card: idSource', cardIds.idSource, 'place_id');
eq('card: ftid retained too', cardIds.ftid, '0x3be7b6ed0a58cf27:0xe6857d3079009eb0');
eq('card: mid retained too', cardIds.mid, '/g/11bw5t55ng');
eq('card: geo retained', cardIds.geo, '19.1858849,72.83024');

// The detail URL has NO !19s -- this is the blocker the aliases exist for.
const detailHref = 'https://www.google.com/maps/place/Love+%26+Latte/@19.18,72.83,17z/data=!3m1!4b1!4m6!3m5!1s0x3be7b6ed0a58cf27:0xe6857d3079009eb0!8m2!3d19.1858849!4d72.83024!16s%2Fg%2F11bw5t55ng?entry=ttu';
const detailIds = L1.extractIdentifiers(detailHref, 'Love & Latte');
eq('detail: no place_id present', detailIds.placeId, '0x3be7b6ed0a58cf27:0xe6857d3079009eb0');
eq('detail: falls back to ftid', detailIds.idSource, 'ftid');
eq('detail: ftid matches the card', detailIds.ftid, cardIds.ftid);
eq('detail: mid matches the card', detailIds.mid, cardIds.mid);

const K = global.MLE.K;

function l1row(over) {
  return Object.assign({
    placeId: cardIds.placeId, idSource: 'place_id', ftid: cardIds.ftid, mid: cardIds.mid,
    name: 'Love & Latte', category: 'Cafe', addressLine: 'Ground Flr, INTERFACE-11',
    rating: 4.1, reviewCount: 2850, website: K.WEBSITE.UNKNOWN,
    websiteReason: K.WEBSITE_REASON.NO_CHIP_ROW, placeUrl: 'https://x', query: 'cafe',
    collectedAt: 1750000000000, level: 1,
    provenance: { name: 'card', website: 'card' }
  }, over || {});
}

(async () => {
  await store.load();
  store.addRows([l1row()]);
  eq('store: row added', store.size(), 1);
  eq('store: starts unresolved', store.unresolvedCount(), 1);

  // The user opens the place; the detail pane proves a website and a phone.
  const patched = store.applyDetail(
    [detailIds.placeId, detailIds.mid],
    {
      website: K.WEBSITE.HAS,
      websiteReason: K.WEBSITE_REASON.DETAIL_LINK,
      websiteUrl: 'http://www.lovenlatte.com/',
      phone: '07208935965',
      fullAddress: 'Ground Flr, INTERFACE-11, Jaichandlal Karwa Marg',
      plusCode: '5RPJ+93 Mumbai'
    }
  );
  eq('detail: matched the row by ftid alias', !!patched, true);
  eq('detail: website resolved', patched.website, K.WEBSITE.HAS);
  eq('detail: url captured', patched.websiteUrl, 'http://www.lovenlatte.com/');
  eq('detail: phone captured', patched.phone, '07208935965');
  eq('detail: provenance recorded', patched.provenance.website, 'detail');
  eq('detail: level promoted', patched.level, 2);
  eq('store: now resolved', store.unresolvedCount(), 0);

  // THE REGRESSION THAT MATTERS: the user keeps scrolling, the card is
  // re-parsed, and the thinner Level-1 view must not undo any of that.
  store.addRows([l1row()]);
  const after = store.all()[0];
  eq('rescan: website survives', after.website, K.WEBSITE.HAS);
  eq('rescan: websiteUrl survives', after.websiteUrl, 'http://www.lovenlatte.com/');
  eq('rescan: phone survives', after.phone, '07208935965');
  eq('rescan: fullAddress survives', after.fullAddress, 'Ground Flr, INTERFACE-11, Jaichandlal Karwa Marg');
  eq('rescan: provenance still detail', after.provenance.website, 'detail');
  eq('rescan: no duplicate row', store.size(), 1);

  // A card field with no detail claim is still allowed to update.
  store.addRows([l1row({ reviewCount: 2900 })]);
  eq('rescan: card fields still update', store.all()[0].reviewCount, 2900);

  // An unknown place must not silently create or corrupt a row.
  eq('detail: unmatched alias is a no-op', store.applyDetail(['nope'], { phone: '1' }), null);
  eq('detail: no row invented', store.size(), 1);

  report();
})();

function report() {
/* ---------------------------------------------------------------------- report */

/* ------------------------------------ provenance and enrich_status columns */

// Values are comma-free on purpose so a plain split is safe here.
function cell(row, column) {
  const text = CSV.build([row], { bom: false });
  const lines = text.trim().split('\r\n');
  const idx = lines[0].split(',').indexOf(column);
  return lines[1].split(',')[idx];
}

const base = {
  placeId: 'ChIJz', idSource: 'place_id', name: 'Test Cafe', category: 'Cafe',
  addressLine: 'Somewhere', rating: 4.1, reviewCount: 10, placeUrl: 'https://x',
  query: 'cafe', collectedAt: 1750000000000, level: 1
};

// An undetermined website must claim no source: provenance says where a value
// came from, and there is no value.
eq('csv: unknown website has blank source',
  cell(Object.assign({}, base, { website: 'unknown', provenance: { name: 'card' } }), 'website_source'), '');
eq('csv: determined website carries its source',
  cell(Object.assign({}, base, { website: 'none', provenance: { name: 'card', website: 'card' } }), 'website_source'), 'card');
eq('csv: detail-sourced website says detail',
  cell(Object.assign({}, base, { website: 'has', provenance: { website: 'detail' } }), 'website_source'), 'detail');

eq('csv: unopened row', cell(Object.assign({}, base, { website: 'unknown' }), 'enrich_status'), 'not_opened');
eq('csv: confirmed row',
  cell(Object.assign({}, base, { website: 'has', enrich: { state: 'ok', missing: [] } }), 'enrich_status'), 'confirmed');
eq('csv: partial row',
  cell(Object.assign({}, base, { website: 'has', enrich: { state: 'partial', missing: ['phone'] } }), 'enrich_status'), 'partial');
// Kept and marked, never dropped.
eq('csv: unrepairable row is exported and labelled',
  cell(Object.assign({}, base, { website: 'unknown', aliasRepair: 'unrepairable' }), 'enrich_status'), 'unrepairable');

/* ----------------------------------------------------- geo and the filters */

const GEO = global.MLE.geo;
const F = global.MLE.filters;

eq('geo: parses lat,lng', GEO.parse('19.1858849,72.83024'), { lat: 19.1858849, lng: 72.83024 });
eq('geo: rejects rubbish', GEO.parse('not,coords'), null);
eq('geo: rejects out-of-range', GEO.parse('91,0'), null);
eq('geo: rejects empty', GEO.parse(''), null);

// The Malad session with the Bandra outlier. A mean would be dragged south;
// the median must stay in Malad.
const maladRows = [
  { geo: '19.1858,72.8302' }, { geo: '19.1911,72.8340' }, { geo: '19.1939,72.8379' },
  { geo: '19.1890,72.8339' }, { geo: '19.0649,72.8324' } // Bandra, ~14km away
];
const centre = GEO.centroid(maladRows);
eq('geo: centroid uses the median, not the mean', centre.lat, 19.189);
eq('geo: centroid counts contributing rows', centre.from, 5);
eq('geo: outlier is far from the centre', GEO.distanceFrom(centre, { geo: '19.0649,72.8324' }) > 12, true);
eq('geo: a local row is near', GEO.distanceFrom(centre, { geo: '19.1890,72.8339' }) < 1, true);
eq('geo: no coordinates means no distance', GEO.distanceFrom(centre, { geo: '' }), null);
eq('geo: coverage', GEO.coverage([{ geo: '1,1' }, { geo: '' }, { geo: '2,2' }]),
  { withGeo: 2, total: 3, rate: 0.67 });

const fRows = [
  { name: 'Alpha Cafe', category: 'Cafe', rating: 4.8, reviewCount: 500, website: 'has', geo: '19.1890,72.8339' },
  { name: 'Beta Gym', category: 'Gym', rating: 3.2, reviewCount: 12, website: 'none', geo: '19.1891,72.8340' },
  // The case the whole rule exists for: Maps showed no review count.
  { name: 'Gamma Cafe', category: 'Cafe', rating: 4.1, reviewCount: null, website: 'unknown', geo: '19.1892,72.8341' },
  { name: 'Delta Spa', category: 'Spa', rating: null, reviewCount: 3, website: 'unknown', geo: '' }
];
const fCentre = GEO.centroid(fRows);

function run(patch) {
  return F.apply(fRows, Object.assign(F.empty(), patch), { centre: fCentre });
}

eq('filter: inactive by default', F.isActive(F.empty()), false);
eq('filter: empty keeps everything', run({}).rows.length, 4);
eq('filter: website none', run({ website: 'none' }).rows.map((r) => r.name), ['Beta Gym']);
eq('filter: website unknown is selectable',
  run({ website: 'unknown' }).rows.map((r) => r.name), ['Gamma Cafe', 'Delta Spa']);
eq('filter: category substring', run({ category: 'caf' }).rows.length, 2);
eq('filter: name substring is case-insensitive', run({ name: 'BETA' }).rows.map((r) => r.name), ['Beta Gym']);
eq('filter: rating at most', run({ maxRating: 4.2 }).rows.map((r) => r.name), ['Beta Gym', 'Gamma Cafe', 'Delta Spa']);

// An unknown review count must not be treated as zero and swept into
// "fewer than 50" - that is how a lead list silently gains businesses that
// were never qualified.
const kept = run({ maxReviews: 50 });
eq('filter: unknown reviews kept by default', kept.rows.map((r) => r.name), ['Beta Gym', 'Gamma Cafe', 'Delta Spa']);
eq('filter: nothing hidden while keepUnknown is on', kept.excludedUnknown, 0);

// Only Gamma has an unknown review count. Delta's rating and coordinates are
// missing but its review count is 3, so this filter knows enough to keep it —
// unknown is per-field, not per-row.
const dropped = run({ maxReviews: 50, keepUnknown: false });
eq('filter: unknowns can be excluded deliberately',
  dropped.rows.map((r) => r.name), ['Beta Gym', 'Delta Spa']);
eq('filter: and the exclusion is counted', dropped.excludedUnknown, 1);

eq('filter: radius keeps the near ones', run({ radiusKm: 1 }).rows.length, 4);
eq('filter: a row without coordinates is unknown, not excluded',
  run({ radiusKm: 1 }).rows.some((r) => r.name === 'Delta Spa'), true);
eq('filter: excluding unknown coordinates is explicit',
  run({ radiusKm: 1, keepUnknown: false }).rows.some((r) => r.name === 'Delta Spa'), false);

eq('filter: tally', F.websiteTally(fRows), { has: 1, none: 1, unknown: 2 });

eq('csv: distance blank without coordinates',
  cell(Object.assign({}, base, { website: 'unknown' }), 'distance_km'), '');
eq('csv: distance to one decimal',
  cell(Object.assign({}, base, { website: 'unknown', distanceKm: 2.4 }), 'distance_km'), '2.4');

/* --------------------------------------------- column picker and clipboard */

const pickRow = Object.assign({}, base, {
  website: 'has', websiteUrl: 'http://x.test/', phone: '072089 35965',
  fullAddress: 'Somewhere, Mumbai, Maharashtra 400064', distanceKm: 2.4
});

eq('columns: default set is a subset of all',
  MLE.csv.DEFAULT_KEYS.every((k) => MLE.csv.COLUMNS.some((c) => c.key === k)), true);

const picked = CSV.build([pickRow], { bom: false, columns: ['name', 'phone', 'website_status'] });
eq('columns: header honours the pick', picked.split('\r\n')[0], 'name,phone,website_status');
eq('columns: row honours the pick', picked.split('\r\n')[1], 'Test Cafe,072089 35965,has');

// Order follows the canonical column order, not the order the user ticked, so
// a sheet keeps its shape between exports.
const reordered = CSV.build([pickRow], { bom: false, columns: ['website_status', 'name', 'phone'] });
eq('columns: canonical order is preserved', reordered.split('\r\n')[0], 'name,phone,website_status');

// An empty pick means "not chosen", never "a file with no columns".
eq('columns: empty pick falls back to all',
  CSV.build([pickRow], { bom: false, columns: [] }).split('\r\n')[0].split(',').length,
  MLE.csv.COLUMNS.length);
eq('columns: unknown keys are ignored',
  CSV.build([pickRow], { bom: false, columns: ['name', 'not_a_column'] }).split('\r\n')[0], 'name');

const tsv = CSV.buildTsv([pickRow], { columns: ['name', 'full_address', 'distance_km'] });
const tsvLines = tsv.split('\n');
eq('tsv: tab separated', tsvLines[0], 'name\tfull_address\tdistance_km');
// A spreadsheet paste does no quote processing, so a comma needs no quoting
// and quoting it would paste literal quote marks into the cell.
eq('tsv: commas are not quoted', tsvLines[1],
  'Test Cafe\tSomewhere, Mumbai, Maharashtra 400064\t2.4');
eq('tsv: no BOM', tsv.charCodeAt(0) === 0xfeff, false);
eq('tsv: no trailing newline', /\n$/.test(tsv), false);

// Embedded tabs and newlines would shift every later column, so they collapse.
const messy = CSV.buildTsv([Object.assign({}, base, {
  name: 'Two\tTabs\nAnd a break', website: 'unknown'
})], { columns: ['name', 'website_status'] });
eq('tsv: embedded tabs and newlines collapse',
  messy.split('\n')[1], 'Two Tabs And a break\tunknown');
eq('tsv: still one row', messy.split('\n').length, 2);

// The injection guard applies to a paste just as it does to a file.
eq('tsv: formula guard applies',
  CSV.buildTsv([Object.assign({}, base, { name: '=cmd', website: 'unknown' })],
    { columns: ['name'] }).split('\n')[1], "'=cmd");

console.log(pass + ' passed, ' + fails.length + ' failed');
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL ' + f));
  process.exit(1);
}
}
