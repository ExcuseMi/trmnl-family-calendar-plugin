module.exports = function (test, h) {
  const { measured, assert } = h;

  // How many rows each slot is expected to carry, with a fixture that deliberately has more
  // events than any of them can show. These are floors, not exact counts: they exist so that a
  // change which quietly costs a slot a row (a taller row, a bigger footer, a percentage taken
  // off the list) shows up here rather than on somebody's wall. half_vertical's is the one with
  // history — it was 6 while it was paying for a footer floor that only the short slots owe.
  const MIN_ROWS = { half_horizontal: 6, half_vertical: 8, quadrant: 3 };
  const SINGLE_DAY = Object.keys(MIN_ROWS);

  for (const name of SINGLE_DAY) {
    test(name + ': shows the day as a list of rows, not a single chip', () => {
      const m = measured[name];
      assert(m.rows.length >= MIN_ROWS[name],
        'expected at least ' + MIN_ROWS[name] + ' agenda rows, got ' + m.rows.length);
    });

    // A filled hue is not a colour on a 1-bit panel, it is a dither pattern, and a row that puts
    // its text on top of one is what made these views look noisy. White card, colour on the edge.
    test(name + ': rows are white cards with a colour accent, not colour-filled', () => {
      const m = measured[name];
      assert(m.rows.length > 0, 'no rows were rendered, so this check would pass on nothing');
      for (const r of m.rows) {
        assert(r.bg === 'rgb(255, 255, 255)', 'row "' + r.text.slice(0, 24) + '" has background ' + r.bg);
        assert(/^bg--/.test(r.accentHue), 'row "' + r.text.slice(0, 24) + '" has no colour accent bar');
        assert(r.accentW > 0 && r.accentW <= 12, 'accent bar on "' + r.text.slice(0, 24) + '" is ' + r.accentW + 'px wide');
      }
    });
  }

  for (const name of Object.keys(measured)) {
    test(name + ': no text is cut off mid-word', () => {
      const m = measured[name];
      assert(m.clipped.length === 0, 'clipped: ' + m.clipped.join(' | '));
    });
  }
};
