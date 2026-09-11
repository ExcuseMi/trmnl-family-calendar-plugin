module.exports = function (test, h) {
  const { loadEditor, fireChange, jsonOut, assertEqual } = h;

  test('adding a public holiday calendar fills in the correct Google ICS URL for the chosen country', () => {
    const { document } = loadEditor();
    const countrySelect = document.getElementById('holidayCountrySelect');
    fireChange(countrySelect, 'dutch'); // Netherlands, per HOLIDAY_COUNTRIES
    document.getElementById('addHolidayCalendar').click();
    const out = jsonOut(document);
    assertEqual(out.calendars.length, 1);
    assertEqual(out.calendars[0].url, 'https://calendar.google.com/calendar/ical/en.dutch%23holiday%40group.v.calendar.google.com/public/basic.ics');
    assertEqual(out.calendars[0].name, 'Holidays');
    assertEqual(out.calendars[0].color, 'red');
  });

  test('a holiday calendar lives in its own section, separate from + Add calendar entries', () => {
    const { document } = loadEditor();
    document.getElementById('addHolidayCalendar').click();
    document.getElementById('addCalendar').click();
    assertEqual(document.querySelectorAll('#holidayCalendars .entry').length, 1);
    // The regular calendars section starts with one blank entry already present, +1 for addCalendar.
    assertEqual(document.querySelectorAll('#calendars .entry').length, 2);
  });
};
