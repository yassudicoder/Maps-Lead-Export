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

/* ---------------------------------------------------------------------- report */

console.log(pass + ' passed, ' + fails.length + ' failed');
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL ' + f));
  process.exit(1);
}
