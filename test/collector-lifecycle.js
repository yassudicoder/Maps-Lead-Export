                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                // Lifecycle coverage for the collector.
//
// This file exists because collector.js has now shipped two lifecycle bugs that
// nothing caught: a setInterval leaked on every toolbar re-click, and teardown
// lost the three lines that stop the observer, the interval and the collector
// itself. Neither is a syntax error, so `node --check` passed both times, and
// no other test loads this file.
//
// The DOM is stubbed to the minimum the collector touches. That is enough to
// exercise start-up, re-init, teardown and every relay refusal path, which is
// where both bugs lived.
global.self = global;
const path = require('node:path');
const SRC = path.join(__dirname, '..', 'src');

let pass = 0;
const fails = [];
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else fails.push(label + '\n     got ' + a + '\n     want ' + e);
}

/* ------------------------------------------------------------------- stubs */

const liveIntervals = new Set();
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
global.setInterval = function (fn, ms) {
  const id = realSetInterval(fn, ms);
  if (id && typeof id.unref === 'function') id.unref();
  liveIntervals.add(id);
  return id;
};
global.clearInterval = function (id) {
  liveIntervals.delete(id);
  return realClearInterval(id);
};

let observersMade = 0;
let observersDisconnected = 0;
/** The live observer callback, so a test can stand in for Maps redrawing. */
let observerFn = null;
global.MutationObserver = function (fn) {
  observersMade += 1;
  observerFn = fn;
  this.observe = function () {};
  this.disconnect = function () {
    observersDisconnected += 1;
    if (observerFn === fn) observerFn = null;
  };
};

function fireMutation() {
  if (observerFn) observerFn([]);
}

global.location = {
  href: 'https://www.google.com/maps/search/cafe+in+malad',
  pathname: '/maps/search/cafe+in+malad'
};

const emptyFragment = { querySelector: () => null };

// A feed has to actually exist, or detachFeed() has nothing to disconnect and
// deleting it from teardown is invisible. That is precisely how the first
// version of this file failed to catch the bug it was written for.
/** Cards the stub feed is currently rendering. Swapped per E2 scenario. */
let cards = [];

const feedEl = {
  isConnected: true,
  children: { length: 12 },
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  // The parser asks for cards by selector and for place links inside them; the
  // feed itself is also asked for place links when identity is being decided.
  querySelectorAll: (sel) => {
    if (/article|Nv2PK|:scope/.test(sel)) return cards.map((c) => c.card);
    if (/place/.test(sel)) return cards.map((c) => c.link);
    return [];
  },
  // Viewport is 0..600, so a card at top 2000 is genuinely off-screen and
  // "should we scroll?" is a real decision rather than an assumption.
  getBoundingClientRect: () => ({ top: 0, bottom: 600 })
};

global.document = {
  querySelector: (sel) => (sel === 'div[role="feed"]' ? feedEl : null),
  querySelectorAll: () => [],
  createDocumentFragment: () => emptyFragment
};

const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
const realSetTimeout = global.setTimeout;

const pageListeners = {};
global.addEventListener = function (type, fn) {
  pageListeners[type] = fn;
};

let sent = [];
let deliver = null;
let portDisconnected = 0;
global.chrome = {
  runtime: {
    connect: function () {
      return {
        postMessage: (m) => sent.push(m),
        onMessage: { addListener: (f) => { deliver = f; } },
        onDisconnect: { addListener: () => {} },
        disconnect: () => { portDisconnected += 1; }
      };
    }
  }
};

require(path.join(SRC, 'common', 'constants.js'));
require(path.join(SRC, 'common', 'text.js'));
require(path.join(SRC, 'common', 'place-id.js'));
require(path.join(SRC, 'common', 'selector-schema.js'));
require(path.join(SRC, 'content', 'parser-level1.js'));
require(path.join(SRC, 'content', 'parser-level2.js'));

