module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, clickButtonByText, jsonOut, assert, assertEqual } = h;

  test('a bare calendar URL exports as the minimal shape', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#calendars .field-url'), 'https://example.com/a.ics');
    assertEqual(jsonOut(document), { calendars: [{ url: 'https://example.com/a.ics' }], people: [] });
  });

  test('name and color are included only once actually set', () => {
    const { document } = loadEditor();
    const entry = document.querySelector('#calendars .entry');
    fireInput(entry.querySelector('.field-url'), 'https://example.com/a.ics');
    // The name field is the entry's own header (an input styled as a heading), not a separate
    // labeled "Name" field in the body — see entry-title-input in config-editor.html.
    fireInput(entry.querySelector('.entry-title-input'), 'Family');
    // The entry now also has a "Person" <select> (assign-person-to-calendar) before the color
    // one — the color select is specifically the one carrying color option values.
    const colorSel = Array.from(entry.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'blue'));
    colorSel.value = 'blue';
    colorSel.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    assertEqual(jsonOut(document), { calendars: [{ url: 'https://example.com/a.ics', name: 'Family', color: 'blue' }], people: [] });
  });

  test('the color swatch resets to the no-color style after picking a color then clearing it back to (auto)', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#calendars .field-url'), 'https://example.com/a.ics');
    const entry = document.querySelector('#calendars .entry');
    const colorSel = Array.from(entry.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'blue'));
    const swatch = entry.querySelector('.swatch');
    fireChange(colorSel, 'blue');
    assert(swatch.getAttribute('style').indexOf('dashed') === -1, 'swatch should show a real color after picking blue');
    fireChange(colorSel, '');
    assert(swatch.getAttribute('style').indexOf('dashed') !== -1, 'swatch should go back to the dashed "no color" style once cleared — it must not stay stuck on the last color');
  });

  test('the entry heading shows "Calendar N" as a placeholder until named, then shows the real name', () => {
    const { document } = loadEditor();
    document.getElementById('addCalendar').click();
    const entries = document.querySelectorAll('#calendars .entry');
    const title2 = entries[1].querySelector('.entry-title-input');
    assertEqual(title2.placeholder, 'Calendar 2', 'the 2nd entry should read "Calendar 2" until named');
    assertEqual(title2.value, '', 'no real name should be set yet — "Calendar 2" is only a placeholder');
    fireInput(title2, 'Work');
    assertEqual(title2.value, 'Work', 'typing directly into the heading should set the calendar\'s name');
    assertEqual(document.querySelectorAll('#calendars .entry')[1].querySelector('.entry-title-input').value, 'Work');
  });

  test('a blank calendar entry (no URL) is dropped from the export', () => {
    const { document } = loadEditor();
    assertEqual(jsonOut(document), { calendars: [], people: [] });
  });

  test('+ Add calendar appends another calendar row, independently exported', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#calendars .field-url'), 'https://example.com/a.ics');
    document.getElementById('addCalendar').click();
    const urls = document.querySelectorAll('#calendars .field-url');
    assertEqual(urls.length, 2, 'a second calendar row should exist');
    fireInput(urls[1], 'https://example.com/b.ics');
    assertEqual(jsonOut(document).calendars.map((c) => c.url), ['https://example.com/a.ics', 'https://example.com/b.ics']);
  });

  // Assigning a person directly on a calendar (rather than via a rule) is a convenience for the
  // common "this whole feed belongs to one person" case — it exports as an implicit "match
  // everything" rule so applyCalendarRules (transform.js) still lets a more specific per-title
  // rule further down the list override it (later matches win there).
  function personSelectOf(entry) {
    return Array.from(entry.querySelectorAll('select')).find((s) => s.multiple);
  }
  function colorSelectOf(entry) {
    return Array.from(entry.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'blue'));
  }

  test('assigning a person to a calendar exports as an implicit "match everything" rule, placed before other rules', () => {
    const { document } = loadEditor();
    const entry = document.querySelector('#calendars .entry');
    fireInput(entry.querySelector('.field-url'), 'https://example.com/a.ics');
    document.getElementById('addPerson').click();
    fireInput(document.querySelector('#people .field-narrow'), 'Alex');
    const personSelect = personSelectOf(document.querySelector('#calendars .entry'));
    Array.from(personSelect.options).find((o) => o.value === 'Alex').selected = true;
    fireChange(personSelect);
    document.querySelectorAll('#calendars details.advanced').forEach((d) => { d.open = true; });
    clickButtonByText(document.querySelector('#calendars .entry'), '+ Add rule');
    const ruleCard = document.querySelector('#calendars .rule-card');
    fireInput(ruleCard.querySelector('.rule-step .sub-entry input'), 'Standup');
    const thenStep = (function addHide() {
      const step = ruleCard.querySelectorAll('.rule-step')[1];
      const sel = Array.from(step.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === ''));
      fireChange(sel, 'hide');
      clickButtonByText(step, '+ Add');
      return ruleCard.querySelectorAll('.rule-step')[1];
    })();
    assert(thenStep, 'the "hide" action block should have been added');
    assertEqual(jsonOut(document).calendars[0].rules, [
      { match: { type: 'any' }, person: 'Alex' },
      { match: { type: 'word', value: 'Standup' }, hide: true },
    ]);
  });

  test('assigning a person with a color presets the calendar color, but a later manual change sticks', () => {
    const { document } = loadEditor();
    const entry = document.querySelector('#calendars .entry');
    fireInput(entry.querySelector('.field-url'), 'https://example.com/a.ics');
    document.getElementById('addPerson').click();
    const peopleEntry = document.querySelector('#people .entry');
    fireInput(peopleEntry.querySelector('.field-narrow'), 'Alex');
    fireChange(peopleEntry.querySelector('select'), 'pink');

    const calEntry = document.querySelector('#calendars .entry');
    const personSelect = personSelectOf(calEntry);
    Array.from(personSelect.options).find((o) => o.value === 'Alex').selected = true;
    fireChange(personSelect);
    assertEqual(jsonOut(document).calendars[0].color, 'pink', 'the calendar color should be preset to the assigned person\'s color');

    const colorSel = colorSelectOf(calEntry);
    fireChange(colorSel, 'blue');
    assertEqual(jsonOut(document).calendars[0].color, 'blue', 'a manual color change afterward must not be fought or reverted');
  });

  test('assigning a person with no color set does not touch an existing calendar color', () => {
    const { document } = loadEditor();
    const entry = document.querySelector('#calendars .entry');
    fireInput(entry.querySelector('.field-url'), 'https://example.com/a.ics');
    const colorSel = colorSelectOf(entry);
    fireChange(colorSel, 'blue');
    document.getElementById('addPerson').click();
    fireInput(document.querySelector('#people .field-narrow'), 'Alex');
    const calEntry = document.querySelector('#calendars .entry');
    const personSelect = personSelectOf(calEntry);
    Array.from(personSelect.options).find((o) => o.value === 'Alex').selected = true;
    fireChange(personSelect);
    assertEqual(jsonOut(document).calendars[0].color, 'blue', 'a colorless person must not clear/change the existing calendar color');
  });
};
