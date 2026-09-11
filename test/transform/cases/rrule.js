module.exports = function (test, h) {
  const { runTransform, okText, baseInput, assertEqual } = h;

  // 2026-09-05 is a Saturday; the window below always covers Sun 2026-09-06 .. Tue 2026-09-08.
  const NOW = Date.parse('2026-09-05T12:00:00Z');

  function ics(rrule, dtstart) {
    return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
      'BEGIN:VEVENT\r\nUID:1\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Recurring\r\n' +
      'DTSTART:' + dtstart + 'T180000Z\r\nDTEND:' + dtstart + 'T190000Z\r\n' +
      'RRULE:' + rrule + '\r\n' +
      'END:VEVENT\r\nEND:VCALENDAR\r\n';
  }

  test('MONTHLY with BYMONTHDAY lands on that day of the month, not DTSTART\'s own day', async () => {
    // DTSTART is the 15th; BYMONTHDAY says the 20th — September's 20th, 2026, falls in this
    // test's 3-day window (Sun 6 - Tue 8)... use a window that actually covers the 20th instead.
    const fetchImpl = async () => okText(ics('FREQ=MONTHLY;BYMONTHDAY=20', '20260115'));
    const { run } = runTransform(fetchImpl, Date.parse('2026-09-19T12:00:00Z'));
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    const found = r.data.days.some((d) => d.events.some((e) => e.title === 'Recurring'));
    assertEqual(found, true, 'the 20th-of-the-month occurrence should appear in a window covering Sept 20');
  });

  test('MONTHLY with BYDAY=-1FR (last Friday) skips months without emitting a wrong date', async () => {
    // Last Friday of September 2026 is the 25th.
    const fetchImpl = async () => okText(ics('FREQ=MONTHLY;BYDAY=-1FR', '20260626'));
    const { run } = runTransform(fetchImpl, Date.parse('2026-09-24T12:00:00Z'));
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    const found = r.data.days.some((d) => d.events.some((e) => e.title === 'Recurring'));
    assertEqual(found, true, 'the last Friday of September (the 25th) should be in a window covering Sept 24-26');
  });

  test('YEARLY with BYMONTHDAY still recurs correctly across years (same month as DTSTART, that day)', async () => {
    // YEARLY only steps by whole years — the month always stays DTSTART's own (September here);
    // BYMONTHDAY just overrides which day within that same September.
    const fetchImpl = async () => okText(ics('FREQ=YEARLY;BYMONTHDAY=20', '20240915'));
    const { run } = runTransform(fetchImpl, Date.parse('2026-09-19T12:00:00Z'));
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    const found = r.data.days.some((d) => d.events.some((e) => e.title === 'Recurring'));
    assertEqual(found, true, 'the yearly BYMONTHDAY occurrence should still land correctly two years later');
  });
};
