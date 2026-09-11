module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, okJson, baseInput, assert } = h;

  // Built from the real current time (not a pinned date) since this test deliberately uses the
  // real clock/timers, not a fake Date — a hardcoded past date would silently fall outside
  // today's render window and this test would start reporting 0 events on any later run.
  function icsUtcStamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const EVENT = { uid: 1, start: icsUtcStamp(now), end: icsUtcStamp(inOneHour), summary: 'Fast Event' };

  test('a slow/unreachable calendar does not block the whole run past TRMNL\'s serverless deadline', async () => {
    // Real setTimeout/AbortController (no fake Date here) since this test is about actual
    // wall-clock behavior — a calendar fetch that never resolves must still get aborted by
    // fetchWithTimeout's own AbortController well under the ~5s hard cap, instead of the whole
    // run() hanging on Promise.all forever.
    const fetchImpl = (url, opts) => {
      if (url.includes('cal-fast')) return Promise.resolve(okText(icsWithEvents([EVENT])));
      if (url.includes('cal-slow')) {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(okText(icsWithEvents([EVENT]))), 6000);
          if (opts && opts.signal) {
            opts.signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
          }
        });
      }
      return Promise.resolve(okJson({}));
    };
    const { run } = runTransform(fetchImpl);
    const input = baseInput({ advanced_config_enabled: 'true', calendars: JSON.stringify({ calendars: [{ url: 'https://example.com/cal-fast.ics', name: 'Fast' }, { url: 'https://example.com/cal-slow.ics', name: 'Slow' }] }) });

    const t0 = Date.now();
    const r = await run(input);
    const elapsed = Date.now() - t0;

    assert(elapsed < 4800, 'run() took ' + elapsed + 'ms — should stay well under the 5s serverless hard cap (got aborted, not hung)');
    assert(r.data.days[0].events.some((e) => e.title === 'Fast Event'), 'the fast calendar\'s event should still come through despite the slow one');
  });
};
