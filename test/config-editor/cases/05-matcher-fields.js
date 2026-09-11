module.exports = function (test, h) {
  const { loadEditor, fireChange, clickButtonByText, assertEqual } = h;

  function setupRuleCard(document) {
    document.querySelectorAll('#calendars details.advanced').forEach((d) => { d.open = true; });
    clickButtonByText(document.querySelector('#calendars .entry'), '+ Add rule');
    return document.querySelector('#calendars .rule-card');
  }

  // Checks the actual RENDERED visibility (computed `display`), not just the `.hidden` DOM
  // property — an element can have `hidden` set and still render visible if an inline style
  // (or any other higher-specificity CSS) also sets `display` on it, since the browser's own
  // `[hidden] { display: none }` rule is very low specificity. This distinction is exactly what
  // caught a real bug: the weekday button group had a hardcoded inline `display:flex` that kept
  // it visible even while `.hidden` was true.
  function isVisible(document, el) {
    return document.defaultView.getComputedStyle(el).display !== 'none';
  }

  // Each match type shows exactly the input(s) it needs and hides the rest — a stray visible
  // (or wrongly hidden) field here is exactly the kind of thing that's obvious in a screenshot
  // but easy to regress silently in code.
  const EXPECTATIONS = {
    word: { text: true, regex: false, status: false, weekday: false },
    contains: { text: true, regex: false, status: false, weekday: false },
    exact: { text: true, regex: false, status: false, weekday: false },
    regex: { text: false, regex: true, status: false, weekday: false },
    any: { text: false, regex: false, status: false, weekday: false },
    status: { text: false, regex: false, status: true, weekday: false },
    weekday: { text: false, regex: false, status: false, weekday: true },
  };

  Object.keys(EXPECTATIONS).forEach((type) => {
    const exp = EXPECTATIONS[type];
    test('match type "' + type + '" renders only its own field(s) visible', () => {
      const { document } = loadEditor();
      const ruleCard = setupRuleCard(document);
      const row = ruleCard.querySelector('.rule-step .sub-entry');
      fireChange(row.querySelector('select'), type);
      const [, textInput, regexInput, statusSelect, weekdayGroup] = row.children;
      assertEqual(isVisible(document, textInput), exp.text, 'text input visibility for ' + type);
      assertEqual(isVisible(document, regexInput), exp.regex, 'regex input visibility for ' + type);
      assertEqual(isVisible(document, statusSelect), exp.status, 'status select visibility for ' + type);
      assertEqual(isVisible(document, weekdayGroup), exp.weekday, 'weekday group visibility for ' + type);
    });
  });

  test('the live tester row is hidden for non-title-testable types (status/weekday)', () => {
    const { document } = loadEditor();
    const ruleCard = setupRuleCard(document);
    const tester = () => ruleCard.querySelector('.rule-step input[placeholder^="test against"]');
    assertEqual(isVisible(document, tester()), true, 'tester should be visible for the default (word) type');
    fireChange(ruleCard.querySelector('.rule-step select'), 'status');
    assertEqual(isVisible(document, tester()), false, 'tester should hide for status — nothing meaningful to test a sample title against');
    fireChange(ruleCard.querySelector('.rule-step select'), 'word');
    assertEqual(isVisible(document, tester()), true, 'tester should reappear once back on a testable type');
  });

  test('the live tester row is hidden for "any" — it always matches, so there is nothing to test', () => {
    const { document } = loadEditor();
    const ruleCard = setupRuleCard(document);
    const tester = () => ruleCard.querySelector('.rule-step input[placeholder^="test against"]');
    fireChange(ruleCard.querySelector('.rule-step select'), 'any');
    assertEqual(isVisible(document, tester()), false, '"any" matches everything unconditionally — a sample-title test can only ever say "matches"');
  });
};
