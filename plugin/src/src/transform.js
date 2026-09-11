
const SERVERLESS_DEADLINE_MS = 4200;
const CALENDAR_DOWN_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const WEATHER_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DAYS = 3;
const DEFAULT_HOURS = { start: 7, end: 21 };
const AGENDA_SANITY_CAP = 20;
const WD_MAP = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

const HUES = ["blue", "green", "orange", "purple", "red", "cyan", "pink", "lime", "violet", "yellow"];
const GRAY_SHADES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
const BLACK_WHITE = ["black", "white"];
const AUTO_HUES = GRAY_SHADES.map((n) => "gray-" + n);

function isValidColor(v) {
  if (HUES.includes(v) || BLACK_WHITE.includes(v)) return true;
  const m = /^gray-(\d+)$/.exec(v);
  return !!m && GRAY_SHADES.includes(parseInt(m[1], 10));
}

function colorClass(color) {
  return HUES.includes(color) ? color + "-65" : color;
}

function foregroundFor(color) {
  if (color === "black") return "white";
  if (color === "white") return "black";
  const m = /^gray-(\d+)$/.exec(color);
  if (!m) return "black";
  return parseInt(m[1], 10) < 55 ? "white" : "black";
}

async function run(input) {
  const advancedEnabled = cf(input, "advanced_config_enabled").trim().toLowerCase() === "true";
  const simpleUrls = advancedEnabled ? [] : cf(input, "calendars_simple").split(/[\r\n,]+/).map((l) => l.trim()).filter(Boolean);
  const cfg = parseConfig(advancedEnabled ? cf(input, "calendars") : "", simpleUrls);
  const calendars = cfg.calendars;
  const people = cfg.people;
  const globalRules = cfg.globalRules;
  const everyonePerson = cfg.everyonePerson;
  const calendarColors = calendars.map((c) => c.color);
  const locale = cfg.locale || localeOf(input);
  const tzname = cfg.timeZone || userTz(input) || "UTC";
  const is12h = cf(input, "time_format").trim().toLowerCase() === "12h";
  const location = cf(input, "lat_lon");
  const fahrenheit = cf(input, "temperature_unit").trim().toLowerCase() === "fahrenheit";
  const newsFeedEnabled = cf(input, "news_feed_enabled").trim().toLowerCase() === "true";
  const rssUrl = newsFeedEnabled ? cf(input, "rss_url").trim() : "";
  const rssLabel = cf(input, "rss_label").trim() || "NEWS";
  const daysN = toInt(cf(input, "view_days"), DEFAULT_DAYS, 1, 3);
  const fullViewGrid = cf(input, "full_view_style").trim().toLowerCase() !== "agenda";

  const tz = resolveTz(tzname, input);

  if (!calendars.length) {
    return emptyResult(tzname, tz, locale, daysN, is12h, "No ICS URL configured");
  }

  const prevState = (input && input.trmnl && input.trmnl.state) || {};
  const prevCalendarDown = (prevState.calendarDown && typeof prevState.calendarDown === "object") ? prevState.calendarDown : {};
  const prevCalendarNames = (prevState.calendarNames && typeof prevState.calendarNames === "object") ? prevState.calendarNames : {};

  const nowEpoch = Date.now();
  const nowCivil = fromEpoch(nowEpoch, tz);
  const winSCivil = { y: nowCivil.y, mo: nowCivil.mo, d: nowCivil.d };
  const winSEpoch = zonedTimeToUtc(winSCivil.y, winSCivil.mo, winSCivil.d, 0, 0, 0, tz);
  const winEDate = addCivilDays({ ...winSCivil, h: 0, mi: 0, s: 0 }, daysN);
  const winEEpoch = zonedTimeToUtc(winEDate.y, winEDate.mo, winEDate.d, 0, 0, 0, tz);

  const deadline = Date.now() + SERVERLESS_DEADLINE_MS;

  const errors = [];
  const calendarFetches = calendars.map(async (cal, calIdx) => {
    let url = cal.url;
    if (url.startsWith("webcal://")) url = "https://" + url.slice("webcal://".length);
    try {
      const budget = msUntil(deadline);
      if (budget <= 0) throw new Error("timed out");
      const headers = Object.assign({ "User-Agent": "TRMNL-ICS-Calendar" }, cal.headers);
      const resp = await fetchWithTimeout(url, Math.min(budget, 4000), { headers });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return { calIdx, url: cal.url, text: await resp.text(), ok: true };
    } catch (exc) {
      errors.push(String((exc && exc.message) || exc));
      return { calIdx, url: cal.url, text: null, ok: false };
    }
  });

  const localeCode = localeCodeOf(locale);
  const shouldFetchWeatherI18n = WEATHER_I18N_LOCALES.includes(localeCode);

  const [calendarResults, sky, rssResult, weatherI18nFetched] = await Promise.all([
    Promise.all(calendarFetches),
    fetchSky(location, daysN, fahrenheit, deadline),
    fetchRssHeadline(rssUrl, rssLabel, deadline),
    shouldFetchWeatherI18n ? fetchWeatherI18n(localeCode, deadline) : Promise.resolve(null),
  ]);
  let rssHeadline = rssResult;

  let weatherI18n = WEATHER_TEXT_FALLBACK;
  let weatherI18nState = null;
  if (shouldFetchWeatherI18n) {
    if (weatherI18nFetched) {
      weatherI18nState = { code: localeCode, data: weatherI18nFetched };
    } else if (prevState.weatherI18n && prevState.weatherI18n.code === localeCode) {
      weatherI18nState = prevState.weatherI18n;
    }
    if (weatherI18nState) weatherI18n = weatherI18nState.data;
  }

  const occ = [];
  for (const r of calendarResults) {
    if (r.text !== null) collectIcs(r.text, tz, winSEpoch, winEEpoch, occ, r.calIdx);
  }

  let err = null;
  if (errors.length && !occ.length) err = "Fetch/parse failed: " + errors[0];

  const calendarNames = {};
  const seenNames = new Set();
  calendars.forEach((cal, i) => {
    if (!cal.name) {
      const r = calendarResults[i];
      const fetched = r && r.ok ? extractCalName(r.text) : null;
      cal.name = fetched || prevCalendarNames[r.url] || "Calendar " + (i + 1);
    }
    let unique = cal.name;
    let dupe = 2;
    while (seenNames.has(unique.toLowerCase())) {
      unique = cal.name + " (" + dupe + ")";
      dupe++;
    }
    seenNames.add(unique.toLowerCase());
    cal.name = unique;
    calendarNames[calendarResults[i].url] = unique;
  });

  const calendarDown = {};
  const calendarAlerts = [];
  for (const r of calendarResults) {
    if (r.ok) continue;
    const downSince = prevCalendarDown[r.url] || nowEpoch;
    calendarDown[r.url] = downSince;
    if (nowEpoch - downSince >= CALENDAR_DOWN_THRESHOLD_MS) {
      calendarAlerts.push(calendars[r.calIdx].name);
    }
  }

  const prevWeatherFetchedAt = typeof prevState.weatherFetchedAt === "number" ? prevState.weatherFetchedAt : null;
  let weatherFetchedAt = nowEpoch;
  let weatherStale = false;
  if (sky.error && prevState.weather) {
    sky.sunMarks = prevState.weather.sunMarks;
    sky.hourlyWeather = prevState.weather.hourlyWeather;
    sky.dailyTemps = prevState.weather.dailyTemps;
    weatherFetchedAt = prevWeatherFetchedAt || nowEpoch;
    weatherStale = !!prevWeatherFetchedAt && nowEpoch - prevWeatherFetchedAt >= WEATHER_STALE_THRESHOLD_MS;
  }

  if (rssUrl && !rssHeadline && prevState.news) rssHeadline = prevState.news;

  const filtered = [];
  for (const e of occ) {
    const cal = calendars[e.calIdx];
    const startWeekday = fromEpoch(e.startEpoch, tz).wd;
    const r = applyCalendarRules(e.title, e.desc, e.status, startWeekday, cal, people, globalRules, everyonePerson);
    if (r.hide) continue;
    e.title = r.title;
    e.hueOverride = r.hue;
    e.personBadges = r.badges;
    if (r.allDay) e.allDay = true;
    filtered.push(e);
  }

  const dayBounds = [];
  const rawDays = [];
  for (let i = 0; i < daysN; i++) {
    const d0Civil = addCivilDays({ ...winSCivil, h: 0, mi: 0, s: 0 }, i);
    const d0Epoch = zonedTimeToUtc(d0Civil.y, d0Civil.mo, d0Civil.d, 0, 0, 0, tz);
    const d1Civil = addCivilDays(d0Civil, 1);
    const d1Epoch = zonedTimeToUtc(d1Civil.y, d1Civil.mo, d1Civil.d, 0, 0, 0, tz);
    dayBounds.push({ d0Epoch, d1Epoch });

    const timed = [];
    for (const e of filtered) {
      if (e.allDay || e.endEpoch - e.startEpoch >= 86400000) continue;
      if (!(e.startEpoch < d1Epoch && e.endEpoch > d0Epoch)) continue;
      const vs = Math.max(e.startEpoch, d0Epoch);
      const ve = Math.min(e.endEpoch, d1Epoch);
      timed.push({
        h0: (vs - d0Epoch) / 3600000,
        h1: (ve - d0Epoch) / 3600000,
        title: e.title,
        calIdx: e.calIdx,
        hueOverride: e.hueOverride,
        personBadges: e.personBadges,
        label: fmtTime(vs, tz, is12h) + "-" + fmtTime(ve, tz, is12h),
      });
    }
    timed.sort((a, b) => a.h0 - b.h0);
    rawDays.push({
      label: dayLabel(d0Civil, locale),
      labelShort: dayLabelShort(d0Civil, locale),
      labelShortWeekday: dayLabelShortParts(d0Civil, locale).weekday,
      labelShortRest: dayLabelShortParts(d0Civil, locale).rest,
      isToday: i === 0,
      timed,
    });
  }

  const alldaySpans = [];
  for (const e of filtered) {
    if (!(e.allDay || e.endEpoch - e.startEpoch >= 86400000)) continue;
    let startCol = -1, endCol = -1;
    for (let i = 0; i < daysN; i++) {
      if (e.startEpoch < dayBounds[i].d1Epoch && e.endEpoch > dayBounds[i].d0Epoch) {
        if (startCol === -1) startCol = i;
        endCol = i;
      }
    }
    if (startCol === -1) continue;
    alldaySpans.push({
      e, startCol, span: endCol - startCol + 1,
      continuesBefore: e.startEpoch < dayBounds[startCol].d0Epoch,
      continuesAfter: e.endEpoch > dayBounds[endCol].d1Epoch,
    });
  }
  alldaySpans.sort((a, b) => a.startCol - b.startCol || b.span - a.span);
  const rowEnds = [];
  for (const s of alldaySpans) {
    const endCol = s.startCol + s.span - 1;
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] >= s.startCol) row++;
    s.row = row;
    rowEnds[row] = endCol;
  }
  const neededRows = rowEnds.length;
  const visibleCap = neededRows <= 3 ? 3 : 2;
  if (neededRows > visibleCap) {
    const overflowCount = new Array(daysN).fill(0);
    for (const s of alldaySpans) {
      if (s.row < visibleCap) continue;
      for (let d = s.startCol; d <= s.startCol + s.span - 1 && d < daysN; d++) overflowCount[d]++;
    }
    for (let d = 0; d < daysN; d++) {
      if (!overflowCount[d]) continue;
      alldaySpans.push({
        e: { title: "+" + overflowCount[d] + " more", hueOverride: null, calIdx: -1, personBadges: null },
        startCol: d, span: 1, row: visibleCap,
        continuesBefore: false, continuesAfter: false, isOverflow: true,
      });
    }
  }
  let alldayBars = alldaySpans.filter((s) => s.row < visibleCap || s.isOverflow).map((s) => ({
    title: s.e.title,
    hue: s.isOverflow ? "gray-30" : (s.e.hueOverride || hueOf(s.e.calIdx, calendarColors)),
    personBadges: s.e.personBadges,
    startCol: s.startCol,
    span: s.span,
    row: s.row,
    continuesBefore: s.continuesBefore,
    continuesAfter: s.continuesAfter,
  }));
  alldayBars.sort((a, b) => a.row - b.row || a.startCol - b.startCol);
  const mergedAlldayBars = [];
  for (const bar of alldayBars) {
    const prev = mergedAlldayBars[mergedAlldayBars.length - 1];
    if (
      prev && prev.row === bar.row && prev.startCol + prev.span === bar.startCol &&
      prev.title === bar.title && prev.hue === bar.hue &&
      JSON.stringify(prev.personBadges) === JSON.stringify(bar.personBadges)
    ) {
      prev.span += bar.span;
      prev.continuesAfter = bar.continuesAfter;
    } else {
      mergedAlldayBars.push(Object.assign({}, bar));
    }
  }
  alldayBars = mergedAlldayBars;

  const nowH = (nowEpoch - winSEpoch) / 3600000;
  const newsPct = rssHeadline ? NEWS_PCT : 0;
  rawDays.forEach((rd, i) => {
    rd.temp = sky.dailyTemps[i] || null;
    rd.icon = rd.temp ? dayIcon(sky.hourlyWeather[i]) : null;
  });

  const daySun = sky.sunMarks[0] || [];
  const sunriseMark = daySun.find((m) => m.kind === "sunrise");
  const sunsetMark = daySun.find((m) => m.kind === "sunset");
  const eventStarts = [];
  const eventEnds = [];
  for (const d of rawDays) {
    for (const e of d.timed) {
      eventStarts.push(e.h0);
      eventEnds.push(e.h1);
    }
  }
  const defaultHours = parseHours(cf(input, "hours")) || DEFAULT_HOURS;
  const coreStartCandidates = [defaultHours.start, sunriseMark ? sunriseMark.hour : null, ...eventStarts].filter((h) => h !== null && h !== undefined);
  const coreEndCandidates = [defaultHours.end, sunsetMark ? sunsetMark.hour : null, ...eventEnds].filter((h) => h !== null && h !== undefined);
  const coreStartH = Math.floor(Math.min(...coreStartCandidates));
  let coreEndH = Math.ceil(Math.max(...coreEndCandidates));
  coreEndH = Math.max(coreEndH, coreStartH + 1);
  const startH = nowH !== null && nowH !== undefined ? Math.min(coreStartH, Math.floor(nowH)) : coreStartH;
  let endH = nowH !== null && nowH !== undefined ? Math.max(coreEndH, Math.ceil(nowH) + 1) : coreEndH;
  endH = Math.max(endH, startH + 1);

  const alertsPct = calendarAlerts.length ? ALERTS_ROW_PCT : 0;
  const grid = layoutNative(rawDays, alldayBars, startH, endH, coreStartH, coreEndH, nowH, sky.sunMarks, sky.hourlyWeather, calendarColors, HEADER_PCT, is12h, newsPct, alertsPct, weatherI18n);

  // The single-day views (half_horizontal/half_vertical/quadrant) show only rawDays[0], rendered
  // as a plain time+title list rather than a timeline grid — a grid this small is more cramped
  // than useful. All-day items touching today come first (also still shown in the all-day bar
  // header above, for every view — this is deliberately in addition, not instead), then every
  // timed event still relevant from now on (already-ended ones are dropped; one in progress right
  // now is kept and flagged `current` so the template can call it out). How many of these
  // actually fit — and the "and N more" indicator for the rest — is handled by TRMNL's own
  // overflow engine in the template (data-overflow/data-overflow-counter), which measures real
  // rendered space at runtime; AGENDA_SANITY_CAP here is just a hard ceiling against a
  // pathological day's payload size, not a display cap.
  const day0 = rawDays[0];
  const day0AlldayBars = alldayBars.filter((b) => b.startCol === 0);
  const nowIsKnown = nowH !== null && nowH !== undefined;
  const agendaAllDay = day0AlldayBars.map((b) => ({
    time: null, all_day: true, title: b.title,
    hue: colorClass(b.hue), fg: foregroundFor(b.hue), current: false,
    badges: b.personBadges || [],
  }));
  const agendaTimed = day0.timed
    .filter((e) => !nowIsKnown || e.h1 > nowH)
    .map((e) => {
      const color = e.hueOverride || hueOf(e.calIdx, calendarColors);
      return {
        sortH: e.h0,
        item: {
          time: e.label, title: e.title,
          hue: colorClass(color), fg: foregroundFor(color),
          current: nowIsKnown && e.h0 <= nowH && e.h1 > nowH,
          badges: e.personBadges || [],
        },
      };
    });
  const agendaWeather = weatherTransitions((sky.hourlyWeather || {})[0])
    .filter((m) => !nowIsKnown || m.h >= nowH)
    .map((m) => {
      const timeLabel = fmtTime(dayBounds[0].d0Epoch + m.h * 3600000, tz, is12h);
      return { sortH: m.h, item: weatherMarkerItem(m.kind, m.starting, timeLabel, weatherI18n) };
    });
  const agendaItems = agendaAllDay.concat(
    agendaTimed.concat(agendaWeather).sort((a, b) => a.sortH - b.sortH).map((x) => x.item)
  ).slice(0, AGENDA_SANITY_CAP);

  const viewPeopleSeen = new Set();
  const viewPeople = [];
  for (const b of [...alldayBars.flatMap((a) => a.personBadges || []), ...rawDays.flatMap((d) => d.timed.flatMap((t) => t.personBadges || []))]) {
    if (!b.person || viewPeopleSeen.has(b.person)) continue;
    viewPeopleSeen.add(b.person);
    viewPeople.push({ text: b.text, person: b.person, hue: b.hue, fg: b.fg, is_everyone: b.is_everyone });
  }

  const data = Object.assign({}, grid, {
    single_day: { agenda: agendaItems },
    full_view_grid: fullViewGrid,
    people: viewPeople,
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: err,
    unavailable_label: unavailableText(locale),
    all_day_label: allDayText(locale),
    nothing_scheduled_label: nothingScheduledText(locale),
    has_events: alldayBars.length > 0 || rawDays.some((d) => d.timed.length),
    weather_error: sky.error,
    weather_stale: weatherStale,
    temp_unit: fahrenheit ? "F" : "C",
    rss_headline: rssHeadline,
    calendar_alerts: calendarAlerts,
  });
  const trmnl_state = {
    weather: { sunMarks: sky.sunMarks, hourlyWeather: sky.hourlyWeather, dailyTemps: sky.dailyTemps },
    weatherFetchedAt,
    weatherI18n: weatherI18nState,
    news: rssHeadline || null,
    calendarDown,
    calendarNames,
  };
  return { data, trmnl_state };
}

