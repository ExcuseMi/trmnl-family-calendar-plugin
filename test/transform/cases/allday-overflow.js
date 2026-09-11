module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  // Pinned, not real "today" — an all-day event dated against the real clock would silently
  // fall outside the render window (and these tests would start reporting 0 events) the day
  // after whoever last touched this file happened to run it.
  const NOW = Date.parse('2026-09-05T12:00:00Z');

  function allDayIcs(n) {
    const events = [];
    for (let i = 0; i < n; i++) {
      events.push({ uid: i, allDay: true, start: '20260905', end: '20260906', summary: 'AllDay ' + i });
    }
    return icsWithEvents(events);
  }

  test('all-day events at or under the 3-row cap: every one shows, no "+N more"', async () => {
    const fetchImpl = async () => okText(allDayIcs(3));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.data.allday_bars.length, 3);
    assert(!r.data.allday_bars.some((b) => b.title.includes('more')), 'no overflow summary expected');
    assertEqual(r.data.allday_max_rows, 3);
  });

  test('all-day events beyond the cap: real events truncate to 2, a "+N more" summarizes the rest — nothing silently vanishes', async () => {
    const fetchImpl = async () => okText(allDayIcs(5));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const real = r.data.allday_bars.filter((b) => !b.title.includes('more'));
    const overflow = r.data.allday_bars.filter((b) => b.title.includes('more'));
    assertEqual(real.length, 2, 'only 2 real events should render');
    assertEqual(overflow.length, 1, 'exactly one overflow summary bar');
    assertEqual(overflow[0].title, '+3 more', 'the summary should count the 3 events that did not fit');
    assertEqual(r.data.allday_max_rows, 3, 'total row budget should stay the same as the non-overflow case');
  });

  test('adjacent same-title/same-color all-day bars in the same row merge into one wider bar', async () => {
    // Two genuinely separate events (e.g. a daily-recurring "Desk booking" each rewritten to
    // "Kantoor") landing on consecutive days should read as one continuous bar, not two
    // touching boxes — see the real device screenshot that prompted this.
    const events = [
      { uid: 1, allDay: true, start: '20260905', end: '20260906', summary: 'Kantoor' },
      { uid: 2, allDay: true, start: '20260906', end: '20260907', summary: 'Kantoor' },
      { uid: 3, allDay: true, start: '20260907', end: '20260908', summary: 'Different Title' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    assertEqual(r.data.allday_bars.length, 2, 'the two "Kantoor" bars should merge into one');
    const kantoor = r.data.allday_bars.find((b) => b.title === 'Kantoor');
    assertEqual(kantoor.span, 2, 'the merged bar should span both days');
    assertEqual(kantoor.start_col, 0);
    const other = r.data.allday_bars.find((b) => b.title === 'Different Title');
    assertEqual(other.span, 1, 'a differently-titled adjacent bar should not be swept into the merge');
  });

  test('same-title all-day bars in different rows do not merge', async () => {
    const events = [
      { uid: 1, allDay: true, start: '20260905', end: '20260906', summary: 'Kantoor' },
      // Overlaps day 1 with the first event (both cover 2026-09-05), forcing it into a second
      // row — same title, but genuinely not adjacent in the same row, so must NOT merge.
      { uid: 2, allDay: true, start: '20260905', end: '20260906', summary: 'Kantoor' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    assertEqual(r.data.allday_bars.length, 2, 'two overlapping same-title bars in different rows must stay separate');
  });
};
