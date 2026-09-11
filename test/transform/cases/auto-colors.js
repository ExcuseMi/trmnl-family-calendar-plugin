module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assertEqual } = h;

  // Pinned, not real "today" - see the same note in allday-overflow.js.
  const NOW = Date.parse('2026-09-05T06:00:00Z');
  const NAMED = ['blue', 'green', 'orange', 'purple', 'red', 'cyan', 'pink', 'lime', 'violet', 'yellow'];

  // One short event per calendar, an hour apart: overlapping events can overflow into gray-30,
  // which would muddy what these tests are about.
  function oneEventPerCalendar(url) {
    const n = parseInt(/cal(\d+)\.ics/.exec(url)[1], 10);
    const hh = String(7 + n).padStart(2, '0');
    return okText(icsWithEvents([{ uid: n, start: '20260905T' + hh + '0000Z', end: '20260905T' + hh + '3000Z', summary: 'Cal ' + n }]));
  }
  function urls(count) { return Array.from({ length: count }, (_, i) => 'https://example.com/cal' + i + '.ics'); }
  function colorsByTitle(r) {
    const out = {};
    for (const e of r.data.days[0].events) out[e.title] = { hue: e.hue, fg: e.fg };
    return out;
  }

  test('calendars with no color auto-assign named hues in order, not grays', async () => {
    const { run } = runTransform(async (url) => oneEventPerCalendar(url), NOW);
    const r = await run(baseInput({ calendars_simple: urls(3).join('\n') }));
    assertEqual(colorsByTitle(r), {
      'Cal 0': { hue: 'blue-65', fg: 'black' },
      'Cal 1': { hue: 'green-65', fg: 'black' },
      'Cal 2': { hue: 'orange-65', fg: 'black' },
    });
  });

  test('auto hues wrap back to the first after all ten named colors are used', async () => {
    const { run } = runTransform(async (url) => oneEventPerCalendar(url), NOW);
    const r = await run(baseInput({ calendars_simple: urls(11).join('\n') }));
    const byTitle = colorsByTitle(r);
    const hues = Array.from({ length: 11 }, (_, i) => byTitle['Cal ' + i] && byTitle['Cal ' + i].hue);
    assertEqual(hues, NAMED.map((c) => c + '-65').concat(['blue-65']));
  });

  test('an explicit calendar color wins, and auto-assignment for the rest keeps its position', async () => {
    const { run } = runTransform(async (url) => oneEventPerCalendar(url), NOW);
    const r = await run(baseInput({
      advanced_config_enabled: 'true',
      calendars: JSON.stringify({ calendars: [
        { url: 'https://example.com/cal0.ics', color: 'gray-20' },
        { url: 'https://example.com/cal1.ics' },
      ] }),
    }));
    assertEqual(colorsByTitle(r), {
      'Cal 0': { hue: 'gray-20', fg: 'white' },
      'Cal 1': { hue: 'green-65', fg: 'black' },
    });
  });
};