function cf(input, key) {
  if (!input || typeof input !== "object") return "";
  if (typeof input[key] === "string") return input[key];
  try {
    const v = input.trmnl.plugin_settings.custom_fields_values[key];
    return typeof v === "string" ? v : "";
  } catch (e) {
    return "";
  }
}

function toInt(raw, def, lo, hi) {
  const f = parseFloat(String(raw).trim());
  if (!isFinite(f)) return def;
  return Math.max(lo, Math.min(hi, Math.trunc(f)));
}

function parseHours(raw) {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(raw || ""));
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (!(start >= 0 && start < end && end <= 24)) return null;
  return { start, end };
}

function emptyResult(tzname, tz, locale, daysN, is12h, msg) {
  const nowEpoch = Date.now();
  const nowCivil = fromEpoch(nowEpoch, tz);
  const winSCivil = { y: nowCivil.y, mo: nowCivil.mo, d: nowCivil.d, h: 0, mi: 0, s: 0 };
  const days = [];
  for (let i = 0; i < daysN; i++) {
    const d0Civil = addCivilDays(winSCivil, i);
    days.push({
      label: dayLabel(d0Civil, locale),
      labelShort: dayLabelShort(d0Civil, locale),
      labelShortWeekday: dayLabelShortParts(d0Civil, locale).weekday,
      labelShortRest: dayLabelShortParts(d0Civil, locale).rest,
      isToday: i === 0,
      timed: [],
    });
  }
  const grid = layoutNative(days, [], 8, 22, null, null, null, null, HEADER_PCT, is12h);
  const data = Object.assign({}, grid, {
    single_day: { agenda: [] },
    full_view_grid: false,
    people: [],
    generated_at: Math.floor(nowEpoch / 1000),
    tz: tzname,
    error: msg,
    unavailable_label: unavailableText(locale),
    all_day_label: allDayText(locale),
    nothing_scheduled_label: nothingScheduledText(locale),
    has_events: false,
    weather_error: null,
    weather_stale: false,
    temp_unit: "C",
    rss_headline: null,
    calendar_alerts: [],
  });
  return { data };
}

