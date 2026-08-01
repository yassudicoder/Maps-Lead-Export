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
global.MutationObserver = function () {
  observersMade += 1;
  this.observe = function () {};
  this.disconnect = function () {
    observersDisconnected += 1;
  };
};

global.location = {
  href: 'https://www.google.com/maps/search/cafe+in+malad',
  pathname: '/maps/search/cafe+in+malad'
};

const emptyFragment = { querySelector: () => null };

// A feed has to actually exist, or detachFeed() has nothing to disconnect and
// deleting it from teardown is invisible. That is precisely how the first
// version of this file failed to catch the bug it was written for.
const feedEl = {
  isConnected: true,
  children: { length: 12 },
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => []
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

/* ---------------------------------------------------------------- teardown */

(async () => {
  // Let the recheck tick attach the feed, so there is a live observer to stop.
  await sleep(1200);
  eq('running: feed observer attached', observersMade > 0, true);

  const ref = global.__MLE_COLLECTOR__;
  const observersAtTeardown = observersMade;
  ref.teardown();

  eq('teardown: clears the recheck interval', liveIntervals.size, 0);
  eq('teardown: disconnects the port', portDisconnected, 1);
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
  eq('teardown: second call is a no-op', portDisconnected, 1);

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
