module.exports = function (test, h) {
  const { measured, assert } = h;

  // The full view's Timeline Grid draws positioned event boxes (cal-chip), not agenda rows, so
  // the row-based cases above say nothing about it: these are its own.
  test('full: the timeline grid draws its events as chips', () => {
    const m = measured.full;
    assert(m.chips.length >= 4, 'expected several event chips, got ' + m.chips.length);
  });

  test('full: every chip is inside the view', () => {
    const m = measured.full;
    const out = m.chips.filter((c) => c.box.bottom > m.view.bottom + 1 || c.box.top < m.view.top - 1
      || c.box.right > m.view.right + 1 || c.box.left < m.view.left - 1);
    assert(out.length === 0, 'chips outside the view: ' + out.map((c) => c.text.slice(0, 20) + ' @' + JSON.stringify(c.box)).join(', '));
  });

  test('full: no chip is drawn over the footer', () => {
    const m = measured.full;
    if (!m.footer) return;
    const over = m.chips.filter((c) => c.box.bottom > m.footer.top + 1);
    assert(over.length === 0, 'chips overlapping the footer: ' + over.map((c) => c.text.slice(0, 20)).join(', '));
  });

  test('full: chips are white cards with a colour accent, same treatment as the agenda rows', () => {
    const m = measured.full;
    assert(m.chips.length > 0, 'no chips were rendered, so this check would pass on nothing');
    for (const c of m.chips) {
      assert(c.bg === 'rgb(255, 255, 255)', 'chip "' + c.text.slice(0, 20) + '" has background ' + c.bg);
      assert(/^bg--/.test(c.accentHue), 'chip "' + c.text.slice(0, 20) + '" has no colour accent');
    }
  });
};