function compileRule(spec) {
  if (!spec || typeof spec !== "object") return null;
  const m = compileMatcher(spec.match);
  if (!m) return null;
  const person = normalizeNameList(spec.person);
  const allDay = spec.allDay === true;
  const hide = spec.hide === true;
  const rewrite = typeof spec.rewrite === "string" ? spec.rewrite : null;
  const rewriteFull = spec.rewriteFull === true;
  if (!person && !allDay && !hide && rewrite === null) return null;
  const isAnyMatch = spec.match && (spec.match.type === "any" || spec.match.type === "all");
  const rename = person ? (isAnyMatch ? spec.rename === true : spec.rename !== false) : false;
  return { match: m.test, rx: m.rx, person, allDay, hide, rename, rewrite, rewriteFull };
}

function compileRuleList(raw) {
  const rules = [];
  for (const spec of Array.isArray(raw) ? raw : []) {
    const compiled = compileRule(spec);
    if (compiled) rules.push(compiled);
  }
  return rules;
}

function parseConfig(raw, extraUrls) {
  let data = null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = { calendars: raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) };
    }
  }
  if (!data || typeof data !== "object") data = {};

  const locale = typeof data.locale === "string" && data.locale.trim() ? data.locale.trim() : null;

  const timeZone = typeof data.timeZone === "string" && data.timeZone.trim() ? data.timeZone.trim() : null;

  const people = {};
  let everyonePerson = null;
  for (const item of Array.isArray(data.people) ? data.people : []) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : "";
    const badgeSrc = typeof item.badge === "string" && item.badge.trim() ? item.badge.trim() : name;
    const badge = Array.from(badgeSrc)[0].toUpperCase();
    if (everyonePerson === null) everyonePerson = name;
    people[name.toLowerCase()] = { name, color, badge };
  }

  const globalRules = compileRuleList(data.rules);

  const rawCalendars = (extraUrls || []).concat(Array.isArray(data.calendars) ? data.calendars : []);
  const calendars = [];
  for (const raw_item of rawCalendars) {
    const item = typeof raw_item === "string" ? { url: raw_item } : raw_item;
    if (!item || typeof item !== "object" || typeof item.url !== "string" || !item.url.trim()) continue;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
    const color = typeof item.color === "string" && isValidColor(item.color.toLowerCase()) ? item.color.toLowerCase() : null;
    const rules = compileRuleList(item.rules);
    const headers = {};
    if (item.headers && typeof item.headers === "object") {
      for (const k of Object.keys(item.headers)) {
        if (typeof item.headers[k] === "string") headers[k] = item.headers[k];
      }
    }

    calendars.push({ name, url: item.url.trim(), color, rules, headers });
  }

  return { calendars, people, locale, timeZone, globalRules, everyonePerson };
}

function normalizeNameList(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const names = list.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim());
  return names.length ? names : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileMatcher(spec) {
  if (!spec || typeof spec !== "object") return null;
  if (spec.type === "any" || spec.type === "all") {
    return { rx: /[\s\S]*/i, test: () => true };
  }
  if (spec.type === "and" || spec.type === "or") {
    const subs = (Array.isArray(spec.matchers) ? spec.matchers : []).map(compileMatcher).filter(Boolean);
    if (!subs.length) return null;
    const isAnd = spec.type === "and";
    return { rx: null, test: (ctx) => (isAnd ? subs.every((m) => m.test(ctx)) : subs.some((m) => m.test(ctx))) };
  }
  if (spec.type === "status") {
    const want = typeof spec.value === "string" ? spec.value.trim().toUpperCase() : "";
    if (!want) return null;
    return { rx: null, test: (ctx) => ctx.status === want };
  }
  if (spec.type === "weekday") {
    const raw = Array.isArray(spec.value) ? spec.value : [spec.value];
    const wanted = new Set();
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const code = v.trim().toUpperCase().slice(0, 2);
      if (code in WD_MAP) wanted.add(WD_MAP[code]);
    }
    if (!wanted.size) return null;
    return { rx: null, test: (ctx) => ctx.weekday !== null && wanted.has(ctx.weekday) };
  }
  if (typeof spec.value !== "string") return null;
  const p = spec.value.trim();
  if (!p) return null;
  let rx;
  if (spec.type === "regex") {
    try {
      rx = new RegExp(p, "i");
    } catch (e) {
      return null;
    }
  } else if (spec.type === "contains") {
    rx = new RegExp(escapeRegExp(p), "i");
  } else if (spec.type === "exact") {
    rx = new RegExp("^" + escapeRegExp(p) + "$", "i");
  } else {
    rx = new RegExp("\\b" + escapeRegExp(p) + "\\b", "i");
  }
  return { rx, test: (ctx) => rx.test(ctx.title) || (!!ctx.desc && rx.test(ctx.desc)) };
}

