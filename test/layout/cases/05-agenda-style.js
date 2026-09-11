module.exports = function (test, h) {
  const { measured, assert } = h;

  // The full view's other style (Full View Style = agenda): one list per day instead of the
  // timeline grid. It shares the .item row markup with the small views but sets title_clamp, so
  // its rows wrap instead of running on one line, and it is the only place an all-day row sits
  // in a column narrow enough to lose its ending.
  test('full_agenda: each visible day gets a list of rows', () => {
    const m = measured.full_agenda;
    assert(m.rows.length >= 6, 'expected rows across the day columns, got ' + m.rows.length);
  });

  test('full_agenda: an all-day title wraps instead of taking an ellipsis', () => {
    const m = measured.full_agenda;
    const conf = m.rows.find((r) => r.text.includes('Conference'));
    assert(conf, 'the multi-day all-day fixture event is not in any column');
    assert(conf.text.includes('TRMNL Summit'), 'all-day title was cut: ' + conf.text);
  });

  test('full_agenda: rows are the same white card with a colour accent as everywhere else', () => {
    const m = measured.full_agenda;
    assert(m.rows.length > 0, 'no rows were rendered, so this check would pass on nothing');
    for (const r of m.rows) {
      assert(r.bg === 'rgb(255, 255, 255)', 'row "' + r.text.slice(0, 24) + '" has background ' + r.bg);
      assert(/^bg--/.test(r.accentHue), 'row "' + r.text.slice(0, 24) + '" has no colour accent bar');
    }
  });
};
