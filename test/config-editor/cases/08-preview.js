module.exports = function (test, h) {
  const { loadEditor, assert, assertEqual } = h;

  const URL = 'https://example.com/a.ics';

  function importUrl(document) {
    document.getElementById('importIn').value = URL;
    document.getElementById('loadImport').click();
  }

  async function waitFor(fn, what) {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timed out waiting for ' + what);
  }

  test('the preview sits inside .trmnl .screen, the only scope where the framework paints bg--/text-- colors', () => {
    const { document } = loadEditor();
    assert(document.getElementById('previewDays').closest('.trmnl .screen'), '#previewDays needs a .screen inside .trmnl as an ancestor');
  });

  test('Run test turns Advanced Configuration on, or run() ignores the generated JSON', async () => {
    const { window, document } = loadEditor();
    importUrl(document);
    let input = null;
    window.run = function (i) { input = i; return Promise.resolve({ data: { days: [], allday_bars: [], error: null } }); };
    document.getElementById('runTest').click();
    await waitFor(() => input, 'run() to be called');
    const fields = input.trmnl.plugin_settings.custom_fields_values;
    assertEqual(fields.advanced_config_enabled, 'true');
    assertEqual(JSON.parse(fields.calendars).calendars.map((c) => c.url), [URL]);
  });

  test('a calendar with no color previews in the first named hue, through the real transform.js', async () => {
    const { document } = loadEditor();
    importUrl(document);
    const pasteBox = document.querySelector('#icsSources textarea');
    assert(pasteBox, 'importing a calendar should render its ICS paste box');
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    pasteBox.value = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:' + day + 'T120000Z\r\nDTEND:' + day + 'T130000Z\r\nSUMMARY:Lunch\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    pasteBox.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    document.getElementById('runTest').click();
    const status = document.getElementById('runStatus');
    await waitFor(() => /Done|threw/.test(status.textContent), 'the test run to finish');
    assertEqual(status.textContent, 'Done.');
    const chip = document.querySelector('#previewDays .preview-event');
    assert(chip, 'the pasted event should appear in the preview');
    assertEqual(chip.className, 'preview-event bg--blue-65 text--black');
  });
};