function replaceMatch(text, rx, replacement) {
  if (rx.test("")) return text.replace(new RegExp(rx.source, rx.flags.replace("g", "")), replacement);
  return text.replace(new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g"), replacement);
}

function applyCalendarRules(title, desc, status, weekday, cal, people, globalRules, everyonePerson) {
  const originalTitle = title;
  const ctx = { title: originalTitle, desc: desc || "", status: status || "", weekday: weekday === undefined || weekday === null ? null : weekday };
  let personNames = null;
  let renameRule = null;
  let rewriteRule = null;
  let allDay = false;
  let hide = false;
  for (const rule of globalRules.concat(cal.rules)) {
    if (!rule.match(ctx)) continue;
    if (rule.hide) hide = true;
    if (rule.allDay) allDay = true;
    if (rule.person) {
      personNames = rule.person;
      renameRule = rule.rename ? rule : null;
    }
    if (rule.rewrite !== null) rewriteRule = rule;
  }
  if (rewriteRule) {
    title = rewriteRule.rewriteFull
      ? rewriteRule.rewrite
      : rewriteRule.rx
      ? replaceMatch(originalTitle, rewriteRule.rx, rewriteRule.rewrite)
      : originalTitle;
  } else if (renameRule && renameRule.rx) {
    title = replaceMatch(originalTitle, renameRule.rx, renameRule.person.join(" & "));
  }
  if (personNames === null && everyonePerson) personNames = [everyonePerson];

  let hue = null;
  const badges = [];
  if (personNames) {
    for (const personName of personNames) {
      const p = people[personName.toLowerCase()];
      if (!p) continue;
      if (hue === null && p.color) hue = p.color;
      const badgeHue = p.color ? colorClass(p.color) : "gray-30";
      const badgeFg = p.color ? foregroundFor(p.color) : "white";
      badges.push({ text: p.badge, person: p.name, hue: badgeHue, fg: badgeFg, is_everyone: p.name === everyonePerson });
    }
  }
  return { title, hue, badges, allDay, hide };
}

function localeOf(input) {
  try {
    const loc = input.trmnl.user.locale;
    if (typeof loc === "string" && loc.trim()) return loc.trim();
  } catch (e) {}
  return "en";
}

function localeCodeOf(locale) {
  return String(locale).toLowerCase().split(/[-_]/)[0];
}

function uiText(locale) {
  return UI_TEXT[localeCodeOf(locale)] || UI_TEXT.en;
}

function unavailableText(locale) {
  return uiText(locale).unavailable;
}

function allDayText(locale) {
  return uiText(locale).all_day;
}

function nothingScheduledText(locale) {
  return uiText(locale).nothing_scheduled;
}

function userTz(input) {
  try {
    const tz = input.trmnl.user.time_zone_iana;
    return typeof tz === "string" && tz.trim() ? tz.trim() : null;
  } catch (e) {
    return null;
  }
}

function userUtcOffsetMinutes(input) {
  try {
    const s = input.trmnl.user.utc_offset;
    const n = Number(s);
    return isFinite(n) ? n / 60 : null;
  } catch (e) {
    return null;
  }
}

function resolveTz(tzname, input) {
  const tz = tzname ? safeZone(tzname) : null;
  if (tz) return tz;
  const offsetMin = userUtcOffsetMinutes(input);
  if (offsetMin !== null) return offsetMin;
  return 0;
}

function safeZone(name) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch (e) {
    return null;
  }
}

const _offsetFmtCache = new Map();
function offsetFormatter(tz) {
  let f = _offsetFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit", timeZoneName: "longOffset" });
    _offsetFmtCache.set(tz, f);
  }
  return f;
}

function getOffsetMinutes(epochMs, tz) {
  if (typeof tz === "number") return tz;
  if (!isFinite(epochMs)) return 0;
  const parts = offsetFormatter(tz).formatToParts(new Date(epochMs));
  const part = parts.find((p) => p.type === "timeZoneName");
  const v = part ? part.value : "GMT";
  if (v === "GMT" || v === "UTC") return 0;
  let m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(v);
  if (m) return (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  m = /GMT([+-])(\d{1,2})$/.exec(v);
  if (m) return (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10) * 60;
  return 0;
}

const _civilFmtCache = new Map();
function civilFormatter(tz) {
  let f = _civilFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    _civilFmtCache.set(tz, f);
  }
  return f;
}

function fromEpoch(epochMs, tz) {
  if (typeof tz === "number") {
    const d = new Date(epochMs + tz * 60000);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
      wd: (d.getUTCDay() + 6) % 7,
    };
  }
  if (!isFinite(epochMs)) epochMs = 0;
  const parts = {};
  for (const p of civilFormatter(tz).formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  const y = +parts.year, mo = +parts.month, d = +parts.day;
  let h = +parts.hour;
  if (h === 24) h = 0;
  return { y, mo, d, h, mi: +parts.minute, s: +parts.second, wd: civilWeekday(y, mo, d) };
}

function zonedTimeToUtc(y, mo, d, h, mi, s, tz) {
  if (typeof tz === "number") return Date.UTC(y, mo - 1, d, h, mi, s) - tz * 60000;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = getOffsetMinutes(guess, tz);
  const t1 = guess - off1 * 60000;
  const off2 = getOffsetMinutes(t1, tz);
  return guess - off2 * 60000;
}

function civilWeekday(y, mo, d) {
  return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
}