const K = global.MLE.K;
const SELECTORS = require(path.join(__dirname, '..', 'config', 'selectors.json'));

function loadCollector() {
  const p = path.join(SRC, 'content', 'collector.js');
  delete require.cache[require.resolve(p)];
  sent = [];
  deliver = null;
  require(p);
}

function init() {
  const v = global.MLE.selectorSchema.validate(SELECTORS);
  if (!v.ok) throw new Error('selector map invalid: ' + v.errors.join(', '));
  deliver({ type: K.MSG.INIT, selectors: v.value });
}

function lastOpenResult() {
  const r = sent.filter((m) => m.type === K.MSG.OPEN_RESULT);
  return r.length ? r[r.length - 1] : null;
}

/* ------------------------------------------------------- start-up and init */

loadCollector();
eq('startup: announces itself', sent[0] && sent[0].type, K.MSG.HELLO);
eq('startup: collector registered', typeof global.__MLE_COLLECTOR__, 'object');
eq('startup: no interval before init', liveIntervals.size, 0);

init();
eq('init: one recheck interval', liveIntervals.size, 1);

// The regression that shipped once: INIT arrives again on every toolbar
// re-click, and startRecheck must not strand the previous interval.
init();
init();
eq('re-init: still exactly one interval', liveIntervals.size, 1);

/* -------------------------------------------------------------- relay (E1) */

// A gesture that is not fresh must never be honoured: that is what stops a
// relay being replayed or queued into something resembling automation.
deliver({
  type: K.MSG.OPEN_ROW,
  aliases: ['0xabc:0xdef'],
  token: 'stale',
  gestureAt: Date.now() - (K.RELAY_GESTURE_MAX_AGE_MS + 1000)
});
eq('relay: stale gesture refused', lastOpenResult(), {
  type: K.MSG.OPEN_RESULT, ok: false, reason: 'stale-gesture', token: 'stale'
});

// No feed is rendered in this stub, so no card can match. The boundary in the
// E1 ruling says that is a hint, never a scroll.
deliver({
  type: K.MSG.OPEN_ROW, aliases: ['0xabc:0xdef'], token: 'fresh', gestureAt: Date.now()
});
eq('relay: unrendered card refused', lastOpenResult(), {
  type: K.MSG.OPEN_RESULT, ok: false, reason: 'not-rendered', token: 'fresh'
});
eq('relay: nothing scheduled a retry', liveIntervals.size, 1);

// A refusal must not hold the gate shut. The user has to be able to press
// again immediately, and a second refusal proves nothing latched.
deliver({
  type: K.MSG.OPEN_ROW, aliases: ['0xabc:0xdef'], token: 'fresh2', gestureAt: Date.now()
});
eq('relay: a refusal does not latch the gate', lastOpenResult(), {
  type: K.MSG.OPEN_RESULT, ok: false, reason: 'not-rendered', token: 'fresh2'
});

// The accelerator's whole safety property, stated as a test: across every
// message handled so far, the collector must never have originated an open of
// its own. Only OPEN_RESULT replies exist, never a self-issued OPEN_ROW.
eq('relay: collector never originates an open',
  sent.filter((m) => m.type === K.MSG.OPEN_ROW).length, 0);

/* ------------------------------------------------ E2: anchored positioning */

// Three feed shapes, per the A6.1 fixture directive:
//   1. the target is rendered but scrolled out of the viewport
//   2. Maps has pruned the target, but collected neighbours survive
//   3. the feed has been re-rendered entirely by a new search
//
// The stub feed reports geometry, so "off-viewport" is a real decision rather
// than an assumption.
const TARGET = '0x1111:0x1111';
const NEIGHBOUR = '0x2222:0x2222';

