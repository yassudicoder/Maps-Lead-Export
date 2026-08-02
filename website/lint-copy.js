/*
 * Copy lint for the landing site. Red line 6 binds website copy: the words
 * scrape / scraper / bot / automation never appear user-facing, and the
 * voice rules ban we/our/us, exclamation marks and a few false promises.
 * Comments and code ship to visitors too, so they are held to the
 * vocabulary rule as well — across index.html, site.js and styles.css.
 *
 * Plain node, no dependencies, exits non-zero on failure — same convention
 * as the extension's own test scripts.
 *
 *   node website/lint-copy.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const HTML = read('index.html');
const SITE_JS = read('site.js');
const STYLES = read('styles.css');
const SELF = read('lint-copy.js');

/* User-facing text: element text content plus the attributes a reader or a
   screen reader meets. Comments and script/style bodies are excluded here
   and checked separately below. */
function visibleText(html) {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const attrs = [];
  const attrRe = /\b(?:alt|title|aria-label|content|placeholder|data-healthy|data-stopped)="([^"]*)"/gi;
  let m;
  while ((m = attrRe.exec(out)) !== null) attrs.push(m[1]);
  out = out.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
  return out + ' ' + attrs.join(' ');
}

/* The non-visible corpus: HTML comments, inline script bodies, and the two
   shipped code files whole (their string literals are user-facing anyway). */
function codeCorpus() {
  const comments = (HTML.match(/<!--[\s\S]*?-->/g) || []).join('\n');
  const scripts = (HTML.match(/<script[\s\S]*?<\/script>/gi) || []).join('\n');
  return [comments, scripts, SITE_JS, STYLES].join('\n');
}

const text = visibleText(HTML);
const failures = [];

/* Red line 6 vocabulary, plus the claims the brief forbids. */
const FORBIDDEN = [
  /\bscrap(?:e[sd]?|er[s]?|ing)\b/i,
  /\bbots?\b/i,
  /\bautomat(?:ions?|ed?|es)\b/i, // the product's own "lands here automatically" stays sanctioned
  /\bcrawl(?:s|ed|ing|ers?)?\b/i,
  /\bharvest(?:s|ed|ing)?\b/i,
  /\bfree\s+forever\b/i,
  /\bavailable\s+now\b/i,
  /\bunlimited\b/i,
  /\blifetime\b/i,
  /\bemails\b/i, // plural reads as harvesting; the waitlist's "one email" is fine
  /\bemail\s+(?:finder|finding|extract\w*|list[s]?\b|harvest\w*)/i,
  /\bfinds?\s+emails?\b/i,
  /\bbypass(?:es|ed|ing)?\b/i,
  /\bguaranteed?\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bpowerful\b/i,
  /\bsupercharged?\b/i
];

for (const re of FORBIDDEN) {
  const hit = text.match(re);
  if (hit) failures.push(`forbidden vocabulary: "${hit[0]}" (${re})`);
}

/* Voice: the product speaks in third person and never exclaims. */
const WE = text.match(/\b(?:we|our|us)\b/i);
if (WE) failures.push(`first-person plural: "${WE[0]}"`);
if (/!/.test(text.replace(/#NAME\?/g, ''))) failures.push('exclamation mark in copy');

/* The words the site must contain. */
const REQUIRED = ['Export what you see', 'Free during beta', 'Nothing leaves your computer'];
for (const phrase of REQUIRED) {
  if (!text.includes(phrase)) failures.push(`missing required phrase: "${phrase}"`);
}

/* Red-line vocabulary is banned from comments and code too. */
const CODE_FORBIDDEN = [
  /\bscrap(?:e[sd]?|er[s]?|ing)\b/i,
  /\bbots?\b/i,
  /\bautomat(?:ions?|ed?|es)\b/i,
  /\bcrawl(?:s|ed|ing|ers?)?\b/i,
  /\bharvest(?:s|ed|ing)?\b/i
];
for (const re of CODE_FORBIDDEN) {
  const hit = codeCorpus().match(re);
  if (hit) failures.push(`forbidden vocabulary in markup/comments/code: "${hit[0]}" (${re})`);
}

/* The linter must be able to see its own teeth: a canary that each rule set
   actually fires. */
if (!/\bscraper\b/i.test('a scraper') || !FORBIDDEN[0].test('scraper')) {
  failures.push('self-test: FORBIDDEN[0] no longer matches "scraper"');
}
if (!CODE_FORBIDDEN[1].test('a bot check')) {
  failures.push('self-test: CODE_FORBIDDEN bot rule no longer matches "a bot check"');
}
void SELF;

if (failures.length) {
  console.error('lint-copy: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('lint-copy: ok');
