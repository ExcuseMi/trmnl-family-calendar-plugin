module.exports = function (test, h) {
  const { loadEditor, jsonOut, assert, assertEqual } = h;

  function loadJson(document, obj) {
    document.getElementById('importIn').value = JSON.stringify(obj);
    document.getElementById('loadImport').click();
  }

  test('importing a config with and/or, status, and weekday round-trips byte-for-byte', () => {
    const { document } = loadEditor();
    const cfg = {
      calendars: [{
        url: 'https://example.com/a.ics',
        rules: [{
          match: { type: 'or', matchers: [{ type: 'weekday', value: ['FR', 'SA'] }, { type: 'status', value: 'tentative' }] },
          hide: true,
        }],
      }],
      people: [{ name: 'Alex', color: 'pink' }],
    };
    loadJson(document, cfg);
    assertEqual(jsonOut(document), cfg);
  });

  test('importing bare ICS URLs (freetext mode, not JSON) produces one calendar per line', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://example.com/a.ics\nhttps://example.com/b.ics';
    document.getElementById('loadImport').click();
    assertEqual(jsonOut(document).calendars.map((c) => c.url), ['https://example.com/a.ics', 'https://example.com/b.ics']);
  });

  test('a Google public-holiday calendar URL is imported into the holiday section, not the regular one', () => {
    const { document } = loadEditor();
    loadJson(document, {
      calendars: [
        { url: 'https://example.com/family.ics' },
        { url: 'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics', name: 'Holidays', color: 'red' },
      ],
    });
    assertEqual(document.querySelectorAll('#calendars .entry').length, 1, 'only the non-holiday calendar should be in the regular list');
    assertEqual(document.querySelectorAll('#holidayCalendars .entry').length, 1, 'the Google holiday feed should be in its own section');
    const out = jsonOut(document);
    assertEqual(out.calendars.length, 2, 'both still export into one flat calendars[] list');
  });
};
