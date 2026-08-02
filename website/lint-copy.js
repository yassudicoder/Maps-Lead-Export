/*
 * Copy lint for the landing site. Red line 6 binds website copy: the words
 * scrape / scraper / bot / automation never appear user-facing, and the
 * voice rules ban we/our/us, exclamation marks and a few false promises.
 *
 * Plain node, no dependencies, exits non-zero on failure — same convention
 * as the extension's own test scripts.
 *
 *   node website/lint-copy.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/* User-facing text: element text content plus the attributes a reader or a
   screen reader meets. Scripts and styles are not user-facing; code comments
   are checked separately below with a narrower rule set. */
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

const text = visibleText(HTML);
const failures = [];

/* Red line 6 vocabulary, plus the claims the brief forbids. */
const FORBIDDEN = [
  /\bscrap(?:e[sd]?|er[s]?|ing)\b/i,
  /\bbots?\b/i,
  /\bautomations?\b/i,
  /\bautomated?\b/i,
  /\bautomates?\b/i,
  /\bfree\s+forever\b/i,
  /\bavailable\s+now\b/i,
  /\bunlimited\b/i,
  /\blifetime\b/i,
  /\bcrawl(?:s|ed|ing|er)?\b/i,
  /\bharvest(?:s|ed|ing)?\b/i,
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

/* Comments and scripts still must not carry red-line vocabulary. */
const code = HTML.replace(visibleText(HTML), '');
const CODE_FORBIDDEN = [/\bscraper?\b/i, /\bautomations?\b/i];
for (const re of CODE_FORBIDDEN) {
  const hit = code.match(re);
  if (hit) failures.push(`forbidden vocabulary in markup/comments: "${hit[0]}"`);
}

if (failures.length) {
  console.error('lint-copy: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('lint-copy: ok');
