module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, okJson, fail, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-05T12:00:00Z');
  const EVENT = { uid: 1, start: '20260905T120000Z', end: '20260905T130000Z', summary: 'Event' };

  function weatherJson() {
    return {
      daily: { sunrise: ['2026-09-05T06:00'], sunset: ['2026-09-05T20:00'], temperature_2m_max: [25], temperature_2m_min: [14] },
      hourly: { time: ['2026-09-05T12:00'], weathercode: [0] },
    };
  }

  test('weather: falls back to the last successful forecast on a failed fetch, instead of blanking it', async () => {
    let skyFails = false;
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) return skyFails ? fail(500) : okJson(weatherJson());
      return okText(icsWithEvents([EVENT]));
    };
    const cfg = { calendars_simple: 'https://example.com/a.ics', lat_lon: '52.0,4.0' };

    let r = await runTransform(fetchImpl, NOW).run(baseInput(cfg, {}));
    assertEqual(r.data.days[0].temp, { high: 25, low: 14 });

    skyFails = true;
    r = await runTransform(fetchImpl, NOW + 60 * 60 * 1000).run(baseInput(cfg, r.trmnl_state));
    assertEqual(r.data.days[0].temp, { high: 25, low: 14 }, 'should keep showing the last real forecast');
    assert(!!r.data.weather_error, 'the underlying error should still be reported');
  });

  test('weather: does not flag "stale" until the fallback has actually been running a long time', async () => {
    let skyFails = false;
    const fetchImpl = async (url) => {
      if (url.includes('open-meteo')) return skyFails ? fail(500) : okJson(weatherJson());
      return okText(icsWithEvents([EVENT]));
    };
    const cfg = { calendars_simple: 'https://example.com/a.ics', lat_lon: '52.0,4.0' };

    let r = await runTransform(fetchImpl, NOW).run(baseInput(cfg, {}));
    let state = r.trmnl_state;
    skyFails = true;

    r = await runTransform(fetchImpl, NOW + 2 * 60 * 60 * 1000).run(baseInput(cfg, state));
    state = r.trmnl_state;
    assertEqual(r.data.weather_stale, false, 'only 2h stale — should not flag yet');

    r = await runTransform(fetchImpl, NOW + 7 * 60 * 60 * 1000).run(baseInput(cfg, state));
    assertEqual(r.data.weather_stale, true, '7h stale — should flag now');
  });

  test('news: keeps the last headlines on a failed fetch while the feature is on', async () => {
    let rssFails = false;
    const fetchImpl = async (url) => {
      if (url.includes('rss')) return rssFails ? fail(500) : okText('<rss><channel><title>Feed</title><item><title>Headline</title></item></channel></rss>');
      return okText(icsWithEvents([EVENT]));
    };
    const cfg = { calendars_simple: 'https://example.com/a.ics', news_feed_enabled: 'true', rss_url: 'https://example.com/rss.xml' };

    let r = await runTransform(fetchImpl, NOW).run(baseInput(cfg, {}));
    assert(!!r.data.rss_headline, 'first fetch should succeed');

    rssFails = true;
    r = await runTransform(fetchImpl, NOW + 60 * 60 * 1000).run(baseInput(cfg, r.trmnl_state));
    assert(!!r.data.rss_headline, 'should keep the cached headline despite the failed fetch');
  });

  test('news: turning the feature off does not resurrect a previously-cached headline', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('rss')) return okText('<rss><channel><title>Feed</title><item><title>Headline</title></item></channel></rss>');
      return okText(icsWithEvents([EVENT]));
    };
    const cfgOn = { calendars_simple: 'https://example.com/a.ics', news_feed_enabled: 'true', rss_url: 'https://example.com/rss.xml' };
    const cfgOff = { calendars_simple: 'https://example.com/a.ics', news_feed_enabled: 'false', rss_url: 'https://example.com/rss.xml' };

    let r = await runTransform(fetchImpl, NOW).run(baseInput(cfgOn, {}));
    assert(!!r.data.rss_headline, 'feature on: headline present');

    r = await runTransform(fetchImpl, NOW + 60000).run(baseInput(cfgOff, r.trmnl_state));
    assertEqual(r.data.rss_headline, null, 'feature off: no headline, even though one was cached');
  });
};
