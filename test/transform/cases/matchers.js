module.exports = function (test, h) {
  const { runTransform, assert } = h;

  function parse(raw) {
    return runTransform().parseConfig(JSON.stringify(raw));
  }

  test('word matcher: matches whole word only, not a substring of a longer one', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L1' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('L1 Trip'), 'should match "L1 Trip"');
    assert(!rx.test('L10 Trip'), 'should NOT match "L10 Trip"');
    assert(!rx.test('XL1'), 'should NOT match "XL1"');
  });

  test('word matcher is case-insensitive', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'assembly' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].rules[0].rx.test('ASSEMBLY today'), 'should match regardless of case');
  });

  test('regex matcher uses the pattern as-is (expert escape hatch)', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'regex', value: '\\bK[123]\\b' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('K2 Assembly'), 'should match K2');
    assert(!rx.test('K4 Assembly'), 'should not match K4 (outside character class)');
  });

  test('"contains" matcher: plain substring anywhere, no word boundaries', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'contains', value: 'team' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('Team Meeting'), 'should match at a word boundary too');
    assert(rx.test('Steam Room'), 'should match mid-word, unlike "word"');
    assert(!rx.test('Tea Room'), 'should not match when the substring genuinely is not present');
  });

  test('"exact" matcher: the whole title must equal the value, nothing more', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'exact', value: 'Desk booking' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('Desk booking'), 'should match the exact title');
    assert(rx.test('DESK BOOKING'), 'should still be case-insensitive');
    assert(!rx.test('Desk booking (extended)'), 'should not match a title that merely contains it');
    assert(!rx.test('booking'), 'should not match a partial title');
  });

  test('"any"/"all" matcher matches every title, empty or not, no value needed', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('literally anything'), 'should match a normal title');
    assert(rx.test(''), 'should match an empty title too');
    const cfg2 = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'all' }, hide: true }] }],
    });
    assert(cfg2.calendars[0].rules[0].rx.test('anything'), '"all" should be accepted as a synonym for "any"');
  });

  test('an "any" match assigning a person defaults rename to false (opt-in, not opt-out)', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward' }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === false, 'rename should default to false for a catch-all match — there is no specific text to rename');
  });

  test('an "any" match can still opt into rename explicitly', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward', rename: true }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === true, 'rename:true should still be honored when explicitly set on an "any" match');
  });

  test('a word/regex match still defaults rename to true, unchanged from before "any" existed', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === true, 'word/regex matches should be unaffected by the "any" default change');
  });

  test('a rule with no match is dropped, not crash', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ hide: true }] }],
    });
    assert(cfg.calendars[0].rules.length === 0, 'a rule missing "match" entirely should be silently dropped');
  });

  test('a rule with no effect (no person/allDay/hide) is dropped', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' } }] }],
    });
    assert(cfg.calendars[0].rules.length === 0, 'a rule that does nothing should be dropped, not kept as a no-op');
  });

  test('one rule can combine person, allDay, and hide at once', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' }, person: 'Alex', allDay: true }] }],
    });
    const rule = cfg.calendars[0].rules[0];
    assert(rule.allDay === true, 'allDay should be set');
    assert(rule.hide === false, 'hide should default to false');
    assert(JSON.stringify(rule.person) === JSON.stringify(['Alex']), 'person should be normalized to an array');
  });

  test('a calendar rule with an invalid matcher (missing value) drops the rule, not the calendar', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].rules.length === 0, 'rule with no usable match should be dropped');
    assert(cfg.calendars.length === 1, 'the calendar itself should still be kept');
  });

  test('global (top-level) rules compile separately from any calendar\'s own', () => {
    const cfg = parse({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      calendars: [{ url: 'https://x/a.ics' }],
    });
    assert(cfg.globalRules.length === 1, 'the top-level rule should compile');
    assert(cfg.calendars[0].rules.length === 0, 'it should not leak into the calendar\'s own rules');
  });

  function ctx(overrides) {
    return Object.assign({ title: '', desc: '', status: '', weekday: null }, overrides);
  }

  test('"and" matcher only matches when every sub-matcher matches', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'and', matchers: [{ type: 'word', value: 'Standup' }, { type: 'weekday', value: 'FR' }] },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'Standup', weekday: 4 })), 'Friday (weekday 4) Standup should match');
    assert(!m(ctx({ title: 'Standup', weekday: 0 })), 'Monday Standup should NOT match (fails the weekday half)');
    assert(!m(ctx({ title: 'Retro', weekday: 4 })), 'Friday Retro should NOT match (fails the word half)');
  });

  test('"or" matcher matches when any sub-matcher matches', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'or', matchers: [{ type: 'word', value: 'Vacation' }, { type: 'status', value: 'cancelled' }] },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'Vacation', status: 'CONFIRMED' })), 'title match alone should be enough');
    assert(m(ctx({ title: 'Team Sync', status: 'CANCELLED' })), 'status match alone should be enough');
    assert(!m(ctx({ title: 'Team Sync', status: 'CONFIRMED' })), 'neither matching should not match');
  });

  test('"status" matcher compares case-insensitively against the event\'s ICS STATUS', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'status', value: 'tentative' }, hide: true }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ status: 'TENTATIVE' })), 'should match the uppercase ICS value against a lowercase config value');
    assert(!m(ctx({ status: 'CONFIRMED' })), 'should not match a different status');
  });

  test('"weekday" matcher accepts a single day or a list, by 2-letter or full name', () => {
    const single = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: 'Monday' }, hide: true }] }],
    }).calendars[0].rules[0].match;
    assert(single(ctx({ weekday: 0 })), 'weekday 0 (Monday) should match "Monday"');
    assert(!single(ctx({ weekday: 1 })), 'weekday 1 (Tuesday) should not match "Monday"');

    const list = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: ['SA', 'SU'] }, hide: true }] }],
    }).calendars[0].rules[0].match;
    assert(list(ctx({ weekday: 5 })), 'Saturday (5) should match ["SA","SU"]');
    assert(list(ctx({ weekday: 6 })), 'Sunday (6) should match ["SA","SU"]');
    assert(!list(ctx({ weekday: 2 })), 'Wednesday (2) should not match ["SA","SU"]');
  });

  test('a rule can hide events only on a specific weekday, end to end', async () => {
    const { runTransform, icsWithEvents, okText, baseInput, assertEqual } = h;
    const NOW = Date.parse('2026-09-07T12:00:00Z'); // a Monday
    const events = [
      { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Weekly Sync' }, // Monday
      { uid: 2, start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Weekly Sync' }, // Wednesday
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3', advanced_config_enabled: 'true' }, {
      calendars: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'weekday', value: 'MO' }, hide: true }] }] }),
    }));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Weekly Sync'], 'only the Wednesday occurrence should survive — the Monday one is hidden by the weekday rule');
  });
};
