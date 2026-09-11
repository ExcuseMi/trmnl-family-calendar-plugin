module.exports = function (test, h) {
  const { measured, assert } = h;

  const RANGE = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}\b/;
  // No whitespace requirement after the time: the gap between the time and the title is a CSS
  // one (the row is a flex line with a gap), so the extracted text runs them together. What
  // matters is that the label is one time and not a range.
  const START_ONLY = /^\d{1,2}:\d{2}(?!\s*-\s*\d)/;

  // The single-day views drop the end of the time range so the title gets that width instead.
  // The fixture deliberately carries titles that do not fit one of these rows beside a full
  // range. half_horizontal is in this list despite its wide slot: it splits into two columns,
  // which makes its rows narrower than half_vertical's.
  for (const name of ['half_vertical', 'quadrant', 'half_horizontal']) {
    test(name + ': timed rows show the start time only', () => {
      const m = measured[name];
      const timed = m.rows.filter((r) => /^\d/.test(r.text));
      assert(timed.length > 0, 'no timed rows were rendered at all');
      const ranges = timed.filter((r) => RANGE.test(r.text));
      assert(ranges.length === 0, 'rows still showing a full range: ' + ranges.map((r) => r.text.slice(0, 24)).join(', '));
      for (const r of timed) assert(START_ONLY.test(r.text), 'unexpected time label: ' + r.text.slice(0, 30));
    });
  }


  test('half_vertical: a long title is not traded away for the time label', () => {
    const m = measured.half_vertical;
    const workshop = m.rows.find((r) => r.text.includes('Client workshop'));
    assert(workshop, 'the long-title fixture event is not in the list');
    assert(workshop.text.includes('onboarding flow'), 'title was cut: ' + workshop.text);
  });
};
