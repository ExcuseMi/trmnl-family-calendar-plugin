'use strict';

// Rendered-geometry tests. test/transform checks what run() returns; this checks what the
// templates DO with it: where boxes actually land once the framework's real stylesheet, the
// real fonts and the framework's own overflow engine have had their say. Every bug this suite
// was written for (a footer painted over the agenda, an "and N more" counter pushed past the
// bottom edge, titles cut to an ellipsis) is invisible to a DOM-free test and obvious here.
//
// No npm dependencies: it drives headless Chromium directly (--dump-dom), the same way the
// plugin's sibling project does. Needs `trmnlp` on PATH and a Chromium binary; without either
// it SKIPS rather than fails, so `./test.sh` still passes on a machine that has neither.
//
// Run with: node run.js            (from this directory)
//           node run.js quadrant   (only cases whose name matches)

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'plugin/src/src');

const CHROME = process.env.CALENDAR_CHROME
  || process.env.METRO_CHROME
  || path.join(os.homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome');

// The device board is always 800x480; a half or a quadrant is a SLOT inside that screen, not a
// smaller screen. The framework pins .screen to the device's own size whatever the window is,
// so a slot is expressed by overriding --full-w/--full-h (what a real mashup turns) and NOT by
// shrinking the window: a 400x240 window just renders a full board and crops the picture.
const VIEWS = [
  { name: 'full', file: 'full', slot: null },
  { name: 'half_horizontal', file: 'half_horizontal', slot: { w: 800, h: 240 } },
  { name: 'half_vertical', file: 'half_vertical', slot: { w: 400, h: 480 } },
  { name: 'quadrant', file: 'quadrant', slot: { w: 400, h: 240 } },
];

const SCREEN_CLASSES = 'screen--og screen--md screen--1bit screen--density-1x';

// ---------------------------------------------------------------- framework assets

// The stylesheet decides every text metric, so the layout can only be measured honestly with the
// real thing — and the real faces with it. The CSS asks for them by absolute path
// (url("/fonts/TRMNL16-Regular.woff2")), which resolves against whichever origin serves the CSS:
// left remote, the page renders with whatever has arrived over the network at that moment, and
// the framework's overflow engine measures a different board on a slow run than on a fast one.
// That showed up here as a suite that failed in a different place each time it ran. Cached once
// into .cache (gitignored) and rewritten to file:// URLs, every run measures the same board.
const CACHE = path.join(__dirname, '.cache');

function curlTo(url, file) {
  try {
    execFileSync('curl', ['-fsSL', '-o', file, url], { stdio: 'pipe', timeout: 180000 });
  } catch (e) {
    try { fs.unlinkSync(file); } catch (e2) {}
    throw new Error('could not fetch ' + url + ': ' + e.message);
  }
}

function frameworkAssets(version) {
  const fontDir = path.join(CACHE, 'fonts');
  fs.mkdirSync(fontDir, { recursive: true });
  const origin = 'https://trmnl.com';
  const rawCss = path.join(CACHE, 'plugins-' + version + '.css');
  const localCss = path.join(CACHE, 'plugins-' + version + '.local.css');
  const js = path.join(CACHE, 'plugins-' + version + '.js');
  if (!fs.existsSync(rawCss) || fs.statSync(rawCss).size < 1000) curlTo(origin + '/css/' + version + '/plugins.css', rawCss);
  if (!fs.existsSync(js) || fs.statSync(js).size < 1000) curlTo(origin + '/js/' + version + '/plugins.js', js);
  if (!fs.existsSync(localCss) || fs.statSync(localCss).size < 1000) {
    const raw = fs.readFileSync(rawCss, 'utf-8');
    const wanted = Array.from(new Set((raw.match(/url\("\/fonts\/[^"]+"\)/g) || []).map((u) => u.slice(6, -2))));
    for (const name of wanted) {
      const file = path.join(fontDir, path.basename(name));
      if (fs.existsSync(file) && fs.statSync(file).size > 100) continue;
      curlTo(origin + '/fonts/' + path.basename(name), file);
    }
    fs.writeFileSync(localCss, raw.split('url("/fonts/').join('url("file://' + fontDir + '/'));
  }
  return { css: localCss, js };
}

// ---------------------------------------------------------------- fixtures

function ymd(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Dated from "today" at run time, because the transform reads the real clock: a fixture pinned
// to a calendar date would fall out of the visible window tomorrow and quietly stop testing
// anything. Titles are deliberately long enough to need the full row width.
function fixtureIcs() {
  const ev = (uid, summary, start, end) => 'BEGIN:VEVENT\r\nUID:' + uid + '\r\nSUMMARY:' + summary
    + '\r\nDTSTART:' + start + '\r\nDTEND:' + end + '\r\nEND:VEVENT\r\n';
  const allDay = (uid, summary, from, to) => 'BEGIN:VEVENT\r\nUID:' + uid + '\r\nSUMMARY:' + summary
    + '\r\nDTSTART;VALUE=DATE:' + from + '\r\nDTEND;VALUE=DATE:' + to + '\r\nEND:VEVENT\r\n';
  const t = (day, hhmm) => ymd(day) + 'T' + hhmm + '00Z';
  const cal = (name, body) => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:' + name + '\r\n' + body + 'END:VCALENDAR\r\n';
  return {
    'one.ics': cal('Home',
      allDay('a1', 'Pyjama day at school', ymd(0), ymd(1))
      + ev('e1', 'School run', t(0, '0600'), t(0, '0630'))
      + ev('e2', 'Client workshop: onboarding flow', t(0, '1200'), t(0, '1330'))
      + ev('e3', 'Yoga at the community centre', t(0, '1500'), t(0, '1630'))
      + ev('e4', 'Five-a-side football', t(0, '1800'), t(0, '2000'))),
    'two.ics': cal('Work',
      ev('f1', 'Daily standup', t(0, '0700'), t(0, '0715'))
      + ev('f2', 'Design review', t(0, '0730'), t(0, '0830'))
      + ev('f3', 'Lunch with Priya', t(0, '1030'), t(0, '1115'))
      + ev('f4', 'Piano lesson', t(0, '1330'), t(0, '1415'))
      + allDay('f5', 'Conference: TRMNL Summit', ymd(1), ymd(3))),
  };
}

const NEWS_XML = '<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title>'
  + '<item><title>A headline long enough to run past the end of a small ticker</title></item>'
  + '<item><title>A second headline</title></item></channel></rss>';

// Served locally, never fetched from the internet: the suite has to render the same board every
// time, and a real feed (or a missing network) would make it render a different one.
function serveFixtures() {
  const files = fixtureIcs();
  files['news.xml'] = NEWS_XML;
  const server = http.createServer((req, res) => {
    const name = req.url.replace(/^\//, '').split('?')[0];
    if (!Object.prototype.hasOwnProperty.call(files, name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': name.endsWith('.xml') ? 'application/xml' : 'text/calendar' });
    res.end(files[name]);
  });
  // Port 0 asks the OS for a free one, which is only known once the socket is actually bound.
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------- build

// Today at 09:00 UTC. The fixtures are written around this hour, so the same board renders
// whatever time the suite runs at.
function pinnedNow() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 0, 0);
}

// The single-day views list what is still to come, so a fixture event's position relative to
// "now" decides whether it renders at all: run this suite at 23:00 and the whole agenda is in
// the past and the views are empty, which is a real rendering but not the one being tested.
// transform.js runs inside trmnlp's own Node, out of reach of a test double, so the build copy
// gets a module-scoped Date that shadows the global one for that file.
function pinClock(transformPath) {
  const pin = pinnedNow();
  const shim = [
    '// Injected by test/layout: a fixed clock, so the fixtures always render the same board.',
    'const __RealDate = globalThis.Date;',
    'const __PINNED_NOW = ' + pin + ';',
    'const Date = class extends __RealDate {',
    '  constructor(...args) { if (args.length === 0) super(__PINNED_NOW); else super(...args); }',
    '  static now() { return __PINNED_NOW; }',
    '};',
    '',
  ].join('\n');
  fs.writeFileSync(transformPath, shim + fs.readFileSync(transformPath, 'utf-8'));
}

// Builds in a COPY of the plugin, never in the working tree: .trmnlp.yml is tracked source, and
// patching it in place means any concurrent build (another suite, a screenshot) renders with
// whatever the other run left behind.
// Async on purpose: the fixture feeds are served by this very process, and execFileSync would
// block the event loop for the whole build — the server would never answer, and every calendar
// would render as "Calendar unavailable" instead of the board the suite means to measure.
async function buildViews(port, fullViewStyle) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-layout-'));
  fs.cpSync(SRC, path.join(dir, 'src'), { recursive: true });
  pinClock(path.join(dir, 'src/transform.js'));
  const urls = ['one.ics', 'two.ics'].map((f) => '    http://127.0.0.1:' + port + '/' + f).join('\n');
  fs.writeFileSync(path.join(dir, '.trmnlp.yml'), [
    '---',
    'custom_fields:',
    '  calendars_simple: |-',
    urls,
    "  advanced_config_enabled: 'false'",
    "  view_days: '3'",
    '  full_view_style: ' + fullViewStyle,
    '  lat_lon: ' + "''",
    '  temperature_unit: celsius',
    '  time_format: 24h',
    "  news_feed_enabled: 'true'",
    '  rss_url: http://127.0.0.1:' + port + '/news.xml',
    '  rss_label: NEWS',
    'variables:',
    '  trmnl:',
    '    user:',
    '      locale: en',
    '      time_zone_iana: UTC',
  ].join('\n') + '\n');
  await execFileAsync('trmnlp', ['build'], { cwd: dir, timeout: 180000 });
  return dir;
}

// ---------------------------------------------------------------- measure

// Runs in the page after layout: everything the cases assert on is collected here in one pass,
// because each Chromium launch costs a second or two and a case should not need its own.
const MEASURE_JS = `
function measureNow() {
  function box(el) {
    var r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
             w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) { return el.offsetParent !== null || getComputedStyle(el).position === 'fixed'; }
  var view = document.querySelector('.view');
  // The framework publishes this once its terminalize pipeline (the overflow engine included)
  // has finished. Measuring before that is measuring a board the device never shows, so it is
  // recorded here and the suite refuses a measurement that does not carry it.
  var stats = window.__TRMNL_LAST_STATS__;
  var out = { view: box(view), rows: [], counter: null, footer: null, clipped: [],
              terminalized: !!stats, engineCount: stats ? stats.engineCount : 0 };

  var bars = Array.prototype.filter.call(document.querySelectorAll('.bg--black'), function (el) {
    return box(el).h > 0 && box(el).top > box(view).top + box(view).h / 2;
  });
  if (bars.length) out.footer = box(bars[0]);

  Array.prototype.forEach.call(document.querySelectorAll('.item'), function (el) {
    if (!visible(el)) return;
    // The engine builds its "and N more" chip as an .item too; it is reported as out.counter.
    if (el.getAttribute('data-overflow-label') === 'true') return;
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    var accent = el.querySelector('[class*="bg--"]');
    var cs = getComputedStyle(el);
    out.rows.push({
      text: text, box: box(el),
      bg: cs.backgroundColor,
      accentHue: accent ? (accent.className.match(/bg--[a-z0-9-]+/) || [''])[0] : '',
      accentW: accent ? box(accent).w : 0
    });
  });

  out.chips = [];
  Array.prototype.forEach.call(document.querySelectorAll('.cal-chip'), function (el) {
    if (!visible(el)) return;
    var accent = el.querySelector('[class*="bg--"]');
    out.chips.push({
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim(), box: box(el),
      bg: getComputedStyle(el).backgroundColor,
      accentHue: accent ? (accent.className.match(/bg--[a-z0-9-]+/) || [''])[0] : ''
    });
  });

  var counter = Array.prototype.find.call(document.querySelectorAll('*'), function (el) {
    return el.children.length === 0 && /^(and|\\+)\\s*\\d+\\s*more/i.test((el.textContent || '').trim());
  });
  if (counter) out.counter = { text: counter.textContent.trim(), box: box(counter.parentElement) };

  // Width only. A [data-clamp] element is deliberately limited to N lines, which shows up as
  // height overflow and is a design choice, not a defect; text cut off sideways is the one that
  // means a title lost its ending to a "…".
  Array.prototype.forEach.call(document.querySelectorAll('.view *'), function (el) {
    if (el.children.length) return;
    var text = (el.textContent || '').trim();
    if (!text || !visible(el)) return;
    if (el.scrollWidth > el.clientWidth + 1) out.clipped.push(text.slice(0, 40));
  });

  // Written only when it actually changed: the observer below watches attributes too, so an
  // unconditional write would retrigger itself forever.
  var next = JSON.stringify(out);
  if (next !== window.__lastMeasure) {
    window.__lastMeasure = next;
    document.body.setAttribute('data-measure', next);
  }
}
`;

// Measured over and over rather than once on a timer, with every completed pass overwriting the
// attribute, so the dump carries the settled layout. A single delayed pass measured the board
// before the framework's own overflow engine had trimmed it, which reported rows sitting on the
// footer that a real browser never draws there.
const MEASURE_LOOP_JS = MEASURE_JS + `
(function () {
  function pass() {
    try { measureNow(); } catch (e) { document.body.setAttribute('data-measure-error', String(e && e.message || e)); }
  }
  // Re-measured on every DOM mutation, not on a schedule. Under --virtual-time-budget the timers
  // all fire before the framework's overflow engine has touched anything, so a timed pass
  // measured the untrimmed board — rows that a real browser never leaves on the footer. The
  // engine announces itself by mutating (hiding items, inserting its counter), so the last
  // mutation is the cue for the last measurement, whenever it happens to arrive.
  // The signal that matters: the framework fires this when every engine has run.
  window.addEventListener('trmnl:terminalize:stats', function () {
    requestAnimationFrame(function () { requestAnimationFrame(pass); });
  });
  var observer = new MutationObserver(function () { pass(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  var passes = 0;
  var timer = setInterval(function () { passes++; pass(); if (passes > 60) clearInterval(timer); }, 100);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(pass);
  window.addEventListener('load', pass);
  pass();
})();
`;

function measure(buildDir, view) {
  const file = path.join(buildDir, '_build', view.file + '.html');
  let html = fs.readFileSync(file, 'utf-8');
  if (view.slot) {
    html = html.replace('</head>', '<style>.screen{--full-w:' + view.slot.w + 'px !important;'
      + '--full-h:' + view.slot.h + 'px !important}</style></head>');
  }
  html = html.replace('class="screen ', 'class="screen ' + SCREEN_CLASSES + ' ');

  // The framework schedules its terminalize pipeline (overflow engine included) on
  // requestAnimationFrame, and headless Chromium in --dump-dom mode produces no frames, so that
  // callback never arrives and the page is dumped with none of the engines having run. Putting
  // rAF on a timer — before the framework script loads, so its scheduler captures this one —
  // makes the pipeline run under virtual time. Only the scheduling changes; the layout each
  // engine then computes is the browser's own.
  html = html.replace('<head>', '<head><script>window.requestAnimationFrame = function (cb) '
    + '{ return setTimeout(function () { cb(Date.now()); }, 16); };'
    + 'window.cancelAnimationFrame = function (id) { clearTimeout(id); };</script>');

  // Point the page at the cached, font-localized framework rather than the network.
  const version = (/trmnl\.com\/css\/([0-9.]+)\/plugins\.css/.exec(html) || [null, '3.3.1'])[1];
  const assets = frameworkAssets(version);
  html = html.replace(/https:\/\/trmnl\.com\/css\/[0-9.]+\/plugins\.css/g, 'file://' + assets.css)
    .replace(/https:\/\/trmnl\.com\/js\/[0-9.]+\/plugins\.js/g, 'file://' + assets.js);
  // Appended last so it runs after the template's own fit/clamp script has had its pass.
  html = html.replace('</body>', '<script>' + MEASURE_LOOP_JS + '</script></body>');
  const staged = path.join(buildDir, '_build', view.name + '.measure.html');
  fs.writeFileSync(staged, html);

  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    // Generous on purpose: the dump happens when the budget expires, and the framework's
    // overflow engine plus the template's own fit passes have to have finished by then or the
    // measurement is of a board mid-pass.
    '--window-size=800,480', '--virtual-time-budget=20000', '--dump-dom', 'file://' + staged,
  ], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });

  const m = /data-measure="([^"]*)"/.exec(dom);
  if (!m) throw new Error(view.name + ': measurement script did not run');
  const json = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const out = JSON.parse(json);
  if (!out.terminalized) {
    throw new Error(view.name + ': the page was measured before the framework finished laying it '
      + 'out (no trmnl:terminalize:stats). Every assertion would be about a board the device never shows.');
  }
  return out;
}

// ---------------------------------------------------------------- runner

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

function haveDeps() {
  try { execFileSync('trmnlp', ['version'], { stdio: 'pipe', timeout: 30000 }); } catch (e) { return 'trmnlp is not on PATH'; }
  if (!fs.existsSync(CHROME)) return 'no Chromium at ' + CHROME + ' (set CALENDAR_CHROME)';
  return null;
}

async function main() {
  const missing = haveDeps();
  if (missing) {
    console.log('SKIP: rendered-layout suite needs a browser and trmnlp — ' + missing);
    return;
  }
  const filter = process.argv[2];
  const server = await serveFixtures();
  const port = server.address().port;
  let buildDir;
  let agendaDir;
  try {
    buildDir = await buildViews(port, 'grid');
    const measured = {};
    for (const v of VIEWS) measured[v.name] = measure(buildDir, v);

    // The full view has two user-selectable styles and they share almost no markup: the grid
    // draws positioned chips, the agenda draws the same .item rows the small views use. Only
    // measuring one of them leaves half the full view untested, which is how its all-day titles
    // kept an ellipsis nobody saw.
    agendaDir = await buildViews(port, 'agenda');
    measured.full_agenda = measure(agendaDir, { name: 'full_agenda', file: 'full', slot: null });

    const helpers = { measured, assert, assertEqual, VIEWS };
    for (const file of fs.readdirSync(path.join(__dirname, 'cases')).sort()) {
      if (file.endsWith('.js')) require(path.join(__dirname, 'cases', file))(test, helpers);
    }

    let failed = 0;
    for (const t of tests) {
      if (filter && !t.name.includes(filter)) continue;
      try {
        t.fn();
        console.log('✓ ' + t.name);
      } catch (e) {
        console.error('✗ ' + t.name + ': ' + e.message);
        failed++;
      }
    }
    const ran = tests.filter((t) => !filter || t.name.includes(filter)).length;
    console.log('\n' + (ran - failed) + '/' + ran + ' passed');
    if (failed > 0) process.exitCode = 1;
  } finally {
    server.close();
    // CALENDAR_KEEP_BUILD leaves the rendered HTML on disk to open or measure by hand.
    for (const dir of [buildDir, agendaDir]) {
      if (dir && process.env.CALENDAR_KEEP_BUILD) console.log('build kept at ' + dir);
      else if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('Fatal: ' + (err && err.stack || err));
  process.exit(1);
});