function civilDateOrdinal(y, mo, d) {
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

function ordinalToYmd(ordinal) {
  const dt = new Date(ordinal * 86400000);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function addCivilDays(civil, n) {
  const dt = new Date(Date.UTC(civil.y, civil.mo - 1, civil.d + n, civil.h, civil.mi, civil.s));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds() };
}

function isLeap(y) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function addMonths(civil, n) {
  const mTotal = civil.mo - 1 + n;
  const y = civil.y + Math.floor(mTotal / 12);
  const m = ((mTotal % 12) + 12) % 12;
  const maxDay = m === 1 ? (isLeap(y) ? 29 : 28) : MONTH_DAYS[m];
  return { y, mo: m + 1, d: Math.min(civil.d, maxDay), h: civil.h, mi: civil.mi, s: civil.s };
}

function daysInMonth(y, mo) {
  return mo === 2 ? (isLeap(y) ? 29 : 28) : MONTH_DAYS[mo - 1];
}

function nthWeekdayOfMonth(y, mo, wd, n) {
  const maxDay = daysInMonth(y, mo);
  if (n > 0) {
    const firstWd = civilWeekday(y, mo, 1);
    const d = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7;
    return d <= maxDay ? d : null;
  }
  const lastWd = civilWeekday(y, mo, maxDay);
  const d = maxDay - ((lastWd - wd + 7) % 7) - (-n - 1) * 7;
  return d >= 1 ? d : null;
}

function retargetDay(civil, byMonthDay, byDayNth, byDayNthWd) {
  if (byDayNth !== null) {
    const d = nthWeekdayOfMonth(civil.y, civil.mo, byDayNthWd, byDayNth);
    return d === null ? null : Object.assign({}, civil, { d });
  }
  if (byMonthDay !== null) {
    const maxDay = daysInMonth(civil.y, civil.mo);
    const d = byMonthDay > 0 ? byMonthDay : maxDay + byMonthDay + 1;
    return d >= 1 && d <= maxDay ? Object.assign({}, civil, { d }) : null;
  }
  return civil;
}

function advanceNthDayMonth(civil, monthStep, byMonthDay, byDayNth, byDayNthWd) {
  let next = addMonths(civil, monthStep);
  if (byMonthDay === null && byDayNth === null) return next;
  for (let tries = 0; tries < 60; tries++) {
    const adj = retargetDay(next, byMonthDay, byDayNth, byDayNthWd);
    if (adj !== null) return adj;
    next = addMonths(next, monthStep);
  }
  return next;
}

// Weekday/month names are handled entirely by Intl (localeDatePart, below) — no translation
// file needed there. The only strings that get fetched are the weather condition messages
// ("Rain starts", "Fog stops", ...): those are new copy introduced for the agenda-list weather
// markers and have no Intl equivalent, so i18n/{code}.json on GitHub holds them for each
// non-English locale and fetchWeatherI18n() below pulls the one matching the viewer's locale at
// render time. English is excluded here (WEATHER_TEXT_FALLBACK below already *is* the English
// copy) so an English viewer never pays for a fetch that would only echo back what's already
// inline.
const WEATHER_I18N_LOCALES = ["nl", "fr", "de", "es"];
const WEATHER_I18N_BASE_URL = "https://raw.githubusercontent.com/ExcuseMi/trmnl-family-calendar/main/i18n/";
const WEATHER_TEXT_FALLBACK = {
  rain_starts: "Rain starts", rain_stops: "Rain stops",
  storm_starts: "Storm starts", storm_stops: "Storm stops",
  snow_starts: "Snow starts", snow_stops: "Snow stops",
  fog_starts: "Fog starts", fog_stops: "Fog stops",
};

async function fetchWeatherI18n(code, deadline) {
  try {
    const budget = msUntil(deadline);
    if (budget <= 0) throw new Error("timed out");
    const resp = await fetchWithTimeout(WEATHER_I18N_BASE_URL + code + ".json", Math.min(budget, 3000), {});
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const json = await resp.json();
    if (!json || typeof json.rain_starts !== "string" || typeof json.rain_stops !== "string") {
      throw new Error("malformed i18n payload");
    }
    return json;
  } catch (e) {
    return null;
  }
}

// Short static UI chrome text — kept inline (not fetched) since it must always render even if
// GitHub is unreachable and there's no cached copy yet (e.g. the plugin's very first run).
const UI_TEXT = {
  en: { unavailable: "Calendar unavailable", all_day: "All day", nothing_scheduled: "Nothing scheduled" },
  nl: { unavailable: "Kalender niet beschikbaar", all_day: "Hele dag", nothing_scheduled: "Niets gepland" },
  fr: { unavailable: "Agenda indisponible", all_day: "Journée", nothing_scheduled: "Rien de prévu" },
  de: { unavailable: "Kalender nicht verfügbar", all_day: "Ganztägig", nothing_scheduled: "Nichts geplant" },
  es: { unavailable: "Calendario no disponible", all_day: "Todo el día", nothing_scheduled: "Nada programado" },
};

const _weekdayFmtCache = new Map();
const _monthFmtCache = new Map();

function localeDatePart(locale, width, kind, y, mo, d) {
  const cacheKey = locale + "|" + width;
  const cache = kind === "weekday" ? _weekdayFmtCache : _monthFmtCache;
  let fmt = cache.get(cacheKey);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat(locale, { [kind]: width, timeZone: "UTC" });
    } catch (e) {
      fmt = new Intl.DateTimeFormat("en", { [kind]: width, timeZone: "UTC" });
    }
    cache.set(cacheKey, fmt);
  }
  const raw = fmt.format(new Date(Date.UTC(y, mo - 1, d))).replace(/\.$/, "");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function dayLabel(civil, locale) {
  const wd = localeDatePart(locale, "short", "weekday", civil.y, civil.mo, civil.d);
  const month = localeDatePart(locale, "long", "month", civil.y, civil.mo, civil.d);
  return wd + " " + civil.d + " " + month;
}

function dayLabelShortParts(civil, locale) {
  const wd = localeDatePart(locale, "short", "weekday", civil.y, civil.mo, civil.d);
  const month = localeDatePart(locale, "short", "month", civil.y, civil.mo, civil.d);
  return { weekday: wd, rest: civil.d + " " + month };
}

function dayLabelShort(civil, locale) {
  const p = dayLabelShortParts(civil, locale);
  return p.weekday + " " + p.rest;
}

function fmtTime(epoch, tz, is12h) {
  const c = fromEpoch(epoch, tz);
  const mi = String(c.mi).padStart(2, "0");
  if (is12h) {
    const h = c.h % 12 || 12;
    return h + ":" + mi + " " + (c.h < 12 ? "AM" : "PM");
  }
  return c.h + ":" + mi;
}

function unfold(text) {
  const lines = [];
  for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if ((raw[0] === " " || raw[0] === "\t") && lines.length) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

function prop(line) {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const parts = head.split(";");
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq !== -1) {
      params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"+|"+$/g, "");
    }
  }
  return [parts[0].toUpperCase(), params, value];
}

function untext(v) {
  return v.replace(/\\n/g, "\n").replace(/\\N/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function extractCalName(text) {
  for (const line of unfold(text || "")) {
    const parsed = prop(line);
    if (parsed && parsed[0] === "X-WR-CALNAME") {
      const name = untext(parsed[2]);
      if (name) return name;
    }
  }
  return null;
}

function parseDt(value, params, tz) {
  const v = value.trim();
  if (params.VALUE === "DATE" || (v.length === 8 && !v.includes("T"))) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    if (!(isFinite(y) && isFinite(mo) && isFinite(d))) return null;
    return { epoch: zonedTimeToUtc(y, mo, d, 0, 0, 0, tz), allDay: true, civil: { y, mo, d, h: 0, mi: 0, s: 0 }, zone: tz };
  }
  if (v.endsWith("Z")) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8),
          h = +v.slice(9, 11), mi = +v.slice(11, 13), s = +v.slice(13, 15);
    if (!(isFinite(y) && isFinite(mo) && isFinite(d) && isFinite(h) && isFinite(mi) && isFinite(s))) return null;
    return { epoch: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false, civil: { y, mo, d, h, mi, s }, zone: 0 };
  }
  const v15 = v.slice(0, 15);
  const y = +v15.slice(0, 4), mo = +v15.slice(4, 6), d = +v15.slice(6, 8),
        h = +v15.slice(9, 11), mi = +v15.slice(11, 13), s = +v15.slice(13, 15);
  if (!(isFinite(y) && isFinite(mo) && isFinite(d) && isFinite(h) && isFinite(mi) && isFinite(s))) return null;
  const z = safeZone(params.TZID || "") || tz;
  return { epoch: zonedTimeToUtc(y, mo, d, h, mi, s, z), allDay: false, civil: { y, mo, d, h, mi, s }, zone: z };
}

function collectIcs(text, tz, winS, winE, out, calIdx) {
  let inEv = false;
  let ev = null;
  const events = [];
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      inEv = true;
      ev = {};
      continue;
    }
    if (line === "END:VEVENT") {
      inEv = false;
      if (ev) events.push(ev);
      continue;
    }
    if (!inEv) continue;
    const parsed = prop(line);
    if (!parsed) continue;
    const [name, params, value] = parsed;
    if (name === "DTSTART") {
      ev.start = parseDt(value, params, tz);
    } else if (name === "DTEND") {
      ev.end = parseDt(value, params, tz);
    } else if (name === "SUMMARY") {
      ev.title = untext(value);
    } else if (name === "DESCRIPTION") {
      ev.desc = untext(value);
    } else if (name === "STATUS") {
      ev.status = value.trim().toUpperCase();
    } else if (name === "RRULE") {
      ev.rrule = parseRrule(value, tz);
    } else if (name === "EXDATE") {
      ev.exdate = ev.exdate || new Set();
      for (const part of value.split(",")) {
        try {
          const p = parseDt(part, params, tz);
          ev.exdate.add(Math.floor(p.epoch / 1000));
        } catch (e) {}
      }
    } else if (name === "UID") {
      ev.uid = value.trim();
    } else if (name === "RECURRENCE-ID") {
      try {
        ev.recurrenceId = parseDt(value, params, tz);
      } catch (e) {}
    }
  }

  const overrideEpochsByUid = new Map();
  for (const e of events) {
    if (!e.uid || !e.recurrenceId) continue;
    if (!overrideEpochsByUid.has(e.uid)) overrideEpochsByUid.set(e.uid, new Set());
    overrideEpochsByUid.get(e.uid).add(Math.floor(e.recurrenceId.epoch / 1000));
  }

  for (const e of events) {
    if (e.uid && !e.recurrenceId && overrideEpochsByUid.has(e.uid)) {
      e.exdate = e.exdate || new Set();
      for (const epoch of overrideEpochsByUid.get(e.uid)) e.exdate.add(epoch);
    }
    e.calIdx = calIdx;
    expandEvent(e, tz, winS, winE, out);
  }
}

