module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, okJson, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-05T12:00:00Z');
  const EVENT = { uid: 1, start: '20260905T120000Z', end: '20260905T130000Z', summary: 'Event' };

  function weatherJson() {
    return {
      daily: { sunrise: ['2026-09-05T06:00'], sunset: ['2026-09-05T20:00'], temperature_2m_max: [25], temperature_2m_min: [14] },
      hourly: { time: ['2026-09-05T12:00'], weathercode: [0] },
    };
  }

  test('view_days: shows exactly that many days', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    for (const n of [1, 2, 3]) {
      const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: String(n) }));
      assertEqual(r.data.days.length, n, 'view_days=' + n);
    }
  });

  test('view_days: out-of-range values clamp into 1-3 instead of crashing', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    let r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '0' }));
    assertEqual(r.data.days.length, 1, 'view_days=0 should clamp up to 1');
    r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '99' }));
    assertEqual(r.data.days.length, 3, 'view_days=99 should clamp down to 3');
    r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: 'garbage' }));
    assertEqual(r.data.days.length, 3, 'unparseable view_days should fall back to the plugin default (3)');
  });

  test('full_view_style: defaults to the timeline grid (data.full_view_grid true) when unset', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.data.full_view_grid, true, 'timeline grid should be the default, matching settings.yml\'s own default: grid');
  });

  test('full_view_style: "agenda" selects the agenda list (data.full_view_grid false)', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', full_view_style: 'agenda' }));
    assertEqual(r.data.full_view_grid, false, '"agenda" should select the agenda list');
  });

  test('time_format: 24h shows raw 0-23 hours with no AM/PM period', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', time_format: '24h' }));
    const midnight = r.data.hour_rows[0];
    assertEqual(midnight.hour, 0);
    assertEqual(midnight.period, null);
  });

  test('time_format: 12h shows 12-hour hours with an AM/PM period', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', time_format: '12h' }));
    const midnight = r.data.hour_rows[0];
    assertEqual(midnight.hour, 12, 'midnight should read as 12, not 0, in 12h mode');
    assertEqual(midnight.period, 'AM');
    const noon = r.data.hour_rows[12];
    assertEqual(noon.hour, 12);
    assertEqual(noon.period, 'PM');
  });

  test('hours: a custom "start-end" range is honored instead of the 7-21 default', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', hours: '9-17' }));
    // Hours well outside the requested core range (and outside today's real event/now window)
    // collapse toward zero share, while an hour inside it keeps a real, non-trivial share.
    assertEqual(r.data.hour_rows[9].pct > 0, true, 'hour 9 (start of range) should get real height');
    assertEqual(r.data.error, null);
  });

  test('hours: a malformed range falls back to the default instead of crashing', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', hours: 'not-a-range' }));
    assertEqual(r.data.error, null);
    assertEqual(r.data.hour_rows.length, 24);
  });

  test('temperature_unit: celsius by default, requests no unit override from Open-Meteo', async () => {
    let sawUrl = null;
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) { sawUrl = url; return okJson(weatherJson()); }
      return okText(icsWithEvents([EVENT]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', lat_lon: '52.0,4.0' }));
    assertEqual(r.data.temp_unit, 'C');
    assert(!sawUrl.includes('fahrenheit'), 'celsius is Open-Meteo\'s default, so the request should not ask for fahrenheit');
  });

  test('temperature_unit: fahrenheit asks Open-Meteo for fahrenheit and labels the UI "F"', async () => {
    let sawUrl = null;
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) { sawUrl = url; return okJson(weatherJson()); }
      return okText(icsWithEvents([EVENT]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', lat_lon: '52.0,4.0', temperature_unit: 'fahrenheit' }));
    assertEqual(r.data.temp_unit, 'F');
    assert(sawUrl.includes('temperature_unit=fahrenheit'), 'should pass fahrenheit through to the Open-Meteo request');
  });

  test('lat_lon blank: no weather/sunrise fetch happens, and nothing crashes', async () => {
    let sawWeatherFetch = false;
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) { sawWeatherFetch = true; return okJson(weatherJson()); }
      return okText(icsWithEvents([EVENT]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(sawWeatherFetch, false, 'no lat_lon means no weather API call should be made at all');
    assertEqual(r.data.days[0].temp, null);
    assertEqual(r.data.days[0].icon, null);
    assertEqual(r.data.error, null);
  });

  test('rss_label: defaults to "NEWS" when blank', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('rss')) return okText('<rss><channel><title>Feed</title><item><title>Headline</title></item></channel></rss>');
      return okText(icsWithEvents([EVENT]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', news_feed_enabled: 'true', rss_url: 'https://example.com/rss.xml' }));
    assertEqual(r.data.rss_headline.label, 'NEWS');
  });

  test('rss_label: a custom label overrides the "NEWS" default', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('rss')) return okText('<rss><channel><title>Feed</title><item><title>Headline</title></item></channel></rss>');
      return okText(icsWithEvents([EVENT]));
    };
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({
      calendars_simple: 'https://example.com/a.ics',
      news_feed_enabled: 'true',
      rss_url: 'https://example.com/rss.xml',
      rss_label: 'SPORTS',
    }));
    assertEqual(r.data.rss_headline.label, 'SPORTS');
  });

  test('a status value on an event never hides it by itself — only an explicit rule can', async () => {
    const events = [
      { uid: 1, start: '20260905T090000Z', end: '20260905T100000Z', summary: 'Confirmed', status: 'CONFIRMED' },
      { uid: 2, start: '20260905T110000Z', end: '20260905T120000Z', summary: 'Tentative', status: 'TENTATIVE' },
      { uid: 3, start: '20260905T130000Z', end: '20260905T140000Z', summary: 'Cancelled', status: 'CANCELLED' },
      { uid: 4, start: '20260905T150000Z', end: '20260905T160000Z', summary: 'No Status' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles.sort(), ['Cancelled', 'Confirmed', 'No Status', 'Tentative'].sort());
  });

  test('hiding unconfirmed events is done via an Advanced Configuration status rule, not a setting', async () => {
    const events = [
      { uid: 1, start: '20260905T090000Z', end: '20260905T100000Z', summary: 'Confirmed', status: 'CONFIRMED' },
      { uid: 2, start: '20260905T110000Z', end: '20260905T120000Z', summary: 'Tentative', status: 'TENTATIVE' },
      { uid: 3, start: '20260905T130000Z', end: '20260905T140000Z', summary: 'Cancelled', status: 'CANCELLED' },
      { uid: 4, start: '20260905T150000Z', end: '20260905T160000Z', summary: 'No Status' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput({
      view_days: '3',
      advanced_config_enabled: 'true',
      calendars: JSON.stringify({
        calendars: [{
          url: 'https://example.com/a.ics',
          rules: [{ match: { type: 'or', matchers: [{ type: 'status', value: 'tentative' }, { type: 'status', value: 'cancelled' }] }, hide: true }],
        }],
      }),
    });
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles.sort(), ['Confirmed', 'No Status'].sort());
  });
};
