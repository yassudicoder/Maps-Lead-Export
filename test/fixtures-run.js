// Runs the real parsers against the captured DOM fixtures.
//
// The parsers need a DOM and there is no jsdom here, so this drives headless
// Chromium directly over the DevTools protocol (Node 24 has WebSocket built
// in). No packages.
//
// Set MLE_CHROME to override the browser path.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const PORT = 9412;

const CHROME = process.env.MLE_CHROME || [
  'C:\\Users\\yashd\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });

let pass = 0;
const fails = [];
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else fails.push(label + '\n     got ' + a + '\n     want ' + e);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m.result || m.error);
        this.pending.delete(m.id);
      }
    });
    this.ready = new Promise((r) => this.ws.addEventListener('open', r));
  }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res) => this.pending.set(id, res));
  }
}

const SOURCES = [
  'src/common/constants.js',
  'src/common/text.js',
  'src/common/place-id.js',
  'src/common/selector-schema.js',
  'src/content/parser-level1.js',
  'src/content/parser-level2.js'
];

(async () => {
  if (!CHROME) {
    console.log('SKIP: no Chromium found. Set MLE_CHROME to a browser path.');
    process.exit(0);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mle-fix-'));
  const child = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await fetch('http://127.0.0.1:' + PORT + '/json/list').then((r) => r.json());
      target = list.find((t) => t.type === 'page');
    } catch (_) { await sleep(250); }
  }
  if (!target) { console.log('FAIL: chrome did not start'); child.kill(); process.exit(2); }

  const s = new Session(target.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Runtime.enable');

  const bundle = SOURCES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const selectors = fs.readFileSync(path.join(ROOT, 'config', 'selectors.json'), 'utf8');

  async function run(expression) {
    const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' +
        (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    }
    return r && r.result ? r.result.value : null;
  }

  function load(fixtureFile) {
    const html = fs.readFileSync(path.join(FIXTURES, fixtureFile), 'utf8');
    return run(`(function () {
      document.body.innerHTML = ${JSON.stringify(html)};
      ${bundle}
      var v = self.MLE.selectorSchema.validate(${selectors});
      if (!v.ok) return { error: 'selector map invalid', errors: v.errors };
      self.__SEL__ = self.MLE.selectorSchema.compileFilter(v.value, document).value;
      return { ok: true };
    })()`);
  }

  /* --------------------------------------------- consumer feed, no chip row */

  let r = await load('feed-consumer-en-GB.html');
  eq('consumer fixture loads', r && r.ok, true);

  r = await run(`(function () {
    var feed = document.querySelector('div[role="feed"]');
    var res = self.MLE.parserL1.parseFeed(feed, self.__SEL__, { query: 'cafe in malad west near station' });
    var row = res.rows[0];
    return { stats: res.stats, row: row };
  })()`);

  eq('consumer: feed identified', r.stats.identified, true);
  eq('consumer: one place link', r.stats.placeLinks, 1);
  eq('consumer: seen equals cards', r.stats.seen, 1);
  eq('consumer: parsed', r.stats.parsed, 1);
  eq('consumer: name', r.row.name, 'Love & Latte Malad');
  eq('consumer: category', r.row.category, 'Cafe');
  eq('consumer: address', r.row.addressLine,
    'Ground Flr, INTERFACE-11, Jaichandlal Karwa Marg, behind New Infiniti Mall, off New Link Road');
  eq('consumer: rating', r.row.rating, 4.1);
  eq('consumer: reviews', r.row.reviewCount, 2850);
  // The whole point of the tri-state: no chip row means no claim either way.
  eq('consumer: website unknown', r.row.website, 'unknown');
  eq('consumer: reason is no-chip-row', r.row.websiteReason, 'no-chip-row');
  eq('consumer: place id', r.row.placeId, 'ChIJJ89YCu225zsRsJ4AeTB9heY');
  eq('consumer: ftid alias', r.row.ftid, '0x3be7b6ed0a58cf27:0xe6857d3079009eb0');
  eq('consumer: mid alias', r.row.mid, '/g/11bw5t55ng');
  eq('consumer: geo', r.row.geo, '19.1858849,72.83024');
  // A price band sits between category and address in this layout.
  eq('consumer: price band not mistaken for address', /₹/.test(r.row.addressLine), false);

  /* ------------------------------------------------ service feed, chip row */

  r = await load('feed-sponsored-chips-en-US.html');
  eq('chips fixture loads', r && r.ok, true);

  r = await run(`(function () {
    var feed = document.querySelector('div[role="feed"]');
    var res = self.MLE.parserL1.parseFeed(feed, self.__SEL__, { query: 'plumbers in austin tx' });
    return { stats: res.stats, row: res.rows[0] };
  })()`);

  eq('chips: feed identified', r.stats.identified, true);
  eq('chips: parsed', r.stats.parsed, 1);
  eq('chips: name', r.row.name, 'Quick Dry Restoration');
  eq('chips: category', r.row.category, 'Water damage restoration service');
  eq('chips: rating', r.row.rating, 4.5);
  eq('chips: reviews', r.row.reviewCount, 375);
  eq('chips: website has', r.row.website, 'has');
  eq('chips: reason is chip', r.row.websiteReason, 'chip');

  /* ------------------------------------------------------- feed identity */

  r = await run(`(function () {
    // Something feed-shaped with children but no place links: a reviews list,
    // a photo grid, or a results pane that has not rendered. This must not be
    // scored as a parse failure.
    document.body.innerHTML =
      '<div role="feed"><div>a</div><div>b</div><div>c</div><div>d</div>' +
      '<div>e</div><div>f</div><div>g</div><div>h</div><div>i</div><div>j</div></div>';
    var feed = document.querySelector('div[role="feed"]');
    var id = self.MLE.parserL1.identifyFeed(feed, self.__SEL__);
    var res = self.MLE.parserL1.parseFeed(feed, self.__SEL__, {});
    return { id: id, stats: res.stats, rows: res.rows.length };
  })()`);

  eq('identity: rejects a feed with no place links', r.id.isFeed, false);
  eq('identity: children counted for the log', r.id.children, 10);
  eq('identity: parseFeed reports not-identified', r.stats.identified, false);
  // The regression this whole task is about: `seen` must not become 10.
  eq('identity: seen is zero, not the child count', r.stats.seen, 0);
  eq('identity: no rows invented', r.rows, 0);

  /* -------------------------------------------------------- detail pane */

  r = await load('place-detail-no-website-en-GB.html');
  eq('detail fixture loads', r && r.ok, true);

  r = await run(`(function () {
    var href = 'https://www.google.com/maps/place/Cafe+Sentiments/data=' +
      '!4m7!3m6!1s0x3be7b71fe366e8ab:0xc342d8122618d832!8m2!3d19.1911866!4d72.8340773' +
      '!16s%2Fg%2F11ynz_nhcd';
    return self.MLE.parserL2.readDetail(document, self.__SEL__, href);
  })()`);

  eq('detail: pane read', !!r, true);
  eq('detail: name', r.name, 'Cafe Sentiments');
  // Proven absence, the only place "none" can be stated with confidence.
  eq('detail: website none', r.patch.website, 'none');
  eq('detail: reason is detail-no-link', r.patch.websiteReason, 'detail-no-link');
  eq('detail: phone from the attribute', r.patch.phone, '09967797857');
  eq('detail: full address has a postcode', /400064$/.test(r.patch.fullAddress), true);
  // The aria-label prefix "Address: " is localised and must not leak in.
  eq('detail: address is not the aria-label', /^Address:/.test(r.patch.fullAddress), false);
  eq('detail: plus code', r.patch.plusCode, '5RRM+FJ Mumbai, Maharashtra');
  // The detail URL has no !19s, so matching depends entirely on the aliases.
  eq('detail: aliases are ftid and mid', r.aliases,
    ['0x3be7b71fe366e8ab:0xc342d8122618d832', '/g/11ynz_nhcd']);

  child.kill();
  await sleep(200);

  console.log(pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) {
    fails.forEach((f) => console.log('  FAIL ' + f));
    process.exit(1);
  }
})().catch((e) => { console.log('harness error: ' + (e && e.stack || e)); process.exit(2); });
