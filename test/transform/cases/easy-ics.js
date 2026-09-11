module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  // Pinned, not real "today" — see the same note in allday-overflow.js.
  const NOW = Date.parse('2026-09-05T12:00:00Z');

  const EVENT_A = { uid: 1, start: '20260905T120000Z', end: '20260905T130000Z', summary: 'From Easy' };
  const EVENT_B = { uid: 2, start: '20260905T140000Z', end: '20260905T150000Z', summary: 'From Advanced' };

  test('Advanced Configuration on: Easy ICS is fully ignored, not combined with it', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([url.includes('a.ics') ? EVENT_A : EVENT_B]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput({
      calendars_simple: 'https://example.com/a.ics',
      advanced_config_enabled: 'true',
      calendars: JSON.stringify({ calendars: [{ url: 'https://example.com/b.ics', name: 'Advanced Cal' }] }),
    });
    const r = await run(input);
    const titles = r.data.days[0].events.map((e) => e.title);
    assertEqual(titles, ['From Advanced'], 'Easy ICS should not contribute events while Advanced Configuration is on');
  });

  test('turning Advanced Configuration off ignores its JSON even if leftover content is still saved there', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([url.includes('a.ics') ? EVENT_A : EVENT_B]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput({
      calendars_simple: 'https://example.com/a.ics',
      advanced_config_enabled: 'false',
      calendars: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Duplicate Of Easy' }] }),
    });
    const r = await run(input);
    assertEqual(r.data.days[0].events.length, 1, 'the same calendar must not be counted twice just because old JSON is still sitting in the hidden field');
  });

  test('Easy ICS alone (no Advanced Configuration at all) still works', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT_A]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.data.days[0].events.length, 1);
    assertEqual(r.data.error, null);
  });

  test('neither field set: the friendly "no calendar configured" state, not a crash', async () => {
    const { run } = runTransform(async () => okText(''), Date.now());
    const r = await run(baseInput({}));
    assert(!!r.data.error, 'should report the empty-configuration error');
    assertEqual(r.data.has_events, false);
  });
};