function parseRrule(value, tz) {
  const rr = {};
  for (const token of value.split(";")) {
    const eq = token.indexOf("=");
    if (eq !== -1) rr[token.slice(0, eq).toUpperCase()] = token.slice(eq + 1);
  }
  if (rr.UNTIL) {
    const u = rr.UNTIL;
    try {
      if (u.endsWith("Z")) {
        const y = +u.slice(0, 4), mo = +u.slice(4, 6), d = +u.slice(6, 8),
              h = +u.slice(9, 11), mi = +u.slice(11, 13), s = +u.slice(13, 15);
        rr._until = Date.UTC(y, mo - 1, d, h, mi, s);
      } else if (u.includes("T")) {
        const u15 = u.slice(0, 15);
        const y = +u15.slice(0, 4), mo = +u15.slice(4, 6), d = +u15.slice(6, 8),
              h = +u15.slice(9, 11), mi = +u15.slice(11, 13), s = +u15.slice(13, 15);
        rr._until = zonedTimeToUtc(y, mo, d, h, mi, s, tz);
      } else {
        const y = +u.slice(0, 4), mo = +u.slice(4, 6), d = +u.slice(6, 8);
        rr._until = zonedTimeToUtc(y, mo, d, 0, 0, 0, tz);
      }
    } catch (e) {
      rr._until = null;
    }
  }
  return rr;
}

function expandEvent(ev, tz, winS, winE, out) {
  const start = ev.start;
  if (!start) return;
  const allDay = !!start.allDay;
  const end = ev.end || { epoch: start.epoch + (allDay ? 86400000 : 3600000) };
  const dur = end.epoch - start.epoch;
  const title = ev.title !== undefined ? ev.title : "(no title)";
  const desc = ev.desc || "";
  const status = ev.status || "";
  const exdate = ev.exdate || new Set();
  const rr = ev.rrule;
  const calIdx = ev.calIdx || 0;

  function emit(curEpoch) {
    if (exdate.has(Math.floor(curEpoch / 1000))) return;
    const e = curEpoch + dur;
    if (curEpoch < winE && e > winS) {
      out.push({ startEpoch: curEpoch, endEpoch: e, allDay, title, desc, status, calIdx });
    }
  }

  if (!rr || !rr.FREQ) {
    emit(start.epoch);
    return;
  }

  const freq = rr.FREQ;
  const interval = Math.max(1, parseInt(rr.INTERVAL || "1", 10) || 1);
  const count = rr.COUNT ? parseInt(rr.COUNT, 10) : null;
  const until = rr._until != null ? rr._until : null;
  let byday = null;
  if (rr.BYDAY) {
    byday = rr.BYDAY.split(",").map((tok) => tok.slice(-2)).filter((code) => code in WD_MAP).map((code) => WD_MAP[code]).sort((a, b) => a - b);
  }

  let byMonthDay = null;
  if (rr.BYMONTHDAY) {
    const n = parseInt(rr.BYMONTHDAY.split(",")[0], 10);
    if (isFinite(n) && n !== 0 && n >= -31 && n <= 31) byMonthDay = n;
  }
  let byDayNth = null, byDayNthWd = null;
  if ((freq === "MONTHLY" || freq === "YEARLY") && rr.BYDAY) {
    const m = /^(-?\d{1,2})(MO|TU|WE|TH|FR|SA|SU)$/.exec(rr.BYDAY.split(",")[0]);
    if (m) { byDayNth = parseInt(m[1], 10); byDayNthWd = WD_MAP[m[2]]; }
  }

  let emitted = 0;
  let cur = { y: start.civil.y, mo: start.civil.mo, d: start.civil.d, h: start.civil.h, mi: start.civil.mi, s: start.civil.s };
  const zone = start.zone;
  let curEpoch = start.epoch;
  const startOrdinal = civilDateOrdinal(start.civil.y, start.civil.mo, start.civil.d);

  if ((freq === "DAILY" || freq === "WEEKLY") && !(freq === "WEEKLY" && byday)) {
    const unit = freq === "DAILY" ? 1 : 7;
    const winSCivil = fromEpoch(winS, tz);
    const winSOrdinal = civilDateOrdinal(winSCivil.y, winSCivil.mo, winSCivil.d);
    const gap = Math.floor((winSOrdinal - startOrdinal) / unit);
    if (gap > 0) {
      const k = Math.floor(gap / interval);
      if (count !== null && k >= count) return;
      emitted = k;
      cur = addCivilDays(cur, k * interval * unit);
      curEpoch = zonedTimeToUtc(cur.y, cur.mo, cur.d, cur.h, cur.mi, cur.s, zone);
    }
  }

  let guard = 0;
  while (guard < 6000) {
    guard++;
    if (count !== null && emitted >= count) return;
    if (until !== null && curEpoch > until) return;

    if (freq === "WEEKLY" && byday) {
      const baseWd = civilWeekday(cur.y, cur.mo, cur.d);
      const mondayOrdinal = civilDateOrdinal(cur.y, cur.mo, cur.d) - baseWd;
      for (const wd of byday) {
        const dayOrdinal = mondayOrdinal + wd;
        if (dayOrdinal < startOrdinal) continue;
        const ymd = ordinalToYmd(dayOrdinal);
        const occEpoch = zonedTimeToUtc(ymd.y, ymd.mo, ymd.d, cur.h, cur.mi, cur.s, zone);
        if (count !== null && emitted >= count) return;
        if (until !== null && occEpoch > until) return;
        emitted++;
        emit(occEpoch);
      }
    } else {
      emitted++;
      emit(curEpoch);
    }

    if (freq === "DAILY") {
      cur = addCivilDays(cur, interval);
    } else if (freq === "WEEKLY") {
      cur = addCivilDays(cur, interval * 7);
    } else if (freq === "MONTHLY") {
      cur = advanceNthDayMonth(cur, interval, byMonthDay, byDayNth, byDayNthWd);
    } else if (freq === "YEARLY") {
      cur = advanceNthDayMonth(cur, 12 * interval, byMonthDay, byDayNth, byDayNthWd);
    } else {
      return;
    }
    curEpoch = zonedTimeToUtc(cur.y, cur.mo, cur.d, cur.h, cur.mi, cur.s, zone);

    if (curEpoch > winE && !(freq === "WEEKLY" && byday)) return;
    if (freq === "WEEKLY" && byday) {
      const wd = civilWeekday(cur.y, cur.mo, cur.d);
      const mondayYmd = ordinalToYmd(civilDateOrdinal(cur.y, cur.mo, cur.d) - wd);
      const mondayEpoch = zonedTimeToUtc(mondayYmd.y, mondayYmd.mo, mondayYmd.d, cur.h, cur.mi, cur.s, zone);
      if (mondayEpoch > winE) return;
    }
  }
}

function parseLatLon(raw) {
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0].trim()), lon = parseFloat(parts[1].trim());
  return isFinite(lat) && isFinite(lon) ? [lat, lon] : null;
}

const WEATHER_CODES = {
  fog: new Set([45, 48]),
  rain: new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]),
  snow: new Set([71, 73, 75, 77, 85, 86]),
  storm: new Set([95, 96, 99]),
};

function weatherKind(code) {
  for (const kind of Object.keys(WEATHER_CODES)) {
    if (WEATHER_CODES[kind].has(code)) return kind;
  }
  return null;
}

const ICON_BASE = "https://trmnl.com/images/plugins/weather/";
const ICON_PRIORITY = ["storm", "snow", "rain", "fog"];
const ICON_FILE = { storm: "wi-day-thunderstorm.svg", snow: "wi-day-snow.svg", rain: "wi-day-rain.svg", fog: "wi-day-fog.svg" };

function dayIcon(hours) {
  const present = new Set(Object.values(hours || {}));
  const kind = ICON_PRIORITY.find((k) => present.has(k)) || null;
  return ICON_BASE + (kind ? ICON_FILE[kind] : "wi-day-sunny.svg");
}

const CLEAR_ICON = ICON_BASE + "wi-day-sunny.svg";
const WEATHER_MARKER_HUE = { storm: "purple", snow: "cyan", rain: "blue", fog: "gray-30" };

// The grid view shows weather via per-hour hatching, but the agenda list views have no per-hour
// visual at all — so a weather condition starting or stopping is surfaced there as its own
// marker "event" at the hour it starts and the hour it stops. dayWeather is the same
// {hour: "rain"|"storm"|"snow"|"fog"} map segments use; a change straight from one condition to
// another (e.g. rain into snow, with no clear hour between) emits both a "stops" and a "starts"
// marker at that same hour.
function weatherTransitions(dayWeather) {
  const marks = [];
  let prevKind = null;
  for (let h = 0; h < 24; h++) {
    const kind = (dayWeather || {})[h] || null;
    if (kind !== prevKind) {
      if (prevKind) marks.push({ h, kind: prevKind, starting: false });
      if (kind) marks.push({ h, kind, starting: true });
    }
    prevKind = kind;
  }
  return marks;
}

