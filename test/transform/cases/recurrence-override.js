module.exports = function (test, h) {
  const { runTransform, okText, baseInput, assertEqual } = h;

  // 2026-09-05 is a Saturday; the window below always covers Sun 2026-09-06 .. Tue 2026-09-08.
  const NOW = Date.parse('2026-09-05T12:00:00Z');

  test('a no-op RECURRENCE-ID override does not duplicate the master\'s own occurrence', async () => {
    // Mirrors a real Outlook export: a biweekly-Monday master series plus a same-UID override
    // for one specific Monday (an attendee-response-only change, same date/time, no EXDATE on
    // the master) — the override must REPLACE that occurrence, not add a second copy of it.
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
      'BEGIN:VEVENT\r\nUID:series-1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Activities\r\n' +
      'DTSTART:20260601T133000Z\r\nDTEND:20260601T153000Z\r\n' +
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO\r\n' +
      'END:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nUID:series-1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Activities\r\n' +
      'RECURRENCE-ID:20260907T133000Z\r\n' +
      'DTSTART:20260907T133000Z\r\nDTEND:20260907T153000Z\r\n' +
      'END:VEVENT\r\n' +
      'END:VCALENDAR\r\n';
    const fetchImpl = async () => okText(ics);
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title)).filter((t) => t === 'Activities');
    assertEqual(titles.length, 1, 'the override should replace the master\'s occurrence, not add a second "Activities"');
  });

  test('a RECURRENCE-ID override that moves the occurrence still suppresses the master\'s original slot', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
      'BEGIN:VEVENT\r\nUID:series-2\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Standup\r\n' +
      'DTSTART:20260907T090000Z\r\nDTEND:20260907T091500Z\r\n' +
      'RRULE:FREQ=DAILY\r\n' +
      'END:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nUID:series-2\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Standup (moved)\r\n' +
      'RECURRENCE-ID:20260907T090000Z\r\n' +
      'DTSTART:20260907T110000Z\r\nDTEND:20260907T111500Z\r\n' +
      'END:VEVENT\r\n' +
      'END:VCALENDAR\r\n';
    const fetchImpl = async () => okText(ics);
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles.filter((t) => t === 'Standup').length, 0, 'the original 09:00 occurrence should be suppressed');
    assertEqual(titles.filter((t) => t === 'Standup (moved)').length, 1, 'the moved override should show once at its new time');
  });
};
