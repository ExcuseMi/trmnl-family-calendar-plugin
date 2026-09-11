module.exports = function (test, h) {
  const { runTransform, okText, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-05T12:00:00Z');

  // A production incident: one real calendar had a DTSTART/DTEND (or EXDATE) value that didn't
  // parse into real numbers. That reached new Date(NaN).formatToParts(), which throws — taking
  // down the ENTIRE run(), for every calendar, not just the malformed event. This is the exact
  // shape (a garbage floating-local DTSTART, TZID-qualified) that triggered it.
  const BAD_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
    'BEGIN:VEVENT\r\nUID:bad\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Broken\r\n' +
    'DTSTART;TZID=Europe/Brussels:garbage\r\nDTEND;TZID=Europe/Brussels:garbage\r\n' +
    'END:VEVENT\r\n' +
    'BEGIN:VEVENT\r\nUID:good\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Fine\r\n' +
    'DTSTART:20260907T140000Z\r\nDTEND:20260907T150000Z\r\n' +
    'END:VEVENT\r\n' +
    'END:VCALENDAR\r\n';

  test('a calendar with an unparseable DTSTART/DTEND does not crash the whole run', async () => {
    const fetchImpl = async () => okText(BAD_ICS);
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    assertEqual(r.data.error, null, 'run() should complete normally, not surface a crash as a page error');
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Fine'], 'the malformed event should be silently dropped; the well-formed one should still show');
  });

  test('an unparseable EXDATE value is ignored rather than crashing', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
      'BEGIN:VEVENT\r\nUID:1\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Weekly\r\n' +
      'DTSTART:20260907T140000Z\r\nDTEND:20260907T150000Z\r\n' +
      'EXDATE:garbage\r\nRRULE:FREQ=WEEKLY\r\n' +
      'END:VEVENT\r\nEND:VCALENDAR\r\n';
    const fetchImpl = async () => okText(ics);
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    assertEqual(r.data.error, null);
    assert(r.data.days.some((d) => d.events.some((e) => e.title === 'Weekly')), 'the recurring event itself should still show up');
  });
};