function weatherMarkerItem(kind, starting, timeLabel, weatherI18n) {
  const t = weatherI18n || WEATHER_TEXT_FALLBACK;
  const hue = starting ? WEATHER_MARKER_HUE[kind] : "yellow";
  return {
    time: timeLabel, title: t[kind + (starting ? "_starts" : "_stops")] || WEATHER_TEXT_FALLBACK[kind + (starting ? "_starts" : "_stops")],
    hue: colorClass(hue), fg: foregroundFor(hue),
    current: false, badges: [], icon_url: starting ? ICON_BASE + ICON_FILE[kind] : CLEAR_ICON,
  };
}

function splitIsoLocal(iso) {
  const [datePart, timePart] = iso.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = (timePart || "00:00").split(":").map(Number);
  return { y, mo, d, h, mi };
}

async function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(id);
  }
}

function msUntil(deadline) {
  return Math.max(0, deadline - Date.now());
}

async function fetchSky(location, daysN, fahrenheit, deadline) {
  location = (location || "").trim();
  if (!location) return { sunMarks: {}, hourlyWeather: {}, dailyTemps: {}, error: null };
  try {
    const latlon = parseLatLon(location);
    if (!latlon) return { sunMarks: {}, hourlyWeather: {}, dailyTemps: {}, error: "invalid coordinates " + JSON.stringify(location) };
    const [lat, lon] = latlon;
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon),
      daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
      hourly: "weathercode", timezone: "auto", forecast_days: String(daysN),
    });
    if (fahrenheit) params.set("temperature_unit", "fahrenheit");
    const budget = msUntil(deadline);
    if (budget <= 0) throw new Error("timed out");
    const resp = await fetchWithTimeout("https://api.open-meteo.com/v1/forecast?" + params.toString(), Math.min(budget, 3000), {
      headers: { "User-Agent": "TRMNL-ICS-Calendar" },
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const body = await resp.json();
    const daily = body.daily || {};
    const sunrises = daily.sunrise || [], sunsets = daily.sunset || [];
    const highs = daily.temperature_2m_max || [], lows = daily.temperature_2m_min || [];

    const sunMarks = {};
    for (let i = 0; i < Math.min(daysN, sunrises.length, sunsets.length); i++) {
      const marks = [];
      for (const [arr, kind] of [[sunrises, "sunrise"], [sunsets, "sunset"]]) {
        const parsed = splitIsoLocal(arr[i]);
        marks.push({ hour: parsed.h + parsed.mi / 60.0, kind });
      }
      sunMarks[i] = marks;
    }
    const dailyTemps = {};
    for (let i = 0; i < Math.min(daysN, highs.length, lows.length); i++) {
      dailyTemps[i] = { high: Math.round(highs[i]), low: Math.round(lows[i]) };
    }

    const hourly = body.hourly || {};
    const hTimes = hourly.time || [], codes = hourly.weathercode || [];
    const hourlyWeather = {};
    let dayI = -1, prevKey = null;
    for (let j = 0; j < hTimes.length; j++) {
      const parsed = splitIsoLocal(hTimes[j]);
      const key = parsed.y + "-" + parsed.mo + "-" + parsed.d;
      if (key !== prevKey) {
        dayI++;
        prevKey = key;
      }
      if (dayI >= daysN) break;
      if (j < codes.length) {
        const kind = weatherKind(codes[j]);
        if (kind !== null) {
          hourlyWeather[dayI] = hourlyWeather[dayI] || {};
          hourlyWeather[dayI][parsed.h] = kind;
        }
      }
    }

    return { sunMarks, hourlyWeather, dailyTemps, error: null };
  } catch (exc) {
    return { sunMarks: {}, hourlyWeather: {}, dailyTemps: {}, error: (exc && exc.name ? exc.name : "Error") + ": " + (exc && exc.message ? exc.message : exc) };
  }
}

function decodeXmlEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

const RSS_HEADLINE_LIMIT = 3;

function findElements(xml, localName, limit) {
  const results = [];
  const openRe = new RegExp("<(?:[\\w-]+:)?" + localName + "\\b([^>]*?)(/)?>", "gi");
  let open;
  while (results.length < limit && (open = openRe.exec(xml)) !== null) {
    if (open[2]) { results.push(""); continue; }
    const closeRe = new RegExp("<\\/(?:[\\w-]+:)?" + localName + "\\s*>", "i");
    const rest = xml.slice(openRe.lastIndex);
    const close = closeRe.exec(rest);
    if (close) {
      results.push(rest.slice(0, close.index));
      openRe.lastIndex += close.index + close[0].length;
    } else {
      results.push("");
    }
  }
  return results;
}

function findFirstElement(xml, localName) {
  const all = findElements(xml, localName, 1);
  return all.length ? all[0] : null;
}

async function fetchRssHeadline(url, label, deadline) {
  url = (url || "").trim();
  if (!url) return null;
  try {
    const budget = msUntil(deadline);
    if (budget <= 0) return null;
    const resp = await fetchWithTimeout(url, Math.min(budget, 4000), { headers: { "User-Agent": "TRMNL-ICS-Calendar" } });
    if (!resp.ok) return null;
    const text = await resp.text();
    let entries = findElements(text, "item", RSS_HEADLINE_LIMIT);
    if (!entries.length) entries = findElements(text, "entry", RSS_HEADLINE_LIMIT);
    const titles = entries
      .map((entryXml) => findFirstElement(entryXml, "title"))
      .filter((t) => t)
      .map((t) => decodeXmlEntities(t))
      .filter((t) => t);
    if (!titles.length) return null;
    return { label: label || null, titles };
  } catch (exc) {
    return null;
  }
}

const HEADER_PCT = 11;
const FOOTER_PCT = 7;
const NEWS_PCT = 2;
const ALLDAY_ROW_PCT = 7;
const ALERTS_ROW_PCT = 5;
const READABLE_BOX_MIN_PCT = 4;
function hueOf(calIdx, calendarColors) {
  if (calendarColors && calIdx < calendarColors.length && calendarColors[calIdx]) return calendarColors[calIdx];
  return AUTO_HUES[calIdx % AUTO_HUES.length];
}

