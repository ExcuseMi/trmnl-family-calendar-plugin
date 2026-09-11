module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, clickButtonByText, jsonOut, assert, assertEqual } = h;

  test('the first person is labeled as the Everyone fallback and its badge input is disabled', () => {
    const { document } = loadEditor();
    document.getElementById('addPerson').click();
    const entry = document.querySelector('#people .entry');
    assertEqual(entry.querySelector('strong').textContent, 'Everyone / All (fallback)');
    const badgeInput = entry.querySelectorAll('input[type=text]')[1];
    assert(badgeInput.disabled, 'badge input should be disabled for the first (Everyone) person — a built-in icon renders instead');
  });

  test('a second person is NOT labeled Everyone, and its badge input is editable', () => {
    const { document } = loadEditor();
    document.getElementById('addPerson').click();
    document.getElementById('addPerson').click();
    const entries = document.querySelectorAll('#people .entry');
    assertEqual(entries[1].querySelector('strong').textContent, 'Person 1');
    const badgeInput = entries[1].querySelectorAll('input[type=text]')[1];
    assert(!badgeInput.disabled, 'badge input should be editable for anyone other than the first person');
  });

  test('moving a person up makes them the new Everyone fallback', () => {
    const { document } = loadEditor();
    document.getElementById('addPerson').click();
    document.getElementById('addPerson').click();
    let entries = document.querySelectorAll('#people .entry');
    fireInput(entries[0].querySelector('input[type=text]'), 'Jordan');
    fireInput(entries[1].querySelector('input[type=text]'), 'Alex');
    clickButtonByText(entries[1], '↑');
    entries = document.querySelectorAll('#people .entry');
    assertEqual(entries[0].querySelector('input[type=text]').value, 'Alex', 'Alex should now be first');
    assertEqual(jsonOut(document).people[0].name, 'Alex');
  });

  test('a person with no name is dropped from the export', () => {
    const { document } = loadEditor();
    document.getElementById('addPerson').click();
    assertEqual(jsonOut(document).people, []);
  });

  test('a declared color and badge both export for a non-Everyone person', () => {
    const { document } = loadEditor();
    document.getElementById('addPerson').click(); // Everyone slot, left blank
    document.getElementById('addPerson').click();
    const entries = document.querySelectorAll('#people .entry');
    fireInput(entries[1].querySelector('input[type=text]'), 'Alex');
    const colorSel = entries[1].querySelector('select');
    colorSel.value = 'pink';
    colorSel.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    fireInput(entries[1].querySelectorAll('input[type=text]')[1], 'A');
    assertEqual(jsonOut(document).people, [{ name: 'Alex', color: 'pink', badge: 'A' }]);
  });

  test('a person\'s color swatch resets to the no-color style after clearing the color back to (none)', () => {
    const { document } = loadEditor();
    document.getElementById('addPerson').click();
    const entry = document.querySelector('#people .entry');
    const colorSel = entry.querySelector('select');
    const swatch = entry.querySelector('.swatch');
    fireChange(colorSel, 'pink');
    assert(swatch.getAttribute('style').indexOf('dashed') === -1, 'swatch should show a real color after picking pink');
    fireChange(colorSel, '');
    assert(swatch.getAttribute('style').indexOf('dashed') !== -1, 'swatch should go back to the dashed "no color" style once cleared');
  });
};
