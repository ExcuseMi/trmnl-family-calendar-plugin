module.exports = function (test, h) {
  const { loadEditor, clickButtonByText, byText, assert } = h;

  // These don't check actual rendered colors (jsdom has no real paint/layout) — they check that
  // the CSS classes driving the color-coding (button.add = green "add something", button.move =
  // blue "reorder", button.danger = red "remove", already existing) land on the right buttons.
  // What color each class resolves to is a CSS concern, covered by eyeballing the page itself.

  test('every "+ Add ..." button (static and dynamically created) is styled as an add action', () => {
    const { document } = loadEditor();
    const staticIds = ['addCalendar', 'addCalendarHoliday', 'addHolidayCalendar', 'addPerson', 'addGlobalRule'];
    staticIds.forEach((id) => {
      const btn = document.getElementById(id);
      assert(btn.classList.contains('add'), '#' + id + ' should have the "add" class');
    });

    document.querySelectorAll('#calendars details.advanced').forEach((d) => { d.open = true; });
    const entry = document.querySelector('#calendars .entry');
    assert(byText(entry, 'button', '+ Add rule').classList.contains('add'), '"+ Add rule" should have the "add" class');
    assert(byText(entry, 'button', '+ Add header').classList.contains('add'), '"+ Add header" should have the "add" class');

    clickButtonByText(entry, '+ Add rule');
    const ruleCard = document.querySelector('#calendars .rule-card');
    assert(byText(ruleCard, 'button', '+ Add condition (AND/OR)').classList.contains('add'), '"+ Add condition" should have the "add" class');
  });

  test('reorder (move up/down) buttons are styled distinctly from add/remove', () => {
    const { document } = loadEditor();
    document.getElementById('addCalendar').click();
    const entries = document.querySelectorAll('#calendars .entry');
    const up = byText(entries[1], 'button', '↑');
    const down = byText(entries[1], 'button', '↓');
    assert(up.classList.contains('move'), 'Move up should have the "move" class');
    assert(down.classList.contains('move'), 'Move down should have the "move" class');
    assert(!up.classList.contains('add') && !up.classList.contains('danger'), 'move buttons should not also be styled as add/danger');
  });

  test('remove buttons keep the existing danger (red) styling, unaffected by the new colors', () => {
    const { document } = loadEditor();
    document.getElementById('addCalendar').click();
    const entries = document.querySelectorAll('#calendars .entry');
    const removeBtn = byText(entries[1], 'button', 'Remove');
    assert(removeBtn.classList.contains('danger'), 'calendar Remove should still be styled danger');

    document.querySelectorAll('#calendars details.advanced').forEach((d) => { d.open = true; });
    clickButtonByText(entries[0], '+ Add rule');
    const ruleCard = document.querySelector('#calendars .rule-card');
    assert(byText(ruleCard, 'button', 'Remove rule').classList.contains('danger'), '"Remove rule" should still be styled danger');
  });
};