function cluster(events) {
  const clusters = [];
  let active = [];
  let cur = null;

  function close() {
    if (cur !== null) {
      cur.nlanes = Math.max(...cur.lanes.map((p) => p[1])) + 1;
      clusters.push(cur);
    }
  }

  for (const ev of [...events].sort((a, b) => a.h0 - b.h0)) {
    if (cur !== null && ev.h0 >= cur.h1) {
      close();
      cur = null;
      active = [];
    }
    if (cur === null) cur = { h0: ev.h0, h1: ev.h1, lanes: [] };
    active = active.filter((p) => p[0] > ev.h0);
    const used = new Set(active.map((p) => p[1]));
    let lane = 0;
    while (used.has(lane)) lane++;
    active.push([ev.h1, lane]);
    cur.lanes.push([ev, lane]);
    cur.h1 = Math.max(cur.h1, ev.h1);
  }
  close();
  return clusters;
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

const EXTENSION_WEIGHT = 0.8;

function layoutNative(days, alldayBars, outerStart, outerEnd, coreStart, coreEnd, nowH, sunMarks, hourlyWeather, calendarColors, headerPct, is12h, newsPct, alertsPct, weatherI18n) {
  outerStart = Math.max(0, Math.min(23, Math.trunc(outerStart)));
  outerEnd = Math.max(outerStart + 1, Math.min(24, Math.trunc(outerEnd)));
  coreStart = Math.max(outerStart, Math.min(23, Math.trunc(coreStart)));
  coreEnd = Math.max(coreStart + 1, Math.min(outerEnd, Math.trunc(coreEnd)));
  newsPct = newsPct || 0;
  alertsPct = alertsPct || 0;

  const headerRenderedPct = headerPct + newsPct;
  const maxAdRows = alldayBars.length ? Math.max(...alldayBars.map((b) => b.row)) + 1 : 0;
  const alldayPct = Math.min(3, maxAdRows) * ALLDAY_ROW_PCT;
  const gridBase = headerRenderedPct + alldayPct + alertsPct;
  const gridPct = 100 - gridBase - FOOTER_PCT;

  const weight = new Array(24).fill(0);
  let totalWeight = 0;
  for (let h = outerStart; h < outerEnd; h++) {
    weight[h] = h >= coreStart && h < coreEnd ? 1 : EXTENSION_WEIGHT;
    totalWeight += weight[h];
  }
  const hourPct = new Array(24).fill(0);
  let prevCum = 0;
  let cumW = 0;
  for (let h = outerStart; h < outerEnd; h++) {
    cumW += weight[h];
    const cum = Math.round((cumW * gridPct) / totalWeight);
    hourPct[h] = cum - prevCum;
    prevCum = cum;
  }

  const cumPct = [0];
  for (const p of hourPct) cumPct.push(cumPct[cumPct.length - 1] + p);

  function pctAt(tt) {
    const whole = Math.trunc(tt);
    const frac = tt - whole;
    const cum = cumPct[whole] + (whole < 24 ? hourPct[whole] * frac : 0);
    return gridBase + cum;
  }

  let nextEventH0 = null;
  if (nowH !== null && nowH !== undefined) {
    for (const d of days) {
      if (!d.isToday) continue;
      for (const e of d.timed) {
        if (e.h0 >= nowH && e.h0 < 24 && (nextEventH0 === null || e.h0 < nextEventH0)) nextEventH0 = e.h0;
      }
    }
  }
  const nextHour = nextEventH0 !== null ? Math.trunc(nextEventH0) : null;
  const hasNowHour = nowH !== null && nowH !== undefined && nowH >= 0 && nowH < 24;
  const nowHour = hasNowHour ? Math.floor(nowH) : null;
  const hourRows = [];
  for (let h = 0; h < 24; h++) {
    const hourDisplay = is12h ? (h % 12 || 12) : h;
    const period = is12h ? (h < 12 ? "AM" : "PM") : null;
    hourRows.push({
      hour: hourDisplay, period, pct: hourPct[h], shade: h % 2, bold: h === nextHour,
      important: coreStart <= h && h < coreEnd, current: h === nowHour,
    });
  }

  const minBoxHeight = (gridPct * READABLE_BOX_MIN_PCT) / 100;
  const outDays = [];
  days.forEach((d, di) => {
    const boundsSet = new Set([0, 24]);
    for (let h = 1; h < 24; h++) boundsSet.add(h);

    const daySun = (sunMarks || {})[0] || [];
    const sunriseMark = daySun.find((m) => m.kind === "sunrise");
    const sunsetMark = daySun.find((m) => m.kind === "sunset");
    const sunriseH = sunriseMark ? sunriseMark.hour : null;
    const sunsetH = sunsetMark ? sunsetMark.hour : null;
    for (const h of [sunriseH, sunsetH]) {
      if (h !== null && h >= 0 && h < 24) boundsSet.add(h);
    }
    const hasNow = d.isToday && nowH !== null && nowH !== undefined && nowH >= 0 && nowH < 24;
    if (hasNow) boundsSet.add(nowH);
    const bounds = [...boundsSet].sort((a, b) => a - b);

    function isNight(mid) {
      if (sunriseH === null || sunsetH === null) return false;
      return mid < sunriseH || mid >= sunsetH;
    }

    const dayWeather = (hourlyWeather || {})[di] || {};

    const segments = [];
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const a = bounds[bi], b = bounds[bi + 1];
      const mid = (a + b) / 2.0;
      const h = Math.trunc(a);
      const pct = Math.round(hourPct[h] * (b - h)) - Math.round(hourPct[h] * (a - h));
      const shade = Math.trunc(a) % 2;
      const past = hasNow && a < nowH;
      segments.push({ pct, shade, night: isNight(mid), past, weather: dayWeather[Math.trunc(a)] || null });
    }

    // Lanes are assigned on each event's READABLE vertical extent — its natural top/height,
    // with the bottom stretched to at least minBoxHeight — rather than its raw start/end time.
    // Two events can be sequential (not actually overlapping in time) yet still too close
    // together for the first one's stretched box to fit before the second starts; assigning
    // lanes by extent instead of raw time catches that case too and puts them side by side
    // instead of squishing/hiding one behind the other.
    const withExtent = d.timed.map((ev) => {
      const top = pctAt(ev.h0) - gridBase;
      const height = pctAt(ev.h1) - gridBase - top;
      return { h0: top, h1: top + Math.max(height, minBoxHeight), ev, top, height };
    });
    const clusters = cluster(withExtent);

    const flatEvents = [];
    for (const c of clusters) {
      for (const [item, laneIdx] of c.lanes) flatEvents.push({ item, laneIdx, nlanes: c.nlanes });
    }
    flatEvents.sort((a, b) => a.item.top - b.item.top);

    const events = [];
    flatEvents.forEach(({ item, laneIdx, nlanes }) => {
      const ev = item.ev;
      const boxHeight = item.h1 - item.top;
      const color = ev.hueOverride || hueOf(ev.calIdx, calendarColors);
      events.push({
        top_pct: round4((item.top / gridPct) * 100),
        height_pct: round4((item.height / gridPct) * 100),
        box_height_pct: round4((boxHeight / gridPct) * 100),
        lane_index: laneIdx,
        nlanes: nlanes,
        title: ev.title,
        hue: colorClass(color),
        fg: foregroundFor(color),
      });
    });

    // Agenda variant of this same day, for the full view's own list-with-overflow rendering
    // (an alternative to the segments/events timeline above) — one difference from the
    // single-day views' agenda (data.single_day.agenda): it shows the WHOLE day's schedule, not
    // just what's still ahead of "now" (this is a multi-day at-a-glance overview, where hiding a
    // day's earlier events would look inconsistent next to neighboring days that show
    // everything). All-day items covering this day are prepended using the same agenda_row
    // treatment as a timed event (no time label) — matching how the single-day views already
    // show them — instead of this style's own bars, which shared.liquid suppresses (allday_pct
    // forced to 0) so the list reclaims that header space instead of duplicating them.
    const dayAlldayBars = alldayBars.filter((b) => di >= b.startCol && di < b.startCol + b.span);
    const agendaAllDay = dayAlldayBars.map((b) => ({
      time: null, all_day: true, title: b.title,
      hue: colorClass(b.hue), fg: foregroundFor(b.hue), current: false,
      badges: b.personBadges || [],
    }));
    const agendaEvents = d.timed.map((ev) => {
      const color = ev.hueOverride || hueOf(ev.calIdx, calendarColors);
      return {
        sortH: ev.h0,
        item: {
          time: ev.label, title: ev.title,
          hue: colorClass(color), fg: foregroundFor(color),
          current: hasNow && ev.h0 <= nowH && ev.h1 > nowH,
          badges: ev.personBadges || [],
        },
      };
    });
    const agendaWeather = weatherTransitions(dayWeather).map((m) => {
      // Matches real events' own "H:MM" time labels (fmtTime), not the bare axis-style hour
      // digit (hourRows[h].hour) — mixing "14" in among "10:00–10:30" etc. would look wrong.
      const hourDisplay = is12h ? m.h % 12 || 12 : m.h;
      const period = is12h ? (m.h < 12 ? " AM" : " PM") : "";
      const timeLabel = hourDisplay + ":00" + period;
      return { sortH: m.h, item: weatherMarkerItem(m.kind, m.starting, timeLabel, weatherI18n) };
    });
    const agenda = agendaAllDay.concat(
      agendaEvents.concat(agendaWeather).sort((a, b) => a.sortH - b.sortH).map((x) => x.item)
    ).slice(0, AGENDA_SANITY_CAP);

    outDays.push({
      label: d.label, label_short: d.labelShort,
      label_short_weekday: d.labelShortWeekday, label_short_rest: d.labelShortRest,
      is_today: d.isToday,
      temp: d.temp || null, icon: d.icon || null,
      segments, events, agenda,
    });
  });

  const alldayBarsOut = alldayBars.map((b) => ({
    title: b.title, hue: colorClass(b.hue), fg: foregroundFor(b.hue),
    start_col: b.startCol, span: b.span, row: b.row,
    continues_before: b.continuesBefore, continues_after: b.continuesAfter,
  }));

  return { header_pct: headerRenderedPct, allday_pct: alldayPct, allday_row_pct: ALLDAY_ROW_PCT, allday_bars: alldayBarsOut, allday_max_rows: maxAdRows, grid_pct: gridPct, footer_pct: FOOTER_PCT, news_pct: newsPct, alerts_pct: alertsPct, hour_rows: hourRows, days: outDays };
}
