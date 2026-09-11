'use strict';

// Regression tests for plugin/src/src/transform.js. Unlike a typical TRMNL polling plugin (static
// input.data, synchronous transform(input)), this one does its own async fetching inside run()
// (ICS feeds, Open-Meteo, an RSS/Atom feed) and reads/writes saved state across refreshes — so
// this harness deviates from the generic test-transform template: it mocks fetch per test case
// and lets a test drive several sequential run() calls (feeding one call's returned trmnl_state
// into the next as input.trmnl.state), rather than a single static input -> static output case.
//
// Run with: npm test  (from this directory) — no Docker needed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TRANSFORM_PATH = process.env.TRANSFORM_PATH
  || path.join(__dirname, '../../plugin/src/src/transform.js');

const TRANSFORM_SRC = fs.readFileSync(TRANSFORM_PATH, 'utf-8');

// A Date subclass fixed at `ms` for `new Date()` / `Date.now()` — everything else (parsing a
// specific date string, etc.) still behaves like the real Date. Lets a test control "now"
// precisely across several sequential run() calls, to exercise threshold/saved-state logic
// (calendar-down, weather-stale) without waiting on a real clock.
function makeFakeDate(getNowMs) {
  const RealDate = Date;
  return class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(getNowMs());
      else super(...args);
    }
    static now() { return getNowMs(); }
  };
}

// Loads a fresh copy of transform.js into its own vm context (module-level state like any
// caches never leaks between calls/tests), with `fetchImpl` standing in for the real network
// and, if `nowMs` is given, Date/Date.now() pinned for every call made against the returned
// `run`/`parseConfig` — call `run(input)` with just the one argument transform.js itself
// expects; fetch and the clock are already baked into this sandbox, not passed per-call.
function runTransform(fetchImpl, nowMs) {
  const sandbox = {
    fetch: fetchImpl,
    console,
    Date: nowMs != null ? makeFakeDate(() => nowMs) : Date,
    Math, Array, Object, JSON, String, Number, Boolean, RegExp, Promise, Map, Set,
    AbortController, setTimeout, clearTimeout, URLSearchParams, Intl,
    module: { exports: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(TRANSFORM_SRC + '\nmodule.exports = { run, parseConfig };', sandbox);
  return sandbox.module.exports;
}

function icsWithEvents(events) {
  let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n';
  for (const e of events) {
    s += 'BEGIN:VEVENT\r\nUID:' + (e.uid || Math.random()) + '\r\n';
    if (e.allDay) {
      s += 'DTSTART;VALUE=DATE:' + e.start + '\r\nDTEND;VALUE=DATE:' + e.end + '\r\n';
    } else {
      s += 'DTSTART:' + e.start + '\r\nDTEND:' + e.end + '\r\n';
    }
    s += 'SUMMARY:' + e.summary + '\r\n';
    if (e.description) s += 'DESCRIPTION:' + e.description + '\r\n';
    if (e.status) s += 'STATUS:' + e.status + '\r\n';
    if (e.calname) s = s.replace('BEGIN:VEVENT', 'X-WR-CALNAME:' + e.calname + '\r\nBEGIN:VEVENT');
    s += 'END:VEVENT\r\n';
  }
  s += 'END:VCALENDAR\r\n';
  return s;
}

function okText(text) { return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }; }
function okJson(obj) { return { ok: true, status: 200, text: async () => JSON.stringify(obj), json: async () => obj }; }
function fail(status) { return { ok: false, status, text: async () => '', json: async () => ({}) }; }

function baseInput(customFields, state) {
  return {
    trmnl: {
      system: { timestamp_utc: Math.floor(Date.now() / 1000) },
      user: { locale: 'en', time_zone_iana: 'UTC' },
      state: state || {},
      plugin_settings: { instance_name: 'Test', custom_fields_values: Object.assign({ view_days: '1' }, customFields) },
    },
  };
}

// ---------------------------------------------------------------------------- tiny test runner

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const helpers = { runTransform, icsWithEvents, okText, okJson, fail, baseInput, assert, assertEqual };

for (const file of fs.readdirSync(path.join(__dirname, 'cases')).sort()) {
  if (!file.endsWith('.js')) continue;
  require(path.join(__dirname, 'cases', file))(test, helpers);
}

async function main() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('✓ ' + t.name);
    } catch (e) {
      console.error('✗ ' + t.name + ': ' + e.message);
      failed++;
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal: ' + (err && err.stack || err));
  process.exit(1);
});
