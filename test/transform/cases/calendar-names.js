module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-05T12:00:00Z');
  const EVENT = { uid: 1, start: '20260905T120000Z', end: '20260905T130000Z', summary: 'Event' };

  test('calendar name: read from the feed\'s own X-WR-CALNAME when not set explicitly', async () => {
    const ics = icsWithEvents([Object.assign({ calname: 'My Family Calendar' }, EVENT)]);
    const fetchImpl = async () => okText(ics);
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.trmnl_state.calendarNames['https://example.com/a.ics'], 'My Family Calendar');
  });

  test('calendar name: falls back to "Calendar N" when the feed sets no X-WR-CALNAME', async () => {
    const ics = icsWithEvents([EVENT]);
    const fetchImpl = async () => okText(ics);
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.trmnl_state.calendarNames['https://example.com/a.ics'], 'Calendar 1');
  });

  test('calendar name: an explicit name in Advanced Configuration always wins over the feed\'s own', async () => {
    const ics = icsWithEvents([Object.assign({ calname: 'Ignore Me' }, EVENT)]);
    const fetchImpl = async () => okText(ics);
    const { run } = runTransform(fetchImpl, NOW);
    const cfg = JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Explicit' }] });
    const r = await run(baseInput({ advanced_config_enabled: 'true', calendars: cfg }));
    assertEqual(r.trmnl_state.calendarNames['https://example.com/a.ics'], 'Explicit');
  });

  test('calendar name: duplicate names (explicit or feed-derived) get " (2)", " (3)", ... appended', async () => {
    const icsA = icsWithEvents([Object.assign({ calname: 'Family' }, EVENT)]);
    const icsB = icsWithEvents([Object.assign({ calname: 'Family' }, EVENT)]);
    const fetchImpl = async (url) => okText(url.includes('a.ics') ? icsA : icsB);
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics\nhttps://example.com/b.ics' }));
    assertEqual(r.trmnl_state.calendarNames['https://example.com/a.ics'], 'Family');
    assertEqual(r.trmnl_state.calendarNames['https://example.com/b.ics'], 'Family (2)');
  });

  test('calendar name: a currently-down calendar keeps showing its last-known name in the alert banner, not "Calendar N"', async () => {
    let calFails = false;
    const ics = icsWithEvents([Object.assign({ calname: 'Family' }, EVENT)]);
    const fetchImpl = async () => calFails ? fail(503) : okText(ics);

    let state = {};
    let r = await runTransform(fetchImpl, NOW).run(baseInput({ calendars_simple: 'https://example.com/a.ics' }, state));
    state = r.trmnl_state;
    assertEqual(r.data.calendar_alerts, [], 'healthy: no alert yet');

    calFails = true;
    const t1 = NOW + 3 * 60 * 60 * 1000; // first failure observed
    r = await runTransform(fetchImpl, t1).run(baseInput({ calendars_simple: 'https://example.com/a.ics' }, state));
    state = r.trmnl_state;
    assertEqual(r.data.calendar_alerts, [], 'one failed refresh should not alert yet');

    const t2 = t1 + 3 * 60 * 60 * 1000; // +3h since first failure
    r = await runTransform(fetchImpl, t2).run(baseInput({ calendars_simple: 'https://example.com/a.ics' }, state));
    assertEqual(r.data.calendar_alerts, ['Family'], 'past the 2h threshold, alert should use the cached real name');
  });
};
