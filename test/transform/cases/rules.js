module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-05T12:00:00Z');

  function cfgWith(json) {
    return { advanced_config_enabled: 'true', calendars: JSON.stringify(json) };
  }

  test('a rule can turn a timed event into an all-day one', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }],
    })));
    const r = await run(input);
    assertEqual(r.data.days.some((d) => d.events.length), false, 'the event should not show up in the timed grid');
    assert(r.data.allday_bars.some((b) => b.title === 'Staff Training Day'), 'it should show up as an all-day bar instead');
  });

  test('a rule can hide an event by title match', async () => {
    const evA = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Keep Me' };
    const evB = { uid: 2, start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Hide Me' };
    const fetchImpl = async () => okText(icsWithEvents([evA, evB]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Hide Me' }, hide: true }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Keep Me']);
  });

  test('a rule can match against an event\'s description, not just its title', async () => {
    const evA = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Team Sync', description: 'Status: confirmed' };
    const evB = { uid: 2, start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Team Sync', description: 'Status: cancelled' };
    const fetchImpl = async () => okText(icsWithEvents([evA, evB]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }],
    })));
    const r = await run(input);
    const remaining = r.data.days.flatMap((d) => d.events);
    assertEqual(remaining.length, 1, 'only the event whose description does NOT match "cancelled" should remain');
    assertEqual(remaining[0].top_pct <= 50, true, 'the surviving event should be the earlier (14:00) one, not the cancelled 16:00 one');
  });

  test('a rewrite rule replaces the matched text with literal text, independent of person', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Lesson 6 Swim Class']);
  });

  test('a catch-all ".*" match with rename does not duplicate the title (WardWard bug)', async () => {
    // A regex that can match an empty string (like ".*") makes a naive `.replace(/re/g, ...)`
    // match twice: once consuming the real title, then again on the empty string right after
    // it — "Ward" would come out "WardWard". This is the exact pattern a per-calendar "always
    // assign this person" rule uses (see calendar-config.json/demo-config.json).
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, person: 'Ward' }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Ward'], 'a single non-global replace should produce "Ward", never "WardWard"');
  });

  test('a catch-all ".*" match with rename:false assigns the person without touching the title', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      people: [{ name: 'Ward' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, person: 'Ward', rename: false }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Schoolfotografie'], 'rename:false on a catch-all rule should badge the event without changing its title');
  });

  test('the "any" match type is the intended way to write a catch-all rule — badges without renaming, by default', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      people: [{ name: 'Ward' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward' }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Schoolfotografie'], 'an "any" match should badge Ward without needing an explicit rename:false');
    assertEqual(r.data.people.map((p) => p.person), ['Ward']);
  });

  test('rewriteFull replaces the whole title, not just the matched substring', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class with Jane' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Swimming', rewriteFull: true }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Swimming'], 'rewriteFull should discard the rest of the original title entirely');
  });

  test('rewrite without rewriteFull still supports regex backreferences against the match', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Sprint 26-08' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: 'Sprint (\\d+-\\d+)' }, rewrite: 'Sprint #$1' }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Sprint #26-08'], 'the regex-replace mode should support $1 backreferences from the match');
  });

  test('a rewrite rule wins over a rename from a person assignment on the same title', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      people: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [
        { match: { type: 'word', value: 'L6' }, person: 'Alex' },
        { match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' },
      ] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Lesson 6 Swim Class']);
  });

  test('a global rule assigns a person across every calendar, not just one', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([{
      uid: 1, start: '20260907T140000Z', end: '20260907T150000Z',
      summary: url.includes('a.ics') ? 'Doctor Appointment' : 'Something Else',
    }]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      people: [{ name: 'Mom', badge: 'M' }],
      calendars: [{ url: 'https://example.com/a.ics' }, { url: 'https://example.com/b.ics' }],
    })));
    const r = await run(input);
    const badged = r.data.people.find((p) => p.person === 'Mom');
    assert(!!badged, 'the global rule should have assigned Mom regardless of which calendar the event came from');
  });

  test('a calendar\'s own rule overrides a global rule\'s person assignment for the same event', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Doctor Appointment' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      people: [{ name: 'Mom', badge: 'M' }, { name: 'Dad', badge: 'D' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Dad' }] }],
    })));
    const r = await run(input);
    assertEqual(r.data.people.map((p) => p.person), ['Dad'], 'the calendar-specific rule should win over the global one');
  });

  test('a calendar\'s custom headers are sent on its ICS fetch, alongside the default User-Agent', async () => {
    let capturedHeaders = null;
    const fetchImpl = async (url, opts) => {
      capturedHeaders = opts && opts.headers;
      return okText(icsWithEvents([]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', headers: { Authorization: 'Bearer secret-token' } }],
    })));
    await run(input);
    assertEqual(capturedHeaders.Authorization, 'Bearer secret-token', 'the custom header should reach the actual fetch call');
    assertEqual(capturedHeaders['User-Agent'], 'TRMNL-ICS-Calendar', 'the default User-Agent should still be sent alongside it');
  });

  test('non-string values in a calendar\'s headers are dropped rather than sent as-is', async () => {
    let capturedHeaders = null;
    const fetchImpl = async (url, opts) => {
      capturedHeaders = opts && opts.headers;
      return okText(icsWithEvents([]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', headers: { 'X-Ok': 'fine', 'X-Bad': { nested: true } } }],
    })));
    await run(input);
    assertEqual(capturedHeaders['X-Ok'], 'fine');
    assertEqual('X-Bad' in capturedHeaders, false, 'a non-string header value should be dropped, not passed through');
  });

  test('the first person in people[] badges any event with no other person assigned', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Unclaimed Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      people: [{ name: 'Everyone', badge: '★' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    const r = await run(input);
    assertEqual(r.data.people, [{ text: '★', person: 'Everyone', hue: 'gray-30', fg: 'white', is_everyone: true }]);
  });

  test('a rule\'s own person assignment still wins over the first-person fallback', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Alex event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      people: [{ name: 'Everyone', badge: '★' }, { name: 'Alex', badge: 'A' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Alex' }, person: 'Alex' }] }],
    })));
    const r = await run(input);
    assertEqual(r.data.people.map((p) => p.person), ['Alex']);
  });

  test('no people configured: event just has no badge, not a crash', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3', calendars_simple: 'https://example.com/a.ics' }));
    const r = await run(input);
    assertEqual(r.data.people, []);
    assertEqual(r.data.error, null);
  });

  test('an emoji badge does not get mangled by taking only half its UTF-16 surrogate pair', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      people: [{ name: 'Everyone', badge: '👪 Family' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    const r = await run(input);
    assertEqual(r.data.people[0].text, '👪', 'the full emoji codepoint should survive, not a broken half-surrogate');
  });
};
