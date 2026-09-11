module.exports = function (test, h) {
  const { measured, assert } = h;

  const SINGLE_DAY = ['half_horizontal', 'half_vertical', 'quadrant'];

  for (const name of SINGLE_DAY) {
    test(name + ': shows the day as a list of rows, not a single chip', () => {
      const m = measured[name];
      assert(m.rows.length >= 3, 'expected at least 3 agenda rows, got ' + m.rows.length);
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
