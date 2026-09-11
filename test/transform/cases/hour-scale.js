module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert } = h;

  // 06:30, with a visible-hours setting of 9-17: the window stretches back to cover "now", so
  // 6, 7 and 8 are on the board but outside the core the day's content sits in.
  const NOW = Date.parse('2026-09-05T06:30:00Z');

  async function hourRows(extra) {
    const fetchImpl = async () => okText(icsWithEvents([
      { uid: 1, start: '20260905T100000Z', end: '20260905T110000Z', summary: 'Standup' },
    ]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput(Object.assign({ calendars_simple: 'https://example.com/a.ics', hours: '9-17' }, extra)));
    return r.data.hour_rows;
  }

  test('hours outside the core window are kept, but at a fraction of a core hour’s height', async () => {
    const rows = await hourRows();
    // hour_rows carries all 24 hours; the ones outside the visible window are there with pct 0.
    const visible = rows.filter((r) => r.pct > 0);
    const ext = visible.filter((r) => !r.important);
    const core = visible.filter((r) => r.important);
    assert(ext.length > 0, 'no out-of-core hours were produced, so this test proves nothing');
    assert(core.length > 0, 'no core hours were produced');

    const avg = (list) => list.reduce((sum, r) => sum + r.pct, 0) / list.length;
    const ratio = avg(ext) / avg(core);
    // The window stretches to cover a late event or an early "now", and at close to parity those
    // hours took about 40% of an 800x480 grid to say nothing. They shrink; they do not vanish,
    // because an event out there is the whole reason the window stretched.
    assert(ratio > 0.25 && ratio < 0.45, 'out-of-core hours should be roughly a third of a core hour, got ratio ' + ratio.toFixed(3));
    for (const r of ext) assert(r.pct > 0, 'an out-of-core hour collapsed to nothing: ' + JSON.stringify(r));
  });

  test('only the visible window gets height, and it is the hours from "now" to the end of the range', async () => {
    const rows = await hourRows();
    const visible = rows.filter((r) => r.pct > 0).map((r) => parseInt(r.hour, 10));
    // 06:30 "now" pulls the window back from the configured 9, and it runs to the configured end.
    assert(visible[0] === 6, 'the window should start at the hour containing "now", got ' + visible[0]);
    assert(visible[visible.length - 1] === 16, 'the window should end with the configured range, got ' + visible[visible.length - 1]);
    for (let i = 1; i < visible.length; i++) {
      assert(visible[i] === visible[i - 1] + 1, 'visible hours are not consecutive: ' + visible.join(','));
    }
    const hidden = rows.filter((r) => r.pct === 0).map((r) => parseInt(r.hour, 10));
    assert(hidden.every((hr) => hr < 6 || hr > 16), 'an hour inside the window was given no height: ' + hidden.join(','));
  });
};
