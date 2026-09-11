module.exports = function (test, h) {
  const { measured, assert } = h;

  // The footer is the news ticker (or the weather strip). It is the last thing in the column, so
  // anything that ends up on top of it is content the reader loses: this is what a 7%-of-225px
  // footer bar did to its own text, and what the overflow counter did to the footer.
  for (const name of Object.keys(measured)) {
    test(name + ': no agenda row is drawn over the footer', () => {
      const m = measured[name];
      if (!m.footer) return; // full view in grid style has its own footer cells, still measured
      const over = m.rows.filter((r) => r.box.bottom > m.footer.top + 1);
      assert(over.length === 0, 'rows overlapping the footer: ' + over.map((r) => r.text.slice(0, 24) + ' @' + r.box.bottom + ' vs footer ' + m.footer.top).join(', '));
    });

    test(name + ': the "and N more" counter stays above the footer', () => {
      const m = measured[name];
      if (!m.counter || !m.footer) return;
      assert(m.counter.box.bottom <= m.footer.top + 1,
        'counter "' + m.counter.text + '" ends at ' + m.counter.box.bottom + ', footer starts at ' + m.footer.top);
    });

    test(name + ': nothing is laid out past the bottom of the view', () => {
      const m = measured[name];
      const past = m.rows.filter((r) => r.box.bottom > m.view.bottom + 1);
      assert(past.length === 0, 'rows past the view bottom (' + m.view.bottom + '): '
        + past.map((r) => r.text.slice(0, 24) + ' @' + r.box.bottom).join(', '));
    });
  }
};
