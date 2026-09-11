module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  // Pinned, not real "today" — see the same note in allday-overflow.js.
  const NOW = Date.parse('2026-09-05T12:00:00Z');

  test('event box height/position always reflects real duration, never inflated to a minimum size', async () => {
    // Real-world case that prompted this: a 50-min class ending 5 minutes before a 15-min daily
    // standup. Both are short — a previous version of this code inflated short events up to a
    // "minimum readable" height, which either squeezed a neighbor to invisibility or made the
    // shorter of two adjacent events render TALLER than the longer one right next to it. Neither
    // is acceptable: the container must always be an accurate picture of when the event actually
    // is, full stop — text should shrink/clip to fit the box, the box must never stretch to fit
    // the text.
    const events = [
      { uid: 1, start: '20260905T092000Z', end: '20260905T101000Z', summary: 'Extra turnen' }, // 50 min
      { uid: 2, start: '20260905T101500Z', end: '20260905T103000Z', summary: 'Standup' }, // 15 min
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const turnen = r.data.days[0].events.find((e) => e.title === 'Extra turnen');
    const standup = r.data.days[0].events.find((e) => e.title === 'Standup');
    assert(turnen && standup, 'both events should be present');
    assert(turnen.height_pct > standup.height_pct, 'the longer (50-min) event must render taller than the shorter (15-min) one, regardless of what is scheduled next to either: turnen=' + turnen.height_pct + ' standup=' + standup.height_pct);
    // 50 min is roughly 3.33x as long as 15 min — height should track that ratio (not exactly,
    // since hours outside the configured "core" range render at a reduced weight), not some
    // gap-driven floor.
    const ratio = turnen.height_pct / standup.height_pct;
    assert(ratio > 2.5 && ratio < 4.5, 'height ratio should track the real duration ratio (~3.33x), not a gap-driven floor: got ' + ratio);
  });

  test('a very short isolated event gets a proportionally tiny box, not an inflated minimum', async () => {
    const events = [
      { uid: 1, start: '20260905T090000Z', end: '20260905T091500Z', summary: 'Quick Sync' }, // 15 min
      { uid: 2, start: '20260905T100000Z', end: '20260905T110000Z', summary: 'Long Review' }, // 60 min
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const quick = r.data.days[0].events.find((e) => e.title === 'Quick Sync');
    const long = r.data.days[0].events.find((e) => e.title === 'Long Review');
    // 15 min vs 60 min -> long should render 4x as tall, even with a big gap after Quick Sync
    // that an old "inflate to fill available room" rule would have grabbed.
    const ratio = long.height_pct / quick.height_pct;
    assert(ratio > 2.5 && ratio < 5, 'height should scale with real duration even when there is room to spare: got ratio ' + ratio);
  });

  test('adjacent same-lane events never overlap: each box ends exactly where the next begins', async () => {
    const events = [
      { uid: 1, start: '20260905T092000Z', end: '20260905T101000Z', summary: 'Extra turnen' },
      { uid: 2, start: '20260905T101500Z', end: '20260905T103000Z', summary: 'Standup' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const turnen = r.data.days[0].events.find((e) => e.title === 'Extra turnen');
    const standup = r.data.days[0].events.find((e) => e.title === 'Standup');
    const turnenBottom = turnen.top_pct + turnen.height_pct;
    assert(turnenBottom <= standup.top_pct + 0.01, 'an event box must never extend past the real start of the next event: turnen bottom=' + turnenBottom + ' standup top=' + standup.top_pct);
  });

  test('box_height_pct: the readable chip may grow into free room but never past the next same-lane event\'s real start', async () => {
    const events = [
      { uid: 1, start: '20260905T092000Z', end: '20260905T101000Z', summary: 'Extra turnen' },
      { uid: 2, start: '20260905T101500Z', end: '20260905T102000Z', summary: 'Standup' }, // 5 min
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const turnen = r.data.days[0].events.find((e) => e.title === 'Extra turnen');
    const standup = r.data.days[0].events.find((e) => e.title === 'Standup');
    assert(turnen.box_height_pct >= turnen.height_pct, 'the readable box must never be shorter than the real duration');
    assert(turnen.top_pct + turnen.box_height_pct <= standup.top_pct + 0.01, 'the readable box must not grow past the next event\'s true (unmoved) start: turnen box bottom=' + (turnen.top_pct + turnen.box_height_pct) + ' standup top=' + standup.top_pct);
    // Standup has the whole rest of the day free after it, so its box should be able to grow
    // past its own tiny 5-min duration — but the growth itself is capped to a fixed MINIMUM
    // PERCENTAGE of the grid (READABLE_BOX_MIN_PCT = 4), not a multiple of its own duration, so
    // it lands at that fixed floor regardless of how short the real event is.
    assert(standup.box_height_pct > standup.height_pct, 'a short event with free room after it should get a noticeably taller readable box than its bare duration: height=' + standup.height_pct + ' box=' + standup.box_height_pct);
    assertEqual(standup.box_height_pct, 4, 'the readable box should land exactly at the fixed minimum floor (READABLE_BOX_MIN_PCT) when there is room for it, not some other open-ended amount');
  });

  test('two short back-to-back events too close for both readable boxes to fit are placed side by side, not squished', async () => {
    // Real-world case that prompted this: a "Standup" ending right as "Yoga" begins — too tight
    // a gap for Standup's own minimum-readable-height box to fit without overlapping Yoga's real
    // start. The previous fix for the turnen/standup case above chose to keep each box's real
    // duration truthful rather than let one grow into the other — which is right for a squish,
    // but left the earlier of the two rendered at a near-illegible sliver height instead. The
    // resolution is to treat that near-collision like a genuine overlap for LANE purposes (even
    // though the events don't actually overlap in time) and place them side by side, so both get
    // a full-height column instead of one being squeezed thin next to the other.
    const events = [
      { uid: 1, start: '20260905T093000Z', end: '20260905T100000Z', summary: 'Standup' }, // 30 min
      { uid: 2, start: '20260905T100000Z', end: '20260905T110000Z', summary: 'Yoga' }, // 60 min, starts the instant Standup ends
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const standup = r.data.days[0].events.find((e) => e.title === 'Standup');
    const yoga = r.data.days[0].events.find((e) => e.title === 'Yoga');
    assert(standup && yoga, 'both events should be present');
    assertEqual(standup.nlanes, 2, 'too tight a gap for a readable box should push both events into side-by-side lanes');
    assertEqual(yoga.nlanes, 2, 'both events sharing the squeeze should agree on the same lane count');
    assert(standup.lane_index !== yoga.lane_index, 'the two events should occupy different lanes (side by side), not the same one');
    // Real durations must still be honest — side-by-side placement is a positioning fix, not a
    // license to inflate/shrink either event's true height.
    assert(standup.height_pct < yoga.height_pct, 'Standup (30 min) should still render shorter than Yoga (60 min) even though they now sit side by side');
  });
};
