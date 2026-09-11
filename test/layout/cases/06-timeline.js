module.exports = function (test, h) {
  const { measured, assert } = h;

  const WHITE = 'rgb(255, 255, 255)';
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';

  test('full: the hour axis has rows for the whole visible window', () => {
    const m = measured.full;
    assert(m.axisRows.length >= 8, 'expected an hour row per visible hour, got ' + m.axisRows.length);
  });

  // A light gray is not a tone on the 1-bit panels most TRMNLs are, it is a dither pattern, and
  // banding every other hour ran a column of noise down the side of the board.
  test('full: no hour row is banded with a gray fill', () => {
    const m = measured.full;
    const banded = m.axisRows.filter((r) => !r.current
      && (r.bgClass || r.bgImage || (r.bg !== WHITE && r.bg !== TRANSPARENT)));
    assert(banded.length === 0, 'hour rows carrying a fill: '
      + banded.map((r) => r.text + ' ' + (r.bgClass || r.bgImage || r.bg)).join(', '));
  });

  // Out-of-core hours are squeezed hard, so some rows are only a few pixels tall. A label there
  // overlaps its neighbours instead of reading as an hour.
  test('full: an hour is only labelled where its row can hold the label', () => {
    const m = measured.full;
    const tooSmall = m.axisRows.filter((r) => r.labelBox && r.labelBox.h > r.box.h + 2);
    assert(tooSmall.length === 0, 'labels taller than their row: '
      + tooSmall.map((r) => r.text + ' label ' + r.labelBox.h + 'px in ' + r.box.h + 'px').join(', '));
  });

  test('full: hour labels never overlap each other', () => {
    const m = measured.full;
    const labels = m.axisRows.filter((r) => r.labelBox).map((r) => ({ t: r.text, b: r.labelBox }))
      .sort((a, b) => a.b.top - b.b.top);
    for (let i = 1; i < labels.length; i++) {
      assert(labels[i].b.top >= labels[i - 1].b.bottom - 1,
        'hour labels overlap: "' + labels[i - 1].t + '" ends at ' + labels[i - 1].b.bottom
        + ' and "' + labels[i].t + '" starts at ' + labels[i].b.top);
    }
  });
};