function makeCard(ftid, top) {
  const link = {
    tagName: 'A',
    href: 'https://www.google.com/maps/place/X/data=!1s' + ftid +
      '!16s%2Fg%2F' + ftid.slice(2, 8) + '!19sChIJ' + ftid.slice(2, 12) + 'abcd',
    getAttribute: (n) => (n === 'href' ? link.href : n === 'aria-label' ? 'Test Place' : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    clicked: 0,
    click() { link.clicked += 1; }
  };
  const card = {
    scrolledIntoView: 0,
    getBoundingClientRect: () => ({ top: top, bottom: top + 80 }),
    scrollIntoView() { card.scrolledIntoView += 1; },
    querySelector: (sel) => (/place/.test(sel) ? link : null),
    querySelectorAll: (sel) => (/place/.test(sel) ? [link] : []),
    getElementsByTagName: () => [],
    cloneNode: () => ({ children: [], querySelectorAll: () => [] })
  };
  return { card: card, link: link };
}

/**
 * Run one E2 scenario against a freshly loaded collector.
 *
 * A fresh collector per scenario rather than a test seam on the production
 * object: the relay lock is released only by a finished pane, and reaching in
 * to unlatch it would be testing a hatch that does not ship.
 */
async function e2Scenario(build) {
  if (global.__MLE_COLLECTOR__) global.__MLE_COLLECTOR__.teardown();
  cards = [];
  loadCollector();
  init();
  await sleep(220); // the scan debounce
  return build();
}

async function rescan() {
  fireMutation();
  await sleep(220);
}

console.log('');

(async () => {
  /* 1. rendered but off-viewport -> position, then activate, one gesture */
  const offscreen = makeCard(TARGET, 2000);
  await e2Scenario(() => { cards = [offscreen]; });
  await rescan();
  sent.length = 0;
  deliver({ type: K.MSG.OPEN_ROW, aliases: [TARGET], token: 'e2a', gestureAt: Date.now() });

  const r1 = sent.filter((m) => m.type === K.MSG.OPEN_RESULT).pop();
  eq('E2: off-viewport card is positioned', offscreen.card.scrolledIntoView, 1);
  eq('E2: and activated on the same gesture', offscreen.link.clicked, 1);
  eq('E2: reported as positioned', { ok: r1.ok, how: r1.how }, { ok: true, how: 'positioned' });

  /* 1b. already visible -> no scroll at all */
  const visible = makeCard(TARGET, 100);
  await e2Scenario(() => { cards = [visible]; });
  await rescan();
  sent.length = 0;
  deliver({ type: K.MSG.OPEN_ROW, aliases: [TARGET], token: 'e2b', gestureAt: Date.now() });
  const r1b = sent.filter((m) => m.type === K.MSG.OPEN_RESULT).pop();
  eq('E2: a visible card is not scrolled', visible.card.scrolledIntoView, 0);
  eq('E2: and still activates', visible.link.clicked, 1);
  eq('E2: reported as visible', r1b.how, 'visible');

  /* 2. pruned target, surviving neighbour -> position it, navigate nothing */
  const target2 = makeCard(TARGET, 100);
  const neighbour = makeCard(NEIGHBOUR, 2000);
  await e2Scenario(() => { cards = [target2, neighbour]; });
  await rescan(); // both seen, so both have a recorded feed position
  cards = [neighbour]; // Maps prunes the target
  await rescan();

  sent.length = 0;
  deliver({ type: K.MSG.OPEN_ROW, aliases: [TARGET], token: 'e2c', gestureAt: Date.now() });
  const r2 = sent.filter((m) => m.type === K.MSG.OPEN_RESULT).pop();
  eq('E2: neighbour is positioned', neighbour.card.scrolledIntoView, 1);
  eq('E2: pruned is reported, not a dead end',
    { ok: r2.ok, reason: r2.reason }, { ok: false, reason: 'pruned' });
  // The load-bearing one: a fallback scroll must navigate nowhere.
  eq('E2: the neighbour was not activated', neighbour.link.clicked, 0);
  eq('E2: and neither was the target', target2.link.clicked, 0);

  // Maps re-renders the card; the observer re-links and the control re-arms.
  sent.length = 0;
  const restored = makeCard(TARGET, 300);
  cards = [restored, neighbour];
  await rescan();
  const rearm = sent.filter((m) => m.type === K.MSG.RELAY_REARM).pop();
  eq('E2: re-link re-arms the control', rearm && rearm.ok, true);
  // Re-arming is not advancing: nothing opens without another human press.
  eq('E2: re-arming opened nothing', restored.link.clicked, 0);
  eq('E2: and scrolled nothing further', restored.card.scrolledIntoView, 0);

  /* 3. feed re-rendered by a new search -> nothing to anchor to */
  const stranger = makeCard('0x9999:0x9999', 100);
  await e2Scenario(() => { cards = [stranger]; });
  await rescan();
  sent.length = 0;
  deliver({ type: K.MSG.OPEN_ROW, aliases: [TARGET], token: 'e2d', gestureAt: Date.now() });
  const r3 = sent.filter((m) => m.type === K.MSG.OPEN_RESULT).pop();
  eq('E2: an unknown target cannot be anchored', r3.reason, 'not-rendered');
  eq('E2: so nothing was scrolled', stranger.card.scrolledIntoView, 0);
  eq('E2: and nothing was clicked', stranger.link.clicked, 0);

  // One scroll per gesture across every path, and never a loop: two gestures
  // scrolled (off-viewport, pruned-neighbour), two did not.
  eq('E2: exactly one scroll per scrolling gesture',
    offscreen.card.scrolledIntoView + visible.card.scrolledIntoView +
    neighbour.card.scrolledIntoView + stranger.card.scrolledIntoView, 2);

  /* ------------------------------------------------------------- teardown */

  if (global.__MLE_COLLECTOR__) global.__MLE_COLLECTOR__.teardown();
  cards = [];
  loadCollector();
  init();
  // Every E2 scenario above loaded and tore down its own collector, so these
  // counters are measured as deltas rather than absolutes.
  const disconnectsBefore = portDisconnected;
  // Let the recheck tick attach the feed, so there is a live observer to stop.
  await sleep(1200);
  eq('running: feed observer attached', observersMade > 0, true);

  const ref = global.__MLE_COLLECTOR__;
  const observersAtTeardown = observersMade;
  ref.teardown();

  eq('teardown: clears the recheck interval', liveIntervals.size, 0);
  eq('teardown: disconnects the port', portDisconnected - disconnectsBefore, 1);
  eq('teardown: unregisters the collector', typeof global.__MLE_COLLECTOR__, 'undefined');
  eq('teardown: disconnects the feed observer', observersDisconnected, observersAtTeardown);

  // The real proof, and what the first version of this file missed: a torn-down
  // collector must be inert. If teardown leaves `stopped` false and the
  // interval alive, the next tick re-attaches the feed and builds another
  // observer -- silently, forever, on every hard navigation.
  const observersAfter = observersMade;
  const messagesAfter = sent.length;
  await sleep(1400);
  eq('teardown: no observer created afterwards', observersMade, observersAfter);
  eq('teardown: no messages posted afterwards', sent.length, messagesAfter);

  // Idempotent: a second call must do nothing rather than re-run the body.
  ref.teardown();
  eq('teardown: second call is a no-op', portDisconnected - disconnectsBefore, 1);

  /* ---------------------------------------------------- re-injection guard */

  loadCollector();
  init();
  eq('guard: one interval after init', liveIntervals.size, 1);
  loadCollector(); // the user clicking the toolbar icon again
  eq('guard: re-injection did not add an interval', liveIntervals.size, 1);
  eq('guard: re-injection re-announced', sent.some((m) => m.type === K.MSG.HELLO), true);

  global.__MLE_COLLECTOR__.teardown();
  eq('final: no intervals left running', liveIntervals.size, 0);

  console.log(pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) {
    fails.forEach((f) => console.log('  FAIL ' + f));
    process.exit(1);
  }
})();
