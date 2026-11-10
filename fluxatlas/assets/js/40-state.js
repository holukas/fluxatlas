  /* ------------------------------------------------------------------------------------------
     Indexing helpers
     ------------------------------------------------------------------------------------------ */

  const DAY0 = Date.parse(DAYS.start + 'T00:00:00Z');
  const YEARS = [];
  for (let y = M.first_year; y <= M.last_year; y++) YEARS.push(y);

  const monthIndex = {};
  MONTHS.forEach((mo, i) => { monthIndex[mo.y + '-' + mo.m] = i; });
  const monthAt = (y, m) => MONTHS[monthIndex[y + '-' + m]];

  const seasonIndex = {};
  SEASONS.forEach((se, i) => { seasonIndex[se.y + '-' + se.s] = i; });
  const seasonAt = (y, key) => SEASONS[seasonIndex[y + '-' + key]];

  const yearIndex = {};
  YEAR_ROWS.forEach((yr, i) => { yearIndex[yr.y] = i; });
  const yearAt = y => YEAR_ROWS[yearIndex[y]];

  /* The three scales differ in four things and nothing else: the list of spans, the columns of the
     grid, how a span is addressed in the URL, and what a span is called. Everything downstream
     reads these rather than asking which scale is active.

     The year is the degenerate case of the same shape: one column, so the grid becomes a single
     strip and the foot row states the record. It is worth having as a scale rather than as a
     separate view precisely because everything else - the metric picker, the badge filter, the
     colour domain, the span panel - then works on it unchanged. */
  const SCALES = {
    month: {
      spans: () => MONTHS,
      cols: () => MONTH_ABBR.map((label, i) => ({ label: label, id: i + 1 })),
      at: (y, id) => monthAt(y, +id),
      idOf: mo => mo.m,
      slug: mo => String(mo.m).padStart(2, '0'),
      title: mo => MONTH_NAME[mo.m - 1] + ' ' + mo.y,
      peerName: mo => MONTH_NAME[mo.m - 1],
      colName: id => MONTH_NAME[id - 1]
    },
    season: {
      spans: () => SEASONS,
      cols: () => SEASON_DEFS.map(d => ({ label: d.label, id: d.key })),
      at: (y, id) => seasonAt(y, id),
      idOf: se => se.s,
      slug: se => se.s,
      title: se => se.title,
      peerName: se => se.label.toLowerCase() + 's',
      colName: id => (SEASON_DEFS.find(d => d.key === id) || { label: id }).label
    },
    year: {
      spans: () => YEAR_ROWS,
      cols: () => [{ label: 'Annual', id: M.year_slug }],
      at: y => yearAt(+y),
      idOf: () => M.year_slug,
      slug: () => M.year_slug,
      title: yr => String(yr.y),
      peerName: () => 'years',
      // Lower case, because every use of it sits inside a sentence: "against the record normal",
      // "in every record of the record" is not one of them, so the year scale reads "record".
      colName: () => 'record'
    }
  };
  const scale = () => SCALES[state.scale];
  /* What the spans a span is compared against are called. At the month and season scales that is
     the column it sits in - "January", "winter" - and at the year scale the peers are simply the
     other years, so it is not the column's name ("record") that belongs in the sentence. */
  const peerOf = mo => (state.scale === 'year' ? 'year' : scale().colName(scale().idOf(mo)));

  /* The same word as it appears mid-sentence. A season's label is capitalised for the grid's
     column head and is an ordinary noun in running text: "every summer of the record". */
  const peerWord = mo => (state.scale === 'season' ? peerOf(mo).toLowerCase() : peerOf(mo));

  /** What the normal behind the active scale is, in the words the page uses for it. */
  const normalWord = () => (state.scale === 'month' ? 'calendar-month normal'
    : state.scale === 'season' ? 'normal for this season across the record'
      : 'record normal');
  /** What one span is called, for the running text that has to name it. */
  const spanNoun = () => (state.scale === 'season' ? 'season'
    : state.scale === 'year' ? 'year' : 'month');

  /** The season a month sits in, and the month's place within it. */
  function seasonOfMonth(mo) {
    const def = SEASON_DEFS.find(d => d.months.indexOf(mo.m) >= 0);
    if (!def) return null;
    /* A season that crosses the new year is labelled by the year of its last month, so the months
       before that boundary belong to the season labelled by the following year. Which months those
       are is the scheme's, not December's: under `NDJF` it is November as well, and hard-coding
       month 12 here sent every November to a season that began a year earlier. `shift` is derived
       per scheme in Python and travels with the definition. */
    return seasonAt(mo.y + ((def.shift || {})[mo.m] || 0), def.key);
  }

  const dayIndex = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - DAY0) / 86400000);
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

  /* A span may run across a year boundary, so a day is identified by its index into the daily
     arrays and the calendar date is derived from that rather than from the span it sits in. This
     is what lets one set of chart renderers serve a July and a winter. */
  function dateAt(i) {
    const t = new Date(DAY0 + i * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const doyAt = i => { const x = dateAt(i); return doy365(x.y, x.m, x.d); };
  const labelAt = i => { const x = dateAt(i); return x.d + ' ' + MONTH_ABBR[x.m - 1]; };

  /* The nth day of a span, written as a date a reader can find. Running text used to print the
     index as an ordinal - "on the 89th" - which is a day of the month only where the span is one:
     a season and a year both number their days past 31. Inside a month the day alone is enough;
     a longer span needs the month with it, and a season may begin in the previous calendar year,
     so it carries the year as well. */
  function hitDate(mo, d) {
    const at = dateAt(mo.i0 + d - 1);
    if (state.scale === 'month') return 'the ' + ord(at.d);
    return at.d + ' ' + MONTH_NAME[at.m - 1] + (state.scale === 'year' ? '' : ' ' + at.y);
  }

  /** Day of year with 29 February folded onto 1 March, matching how the normals were built. */
  function doy365(y, m, d) {
    const doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
    return (isLeap(y) && doy > 59) ? doy - 1 : doy;
  }

  const dayStat = (v, stat, i) => {
    const arr = DAYS.series[v + '_' + stat];
    return arr ? arr[i] : null;
  };
  const dayNormal = (v, stat, y, m, d) => {
    const n = NORM[v] && NORM[v][stat];
    return n ? n.mean[doy365(y, m, d)] : null;
  };
  const flagSet = (word, key) => {
    const f = FLAGS.find(x => x.key === key);
    return f ? (word & (1 << f.bit)) !== 0 : false;
  };

  /** The daily quantity a metric shows inside a tile, for one day index. */
  function dayValue(metric, i, y, m, d) {
    const spec = metric.day;
    if (spec.kind === 'none') return null;
    if (spec.kind === 'meas') return DAYS.meas[metric.var][i];
    if (spec.kind === 'flag') return flagSet(DAYS.flags[i], spec.flag) ? 1 : 0;
    if (spec.kind === 'range') {
      const lo = dayStat(metric.var, spec.stats[0], i);
      const hi = dayStat(metric.var, spec.stats[1], i);
      return isNum(lo) && isNum(hi) ? hi - lo : null;
    }
    const v = dayStat(metric.var, spec.stat, i);
    if (!isNum(v)) return null;
    if (spec.kind === 'anom') {
      const n = dayNormal(metric.var, spec.stat, y, m, d);
      return isNum(n) ? v - n : null;
    }
    return v;
  }

  function dayColor(metric, value) {
    if (!isNum(value)) return null;
    if (metric.day.kind === 'flag') {
      return value ? hex2rgb(token(metric.stops[metric.stops.length - 1])) : null;
    }
    return metricColor(metric, value, 'day');
  }

  /** The value a tile shows, and the number that belongs beside it. */
  function monthValue(metric, mo) {
    if (metric.field === 'count') return mo.c[metric.count];
    if (metric.field === 'spell') return mo.sp[metric.spell];
    if (metric.field === 'extra') {
      const v = mo.x[metric.extra];
      return v === undefined ? null : v;
    }
    const short = { value: 'v', anom: 'a', pctn: 'p', meas: 'meas' }[metric.field];
    return mo[metric.var] ? mo[metric.var][short] : null;
  }

  /* ------------------------------------------------------------------------------------------
     Variables whose sign means something
     ------------------------------------------------------------------------------------------
     Net CO2 exchange is signed by the micrometeorological convention: negative is carbon taken up
     by the ecosystem, positive is carbon released to the atmosphere. A tile reading "66 g C m-2"
     and "+75 against the normal" therefore says nothing at all to a reader who is not already
     carrying that convention, and says the opposite of the truth to one who assumes more is
     better.

     So wherever the page prints one of those numbers it writes the direction beside it, in words.
     Which words is a registry fact rather than a test for `NEE` here, so a later variable whose
     zero is meaningful is covered by adding the field.
     ------------------------------------------------------------------------------------------ */

  /* Inside this band a departure is called neither more nor less. A quarter of a standard
     deviation is small next to the one-standard-deviation line every badge on this page is
     defined at, and "+2 g C m-2 less uptake than normal" is a distinction without a difference. */
  const SAME_AS_NORMAL = 0.25;

  /** "net uptake", "net release", or the word for a variable that came out level. */
  function senseOf(v, value) {
    if (!v.sign || !isNum(value)) return null;
    if (value === 0) return v.sign.zero;
    return 'net ' + (value < 0 ? v.sign.low : v.sign.high);
  }

  /**
   * How a departure from the normal reads when the sign of the variable means something.
   *
   * Which side of zero the *normal* sits on decides the noun, so a month that is normally a sink
   * is described in uptake and one that is normally a source in release. The sign of the departure
   * then decides more or less. Both are needed: "+75 g C m-2" is less uptake for a July and more
   * release for a January, and they are the same number.
   */
  function senseAnomaly(v, rec) {
    if (!v.sign || !isNum(rec.a) || !isNum(rec.v)) return null;
    if (isNum(rec.z) && Math.abs(rec.z) < SAME_AS_NORMAL) {
      return 'about the same ' + (rec.v <= 0 ? v.sign.low : v.sign.high) + ' as normal';
    }
    const normal = rec.v - rec.a;
    const noun = normal <= 0 ? v.sign.low : v.sign.high;
    const more = normal <= 0 ? rec.a < 0 : rec.a > 0;
    return (more ? 'more ' : 'less ') + noun + ' than normal';
  }

  /** The departure with its direction spelled out, for the places that print both. */
  function anomalyPhrase(v, rec, digits) {
    const figure = nfs(rec.a, digits) + ' ' + v.units;
    const sense = senseAnomaly(v, rec);
    return sense ? figure + ', ' + sense : figure + ' against the normal';
  }

  /* A departure is written with its sign wherever it appears: "2.8" and "+2.8" are the same number
     only if the reader already knows which of the two the tile is showing. */
  const metricFormat = (metric, value) =>
    metric.field === 'anom' ? nfs(value, metric.digits) : nf(value, metric.digits);

  function monthSub(metric, mo) {
    const rec = mo[metric.var];
    if (!rec) return '';
    if (metric.field === 'anom') return nf(rec.v, metric.digits) + ' ' + metric.units;
    if (metric.field === 'pctn') return nf(rec.v, 0) + ' ' + VARS[metric.var].units;
    if (metric.field === 'value' && isNum(rec.a)) return nfs(rec.a, metric.digits);
    return '';
  }

  /* ------------------------------------------------------------------------------------------
     State
     ------------------------------------------------------------------------------------------ */

  /* Two scales rather than one, and they are not the same question. `scale` is what a *span* is -
     what a tile covers, what a normal is taken over, what the month view walks - and it is only
     ever a month or a season, because a day is opened as a day of its month and never as a span of
     its own. `grid` is what the grid *draws*, which is those two plus the day raster. Keeping them
     apart is what lets a reader open a day out of the raster and come back to the raster. */
  const state = {
    scale: 'month',
    grid: 'month',
    metric: DATA.metrics[0].key,
    strips: true,
    allBadges: false,
    filters: new Set(),
    y: null, m: null, d: null, span: null,
    variable: null,
    cursor: null
  };
  const metric = () => METRICS[state.metric];

  /* ------------------------------------------------------------------------------------------
     The address
     ------------------------------------------------------------------------------------------
     The hash names the view - `#2016-05`, `#2016-JJA`, `#2016-YEAR`, `#2016-05-12`, `#var-TA` - and
     after a `?` it carries the two choices that shape every view: the metric the grid is coloured
     by and the scale it is drawn at, `#grid?metric=PREC_pctn&scale=season`. A choice at its default
     is left out, so an address stays as short as what it says.

     An address without the `?` keeps whatever the reader has already chosen. Every link inside the
     page is written that way, so opening a month and coming back leaves the metric where it was,
     and the router then writes the choices back into the address it arrived at. An address with
     the `?` states them, so a shared link or a reload restores both.

     The address is rewritten with `location.replace` on the fragment alone, never with
     `history.replaceState`: a page opened from disk has an opaque origin, and a browser is entitled
     to refuse a history state there. A fragment navigation is permitted on every origin. Choosing a
     metric or a scale therefore replaces the current entry rather than adding one, so Back leaves
     the view instead of stepping back through every colour it was shown in.
     ------------------------------------------------------------------------------------------ */

  const DEFAULT_METRIC = DATA.metrics[0].key;
  const GRIDS = ['month', 'season', 'year', 'day'];

  /** The hash as a route and its choices. `has` is whether the address stated any at all. */
  function readAddress() {
    const hash = location.hash.replace(/^#/, '');
    const q = hash.indexOf('?');
    const out = { route: q < 0 ? hash : hash.slice(0, q), params: {}, has: q >= 0 };
    if (q >= 0) {
      hash.slice(q + 1).split('&').forEach(pair => {
        if (!pair) return;
        const eq = pair.indexOf('=');
        try {
          out.params[decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq))] =
            decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1));
        } catch (e) { /* a malformed escape states nothing */ }
      });
    }
    return out;
  }

  /** Which span scale a route names, or null where it names none. */
  function routeScale(route) {
    const m = /^(\d{4})-(\d{2}|[A-Za-z]{2,6})(?:-(\d{2}))?$/.exec(route);
    if (!m) return null;
    return /^\d+$/.test(m[2]) ? 'month' : m[2] === M.year_slug ? 'year' : 'season';
  }

  const gridOffered = g => GRIDS.indexOf(g) >= 0 && (g !== 'season' || SEASON_DEFS.length > 0);

  /**
   * Take the metric and the scale from the address, where it states them.
   *
   * Returns whether either moved, which is whether the grid has to be drawn again. A value the page
   * does not offer - a metric this selection dropped, a season scale on a page built without one -
   * is ignored rather than obeyed, so an old link opens on the default instead of on nothing.
   */
  function applyAddress(addr) {
    if (!addr.has) return false;
    let moved = false;
    const want = METRICS[addr.params.metric] ? addr.params.metric : DEFAULT_METRIC;
    if (want !== state.metric) {
      state.metric = want;
      const pick = document.getElementById('metric-pick');
      if (pick) pick.value = want;
      moved = true;
    }
    const implied = routeScale(addr.route) || 'month';
    const grid = gridOffered(addr.params.scale) ? addr.params.scale : implied;
    if (grid !== state.grid) {
      setGrid(grid);
      moved = true;
    }
    return moved;
  }

  /** The address for a route with the choices in force, defaults left out. */
  function addressFor(route) {
    const parts = [];
    if (state.metric !== DEFAULT_METRIC) parts.push('metric=' + encodeURIComponent(state.metric));
    if (state.grid !== (routeScale(route) || 'month')) parts.push('scale=' + state.grid);
    if (!parts.length) return route;
    return (route || 'grid') + '?' + parts.join('&');
  }

  /* The address this page last wrote itself. Rewriting the fragment fires `hashchange` like any
     other navigation, and the router answers the echo of its own write by doing nothing rather
     than by drawing the view a second time. */
  let echo = null;

  function syncAddress() {
    const want = addressFor(readAddress().route);
    if (want === location.hash.replace(/^#/, '')) return;
    echo = want;
    location.replace('#' + want);
  }

