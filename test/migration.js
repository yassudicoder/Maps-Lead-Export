// Regression test for the field failure: enrichment silently did nothing on
// any session collected before Level-2 existed.
//
// Rows persisted by M1 carry only `placeId`. A place detail pane produces
// aliases of [ftid, mid] and never a place id, so those rows matched nothing,
// applyDetail returned null, and the worker returned without a word. The row
// stayed "unknown" forever and there was no way to see why.
//
// Separate from unit.js because the store memoises its load(), so a pre-seeded
// session has to be established in a fresh process.
global.self = global;
const path = require('node:path');
const SRC = path.join(__dirname, '..', 'src');

let stored = null;
global.chrome = {
  runtime: { lastError: null, getManifest: () => ({ version: '0.0.0' }) },
  i18n: { getUILanguage: () => 'en-GB' },
  storage: {
    local: {
      get: (keys, cb) => cb(stored ? { 'mle.session.v1': stored } : {}),
      set: (obj, cb) => { stored = obj['mle.session.v1']; if (cb) cb(); }
    }
  }
};

require(path.join(SRC, 'common', 'constants.js'));
require(path.join(SRC, 'common', 'text.js'));
require(path.join(SRC, 'common', 'debug-log.js'));
require(path.join(SRC, 'common', 'place-id.js'));
require(path.join(SRC, 'background', 'session-store.js'));

const store = global.MLE.sessionStore;
const dbg = global.MLE.debugLog;

let pass = 0;
const fails = [];
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else fails.push(label + '\n     got ' + a + '\n     want ' + e);
}

// Exactly the shape M1 wrote: no ftid, no mid, but placeUrl retains /data=!...
const FTID = '0x3be7b6ed0a58cf27:0xe6857d3079009eb0';
const MID = '/g/11bw5t55ng';
stored = {
  version: 1,
  savedAt: Date.now(),
  query: 'cafe in malad west near station',
  rows: [
    {
      placeId: 'ChIJJ89YCu225zsRsJ4AeTB9heY', idSource: 'place_id',
      name: 'Love & Latte Malad', category: 'Cafe',
      addressLine: 'Ground Flr, INTERFACE-11', rating: 4.1, reviewCount: 2850,
      website: 'unknown', websiteReason: 'no-chip-row',
      placeUrl: 'https://www.google.com/maps/place/Love+%26+Latte+Malad/data=!4m7!3m6!1s' +
        FTID + '!8m2!3d19.1858849!4d72.83024!16s%2Fg%2F11bw5t55ng!19sChIJJ89YCu225zsRsJ4AeTB9heY',
      query: 'cafe', collectedAt: 1750000000000, level: 1,
      provenance: { name: 'card', website: 'card' }
    },
    // A row whose placeUrl carries no identifiers at all cannot be repaired,
    // and must be reported rather than silently skipped.
    {
      placeId: 'name:beyond-repair', idSource: 'name', name: 'Beyond Repair',
      category: 'Cafe', addressLine: '', rating: null, reviewCount: null,
      website: 'unknown', websiteReason: 'no-chip-row',
      placeUrl: 'https://www.google.com/maps/place/Beyond+Repair',
      query: 'cafe', collectedAt: 1750000000000, level: 1, provenance: {}
    }
  ]
};

(async () => {
  await store.load();

  const row = store.all()[0];
  eq('migration: ftid recovered from placeUrl', row.ftid, FTID);
  eq('migration: mid recovered from placeUrl', row.mid, MID);
  eq('migration: session not discarded', store.size(), 2);

  const migrateEvent = dbg.all().find((e) => e.type === 'migrate:aliases');
  eq('migration: logged', !!migrateEvent, true);
  eq('migration: counted repairable', migrateEvent.data.repaired, 1);
  eq('migration: counted unrepairable', migrateEvent.data.unrepairable, 1);

  // The detail pane's aliases: ftid and mid, never a place id.
  const res = store.applyDetail([FTID, MID], {
    website: 'has', websiteReason: 'detail-link',
    websiteUrl: 'http://www.lovenlatte.com/', phone: '07208935965',
    fullAddress: 'Ground Flr, INTERFACE-11, Mumbai, Maharashtra 400064',
    plusCode: '5RPJ+93 Mumbai, Maharashtra'
  });
  eq('enrich: matched a pre-M2 row', !!res, true);
  eq('enrich: matched via ftid', res && res.website, 'has');
  eq('enrich: phone applied', res && res.phone, '07208935965');
  eq('enrich: provenance is detail', res && res.provenance.website, 'detail');
  eq('enrich: status chip ok', res && res.enrich.state, 'ok');
  eq('store: nothing left unresolved', store.unresolvedCount(), 1); // the unrepairable row

  // A pane that yields only a website must read as partial, not as success.
  const partial = store.applyDetail([FTID], { website: 'none', websiteReason: 'detail-no-link' });
  eq('enrich: partial is visible', partial.enrich.state, 'partial');
  eq('enrich: partial names the gaps', partial.enrich.missing, ['phone', 'fullAddress', 'plusCode']);

  // An unmatched pane must leave a diagnosable trace rather than nothing.
  store.applyDetail(['0xdead:0xbeef'], { website: 'has' });
  const unmatched = dbg.all().filter((e) => e.type === 'detail:unmatched');
  eq('log: unmatched recorded', unmatched.length, 1);
  eq('log: unmatched names the aliases tried', unmatched[0].data.aliases, ['0xdead:0xbeef']);
  eq('log: unmatched reports index size', unmatched[0].data.aliasesIndexed > 0, true);

  console.log(pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) {
    fails.forEach((f) => console.log('  FAIL ' + f));
    process.exit(1);
  }
})();
