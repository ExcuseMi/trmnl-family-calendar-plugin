module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  function cfgWith(json) {
    return { advanced_config_enabled: 'true', calendars: JSON.stringify(json) };
  }

  // Pinned, not real "today" — see the same note in timed-layout.js/allday-overflow.js.
  const NOW = Date.parse('2026-09-05T12:00:00Z'); // 2026-09-05 is a Saturday, noon UTC

  test('data.single_day only carries the agenda list now — half_horizontal/half_vertical/quadrant all render it, not a per-day grid', async () => {
    const events = [
      { uid: 1, start: '20260905T140000Z', end: '20260905T143000Z', summary: 'This Afternoon' },
      // Other visible days force the SHARED (full-view) axis wide open — irrelevant to the
      // agenda list, which only ever looks at today (rawDays[0])'s own events.
      { uid: 2, start: '20260906T050000Z', end: '20260906T053000Z', summary: 'Early Run' },
      { uid: 3, start: '20260907T220000Z', end: '20260907T223000Z', summary: 'Late Call' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));

    assert(r.data.hour_rows[5].pct > 0, 'the full view\'s own shared axis must still stretch for day 1\'s early event');
    assert(r.data.hour_rows[22].pct > 0, 'the full view\'s own shared axis must still stretch for day 2\'s late event');

    assertEqual(Object.keys(r.data.single_day).sort(), ['agenda'], 'data.single_day should carry only the agenda list, nothing grid-related');
    assertEqual(r.data.single_day.agenda.map((i) => i.title), ['This Afternoon'], 'only today\'s own event should appear, regardless of what other days have');
  });

  test('data.single_day.agenda lists all-day items first, then timed events chronologically, dropping already-ended ones and flagging the in-progress one', async () => {
    // All-day items also still show in the existing all-day bar header (every view) — being in
    // this list too is deliberate, not a duplicate-avoidance bug.
    const events = [
      { uid: 1, allDay: true, start: '20260905', end: '20260906', summary: 'Holiday' },
      { uid: 2, start: '20260905T090000Z', end: '20260905T093000Z', summary: 'Past Standup' }, // ended before noon
      { uid: 3, start: '20260905T140000Z', end: '20260905T150000Z', summary: 'Client Call' },
      { uid: 4, start: '20260905T110000Z', end: '20260905T130000Z', summary: 'Workshop' }, // in progress at noon
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const agenda = r.data.single_day.agenda;
    assertEqual(agenda.map((i) => i.title), ['Holiday', 'Workshop', 'Client Call'], 'all-day first, then timed events sorted by start, past ones dropped');
    assertEqual(agenda[0].all_day, true, 'the all-day item should be flagged all_day');
    assertEqual(agenda[0].time, null, 'an all-day item has no time label');
    assertEqual(agenda[1].current, true, 'Workshop (11:00-13:00) is in progress at noon');
    assertEqual(agenda[2].current, false, 'Client Call has not started yet');
    assert(agenda[1].time && agenda[2].time, 'both timed items here should carry a formatted time label');
  });

  test('data.single_day.agenda is not pre-cut to a display limit — how many fit (and any "+N more") is decided per view in the template', async () => {
    const events = [];
    for (let i = 0; i < 9; i++) {
      const hh = String(12 + i).padStart(2, '0'); // 12:00 through 20:00, all still upcoming/in-progress at noon
      events.push({ uid: i, start: '20260905T' + hh + '0000Z', end: '20260905T' + hh + '3000Z', summary: 'Event ' + i });
    }
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const agenda = r.data.single_day.agenda;
    // half_horizontal (2 columns) and quadrant (1 column) fit very different numbers of rows —
    // that decision belongs in shared.liquid (agenda_limit per view), not baked in here.
    assertEqual(agenda.length, 9, 'all 9 real events should be present uncapped at the data level');
    assertEqual(agenda.map((i) => i.title), events.map((e) => e.summary), 'still sorted chronologically');
  });

  test('data.single_day.agenda has a hard sanity cap against a pathologically busy day', async () => {
    const events = [];
    for (let i = 0; i < 30; i++) {
      const startMin = i * 15; // packed every 15 minutes from noon onward, each 10 minutes long
      const hh = String(12 + Math.floor(startMin / 60)).padStart(2, '0');
      const mm = String(startMin % 60).padStart(2, '0');
      const endMin = startMin + 10;
      const ehh = String(12 + Math.floor(endMin / 60)).padStart(2, '0');
      const emm = String(endMin % 60).padStart(2, '0');
      events.push({ uid: i, start: '20260905T' + hh + mm + '00Z', end: '20260905T' + ehh + emm + '00Z', summary: 'Event ' + i });
    }
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.data.single_day.agenda.length, 20, 'a pathologically busy day should still cap at the hard sanity limit (20)');
  });

  test('data.single_day.agenda carries each event\'s person badge(s), for the template to render right-aligned', async () => {
    const ev = { uid: 1, start: '20260905T140000Z', end: '20260905T150000Z', summary: 'Doctor Appointment' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '1' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom', rename: false }] }],
      people: [{ name: 'Mom', badge: 'M', color: 'pink' }],
    })));
    const r = await run(input);
    const item = r.data.single_day.agenda.find((i) => i.title.includes('Doctor'));
    assert(item, 'the event should be in the agenda');
    assertEqual(item.badges.length, 1, 'the event should carry exactly one person badge');
    assertEqual(item.badges[0].text, 'M', 'the badge should be Mom\'s configured badge text');
    assertEqual(item.badges[0].hue, 'pink-65', 'the badge should use Mom\'s configured color');
  });

  test('data.days[i].agenda (the full view\'s per-day list) shows the WHOLE day, unlike data.single_day.agenda which hides past events', async () => {
    const events = [
      { uid: 1, allDay: true, start: '20260905', end: '20260906', summary: 'Holiday' },
      { uid: 2, start: '20260905T090000Z', end: '20260905T093000Z', summary: 'Past Standup' }, // ended before noon
      { uid: 3, start: '20260905T140000Z', end: '20260905T150000Z', summary: 'Client Call' },
      { uid: 4, start: '20260906T100000Z', end: '20260906T103000Z', summary: 'Tomorrow Meeting' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '2' }));

    const todayAgenda = r.data.days[0].agenda;
    // "Holiday" leads the list, same agenda_row treatment (no time label) as the single-day
    // views already give all-day items — the Agenda List full view style suppresses its own
    // all-day bars in favor of this, so it doesn't duplicate them (Timeline Grid still uses them).
    assertEqual(todayAgenda.map((i) => i.title), ['Holiday', 'Past Standup', 'Client Call'], 'today\'s full-view agenda keeps Past Standup (unlike data.single_day.agenda) and leads with the all-day item');
    assertEqual(todayAgenda[0].all_day, true, 'the all-day item is flagged all_day, like data.single_day.agenda\'s');
    assertEqual(todayAgenda[0].time, null, 'the all-day item has no time label, same as a real event with no time would');
    assertEqual(r.data.single_day.agenda.map((i) => i.title), ['Holiday', 'Client Call'], 'the single-day agenda drops the past event but DOES include the all-day item, for contrast');

    const tomorrowAgenda = r.data.days[1].agenda;
    assertEqual(tomorrowAgenda.map((i) => i.title), ['Tomorrow Meeting'], 'day 1\'s own agenda has its own event, not today\'s');
  });
};
