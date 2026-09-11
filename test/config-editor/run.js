'use strict';

// Regression tests for tools/config-editor.html — the visual builder for the plugin's Advanced
// Configuration JSON. Unlike test/transform (a pure Node module), this page is a browser IIFE
// that builds/reads a real DOM, so these tests load it into a real (if headless) DOM via jsdom
// and drive it the way a person would: type into fields, click buttons, read #jsonOut.
//
// Run with: npm test  (from this directory) — installs jsdom on first run, no browser/Docker
// needed otherwise.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.join(__dirname, '../..');
const EDITOR_PATH = process.env.EDITOR_PATH || path.join(REPO_ROOT, 'tools/config-editor.html');
const TRANSFORM_PATH = process.env.TRANSFORM_PATH || path.join(REPO_ROOT, 'plugin/src/src/transform.js');

const EDITOR_HTML = fs.readFileSync(EDITOR_PATH, 'utf-8');
const TRANSFORM_SRC = fs.readFileSync(TRANSFORM_PATH, 'utf-8');

// Extract the page's own inline <script>...</script> (the one right before </body> — NOT the
// `<script src="../plugin/src/src/transform.js">` tag) so it can be eval'd directly into a jsdom
// window, sidestepping jsdom's external-resource-loading and script-execution-order quirks
// entirely. Both scripts are then run via window.eval(), mirroring what a real browser does
// (transform.js's top-level `run`/`parseConfig` land in global scope, then the page's own
// script — a plain IIFE closing over its own module-level state — runs against them).
const INLINE_SCRIPT_RE = /<script>([\s\S]*?)<\/script>\s*<\/body>/;
const inlineMatch = EDITOR_HTML.match(INLINE_SCRIPT_RE);
if (!inlineMatch) throw new Error("Could not find config-editor.html's inline <script> — did its structure change?");
const INLINE_SCRIPT = inlineMatch[1];
const SKELETON_HTML = EDITOR_HTML
  .replace(/<script src="\.\.\/plugin\/src\/src\/transform\.js"><\/script>\s*/, '')
  .replace(INLINE_SCRIPT_RE, '</body>');

// Loads a fresh copy of the page (skeleton HTML + transform.js + the page's own script, each
// freshly eval'd) into its own jsdom window — module-level state (the calendars/people/rules
// arrays the IIFE closes over) never leaks between tests, same isolation guarantee
// test/transform's runTransform() gives per call.
function loadEditor() {
  // runScripts: "outside-only" is what makes window.eval() below actually execute against
  // jsdom's real window-as-global-object (bare `window`/`document` references resolve
  // correctly) — without it jsdom treats eval'd code as running "outside" any window context.
  const dom = new JSDOM(SKELETON_HTML, { url: 'http://localhost/tools/config-editor.html', runScripts: 'outside-only' });
  const { window } = dom;
  // jsdom has no fetch/clipboard API — this page only needs them for the "test with real data"
  // and "copy JSON" buttons, neither of which these tests exercise; stubs are enough to let
  // module-level code (`var realFetch = window.fetch.bind(window);`) run without crashing.
  window.fetch = function () { return Promise.reject(new Error('network disabled in tests')); };
  try { window.navigator.clipboard = { writeText: function () { return Promise.resolve(); } }; } catch (e) {}
  window.eval(TRANSFORM_SRC);
  window.eval(INLINE_SCRIPT);
  return { window: window, document: window.document };
}

// ---- convenience DOM helpers used across test cases ----

function fireInput(el, value) {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true }));
}
function fireChange(el, value) {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
}
function click(el) {
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
}
function byText(container, tag, text) {
  return Array.from(container.querySelectorAll(tag)).find(function (e) { return e.textContent.trim() === text; });
}
function clickButtonByText(container, text) {
  const btn = byText(container, 'button', text);
  if (!btn) throw new Error('No button found with text "' + text + '"');
  click(btn);
  return btn;
}
function jsonOut(document) {
  return JSON.parse(document.getElementById('jsonOut').value);
}

// ---------------------------------------------------------------------------- tiny test runner

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const helpers = { loadEditor, fireInput, fireChange, click, byText, clickButtonByText, jsonOut, assert, assertEqual };

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
      console.error('✗ ' + t.name + ': ' + (e && e.stack || e));
      failed++;
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  if (failed > 0) process.exit(1);
}

main();
