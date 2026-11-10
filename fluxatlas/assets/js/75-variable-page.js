  /* ------------------------------------------------------------------------------------------
     The variable page: the record, the years, the annual cycle, coverage and provenance
     ------------------------------------------------------------------------------------------
     What the page above draws per calendar month, the cards below draw per year and per day,
     from the year rows, the daily series and `DATA.var_record` - the figures only the half-hours
     of a year can give: their percentiles, the measured extremes, the new records and the longest
     gap. Everything a site states about a variable beyond its column - a source flag, a corrected
     series beside the measured one, a reference station, its own notes - is drawn where the build
     carries it and leaves no card where it does not.

     Each chart card carries the numbers behind it as a table, behind a Chart/Table switch, and a
     year anywhere on these cards opens that year.
     ------------------------------------------------------------------------------------------ */

  const VAR_RECORD = DATA.var_record || null;
  const recordOf = key => (VAR_RECORD && VAR_RECORD.vars && VAR_RECORD.vars[key]) || null;

  // How many of the most recent years are set against the earlier ones.
  const N_RECENT = 10;

  const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sdOf = xs => {
    if (xs.length < 2) return null;
    const m = meanOf(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
  };
  const aggWord = v => (v.agg === 'sum' ? 'total' : 'mean');
  const yearLink = y => '<a href="#' + y + '-' + M.year_slug + '">' + y + '</a>';
  const tone = x => (isNum(x) ? (x >= 0 ? 'num-warm' : 'num-cold') : '');
  const ofKey = (row, key) => (row && row[key]) || {};

  /* A caller's note, made safe for markup with one exception: `<code>` stays code, since a site's
     notes name columns and nothing else in them is markup. */
  const noteHTML = s => esc(s).replace(/&lt;(\/?)code&gt;/g, '<$1code>');

  /** Whether a year is covered well enough to stand for the variable: the availability gate. */
  const yearCounts = (row, key) => !!row[key] && isNum(row[key].v) && isNum(row[key].avail)
    && row[key].avail >= cov(key).normal;

  /** The year ticks of a chart over the record, as many as fit. */
  function yearTicksFor(years, f) {
    const every = Math.max(1, Math.ceil(years.length / Math.max(3, Math.floor(f.iw / 54))));
    return years.filter((y, i) => i % every === 0 || i === years.length - 1)
      .map(y => ({ v: y, label: String(y) }));
  }

  /** "2019-07-25T14:30" as its day and averaging window: "25 Jul 2019, 14:30–15:00". */
  function halfhourWhen(stamp) {
    const at = halfhourAt(stamp);
    return at ? at.d + ' ' + MONTH_ABBR[at.m - 1] + ' ' + at.y + ', ' + at.window : '–';
  }

  /**
   * The last ten years of a variable against all of its earlier years.
   *
   * Taken over the years covered well enough to stand for the variable. The
   * difference is also stated in per cent where that is meaningful: where the earlier mean is at
   * least the year-to-year spread of the annual values, so that a mean near zero - a soil heat flux
   * - does not turn a small change into hundreds of per cent, and against the size of the earlier
   * mean, so that a rise is not printed as a fall where that mean is negative.
   */
  function recentEarlier(key) {
    const v = VARS[key];
    const first = v.first_year, last = v.last_year;
    const cut = last - N_RECENT + 1;
    const rows = YEAR_ROWS.filter(r => r.y >= first && r.y <= last && yearCounts(r, key));
    const recent = rows.filter(r => r.y >= cut), early = rows.filter(r => r.y < cut);
    const out = { recent: [Math.max(cut, first), last], early: [first, cut - 1],
      nRecent: recent.length, nEarly: early.length };
    if (!early.length || !recent.length) {
      out.missing = first >= cut
        ? (first > cut ? cut + '–' + (first - 1) : 'No year before ' + cut) + ' holds no data for '
          + 'this variable, whose record begins in ' + first + ', so the last ' + N_RECENT
          + ' years cannot be set against earlier ones'
        : !early.length ? 'No year before ' + cut + ' is covered well enough to compare'
          : 'No year from ' + cut + ' on is covered well enough to compare';
      return out;
    }
    const all = rows.map(r => r[key].v);
    out.recentMean = meanOf(recent.map(r => r[key].v));
    out.earlyMean = meanOf(early.map(r => r[key].v));
    out.diff = out.recentMean - out.earlyMean;
    out.sd = sdOf(all);
    out.pct = isNum(out.sd) && out.earlyMean !== 0 && Math.abs(out.earlyMean) >= out.sd
      ? 100 * out.diff / Math.abs(out.earlyMean) : null;
    return out;
  }

  /** The figures a reader looks for first, as tiles above the summary. */
  function varTiles(key) {
    const v = VARS[key];
    const met = ownMetric(v);
    const R = recordOf(key);
    const d = monthDigits(key);
    const u = v.units;
    const items = [];
    const rows = YEAR_ROWS.filter(r => yearCounts(r, key));
    if (rows.length) {
      const values = rows.map(r => r[key].v);
      const m = meanOf(values), sd = sdOf(values);
      const sense = senseOf(v, m);
      items.push(tile('Annual ' + aggWord(v), nf(m, d), u,
        (isNum(sd) ? '± ' + nf(sd, d) + ' ' + u + ' standard deviation between ' : 'over ')
        + rows.length + ' year' + (rows.length === 1 ? '' : 's') + (sense ? ' · ' + sense : '')));
    }
    const t = met && met.trend_year;
    if (t) {
      items.push(isNum(t.slope)
        ? tile('Trend', nfs(t.slope, met.digits + 1), met.units + ' / decade', 'Theil-Sen, 95 % '
          + 'interval ' + nfs(t.lo, met.digits + 1) + ' to ' + nfs(t.hi, met.digits + 1)
          + ' · Kendall p = ' + nf(t.p, 3) + ' · ' + t.n + ' years')
        : tile('Trend', '–', '', 'not stated: ' + t.n + ' complete years, fewer than '
          + M.trend_min_years));
    }
    const re = recentEarlier(key);
    items.push(isNum(re.diff)
      ? tile('Last ' + N_RECENT + ' years', nfs(re.diff, d), u, re.recent[0] + '–' + re.recent[1]
        + ' against ' + re.early[0] + '–' + re.early[1]
        + (isNum(re.pct) ? ' · ' + nfs(re.pct, 1) + ' %' : ''))
      : tile('Last ' + N_RECENT + ' years', '–', '', re.missing));
    if (rows.length > 1) {
      const sorted = rows.slice().sort((a, b) => b[key].v - a[key].v);
      const hi = sorted[0], lo = sorted[sorted.length - 1];
      const said = row => nf(row[key].v, d) + ' ' + u
        + (senseOf(v, row[key].v) ? ', ' + senseOf(v, row[key].v) : '');
      items.push(tile('Highest year', String(hi.y), '', said(hi) + ' · lowest ' + lo.y + ', '
        + said(lo), 'warm'));
    }
    const EH = DATA.extreme_halfhours && DATA.extreme_halfhours.vars
      ? DATA.extreme_halfhours.vars[key] : null;
    if (EH && EH.high && EH.high.length) {
      items.push(tile('Highest measured half-hour', nf(EH.high[0][1], EH.digits), EH.units,
        halfhourWhen(EH.high[0][0]) + ' (' + v.word_high + ')', 'warm'));
    }
    if (EH && EH.low && EH.low.length) {
      items.push(tile('Lowest measured half-hour', nf(EH.low[0][1], EH.digits), EH.units,
        halfhourWhen(EH.low[0][0]) + ' (' + v.word_low + ')', 'cold'));
    }
    const nee = partitionedFrom(v);
    if (R && isNum(R.meas) && !(v.partitioned && !v.fill)) {
      items.push(tile(nee ? 'Measured ' + nee : 'Measured', nf(R.meas, 1), '%',
        nee ? 'of the net flux this is partitioned from; the rest is gap-filled'
          : v.fill ? 'the rest is gap-filled; see Coverage'
            : 'the rest is missing; the record carries its gaps'));
    }
    const T = DATA.season_timing ? DATA.season_timing[key] : null;
    if (T && T.kind === 'growing') {
      const lengths = T.years.map(r => r.length).filter(isNum);
      if (lengths.length) {
        items.push(tile('Growing season', nf(meanOf(lengths), 0), 'days', 'mean length on a '
          + nf(T.base, 0) + ' ' + T.units + ' base, ' + lengths.length + ' years'));
      }
    }
    return '<div class="tiles vartiles">' + items.join('') + '</div>';
  }

  /** The site's own notes on this variable, where the build carries any. */
  function varNotes(grid, key) {
    const notes = VARS[key].notes || [];
    if (!notes.length) return;
    cardEl(grid, { title: 'Notes on this variable', width: 'w-12',
      sub: 'Supplied with this build, not derived from the data.' }).innerHTML =
      '<div class="varnotes">' + notes.map(n => '<p>' + noteHTML(n) + '</p>').join('') + '</div>';
  }

  /* ---- The record ------------------------------------------------------------------------ */

  /** One stripe per year, coloured by its departure from the record. */
  function drawStripes(key) {
    const v = VARS[key];
    const d = monthDigits(key);
    return function (host) {
      const years = YEAR_ROWS.map(r => r.y);
      const anom = YEAR_ROWS.map(r => (isNum(ofKey(r, key).a) ? r[key].a : null));
      const f = frame(host, { height: 118, margin: { top: 6, right: 8, bottom: 24, left: 8 },
        ariaLabel: 'Annual ' + shortInText(v) + ' as a departure from the record, one stripe '
          + 'per year' });
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
      const absmax = Math.max.apply(null, anom.filter(isNum).map(Math.abs).concat([0])) || 1;
      const colour = departureColour(key, absmax);
      const w = f.iw / years.length;
      years.forEach((y, i) => {
        el('rect', { x: sx(y) - w / 2, y: f.m.top, width: w + 0.5, height: f.ih,
          fill: isNum(anom[i]) ? colour.fill(anom[i]) : f.p.grid,
          opacity: isNum(anom[i]) ? 1 : 0.45 }, f.svg);
      });
      svgText(f.svg, f.m.left + 2, f.m.top + f.ih + 16, String(years[0]), 'ax-text',
        { 'text-anchor': 'start' });
      svgText(f.svg, f.m.left + f.iw - 2, f.m.top + f.ih + 16, String(years[years.length - 1]),
        'ax-text', { 'text-anchor': 'end' });
      hover(f, sx, years, y => {
        const rec = ofKey(YEAR_ROWS[years.indexOf(y)], key);
        const lines = [{ k: cap(aggWord(v)), v: isNum(rec.v) ? nf(rec.v, d) + ' ' + v.units
          : 'no value' }];
        if (isNum(rec.a)) {
          lines.push({ k: 'Departure from the record', v: nfs(rec.a, d) + ' ' + v.units,
            color: colour.fill(rec.a) });
          const sense = departureSense(v, rec.a);
          if (sense) lines.push({ k: 'Direction', v: sense });
        }
        if (isNum(rec.r)) lines.push({ k: 'Rank', v: ord(rec.r) + ' of ' + rec.n });
        return tipRows(String(y), lines);
      }, y => { location.hash = y + '-' + M.year_slug; });
    };
  }

  function stripesTable(key) {
    const v = VARS[key];
    const d = monthDigits(key);
    return tableHTML(['Year', cap(aggWord(v)) + ' (' + v.units + ')',
      'Departure from the record (' + v.units + ')', 'Rank'],
    YEAR_ROWS.map(r => {
      const rec = ofKey(r, key);
      return [yearLink(r.y), nf(rec.v, d), { v: nfs(rec.a, d), cls: tone(rec.a) },
        isNum(rec.r) ? ord(rec.r) + ' of ' + rec.n : '–'];
    }));
  }

  /**
   * What the daily record draws: the range of each day as a band, the day's own figure as a line,
   * and a 31-day running mean over it. A summed variable has no range worth a band - its daily
   * figure is the total - and a variable that ships no daily minimum is banded from its mean to its
   * maximum, which for radiation is the part of the day worth seeing.
   */
  function dailyRecordSpec(v) {
    const has = stat => !!DAYS.series[v.key + '_' + stat];
    const run = v.agg === 'sum' ? 'sum' : 'mean';
    let band = null;
    if (v.agg !== 'sum') {
      if (has('min') && has('max')) band = ['min', 'max'];
      else if (has('mean') && has('max')) band = ['mean', 'max'];
    }
    // The mean is the lower edge of a mean-to-maximum band, and is not drawn again as a line.
    const line = has(run) && !(band && band[0] === run) ? run : null;
    return { band: band, line: line, run: has(run) ? run : null,
      bandLabel: band ? DAILY_STAT_WORD[band[0]] + ' to ' + DAILY_STAT_WORD[band[1]] : null,
      lineLabel: line ? DAILY_STAT_WORD[line] : null };
  }

  /** A centred running mean that needs `least` values in its window, in one pass. */
  function runningMean(values, width, least) {
    const n = values.length, half = Math.floor(width / 2);
    const sum = new Float64Array(n + 1), cnt = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const ok = isNum(values[i]);
      sum[i + 1] = sum[i] + (ok ? values[i] : 0);
      cnt[i + 1] = cnt[i] + (ok ? 1 : 0);
    }
    const out = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
      const c = cnt[hi] - cnt[lo];
      if (c >= least) out[i] = (sum[hi] - sum[lo]) / c;
    }
    return out;
  }

  function drawDailyRecord(key) {
    const v = VARS[key];
    const spec = dailyRecordSpec(v);
    return function (host) {
      const xs = [];
      for (let i = 0; i < DAYS.n; i++) xs.push(i);
      const series = stat => xs.map(i => dayStat(key, stat, i));
      const lo = spec.band ? series(spec.band[0]) : null;
      const hi = spec.band ? series(spec.band[1]) : null;
      const line = spec.line ? series(spec.line) : null;
      const run = spec.run ? runningMean(series(spec.run), 31, 10) : null;
      const f = frame(host, { aspect: 0.3,
        ariaLabel: 'Every day of the record, ' + shortInText(v) });
      const ext = extent([lo, hi, line, run]);
      const low = v.agg === 'sum' ? Math.min(0, ext[0]) : ext[0];
      const pad = (ext[1] - low) * 0.04 || 1;
      const sx = linear(0, DAYS.n - 1, f.m.left, f.m.left + f.iw);
      const sy = linear(low - (v.agg === 'sum' ? 0 : pad), ext[1] + pad, f.m.top + f.ih, f.m.top);
      const every = Math.max(1, Math.ceil(YEARS.length / Math.max(3, Math.floor(f.iw / 54))));
      drawAxes(f, sx, sy, { yDigits: v.digits, yLabel: v.units,
        xTicks: YEARS.filter((y, i) => i % every === 0)
          .map(y => ({ v: dayIndex(y, 1, 1), label: String(y) })) });
      if (v.sign && ext[0] < 0 && ext[1] > 0) {
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0), stroke: f.p.ink,
          'stroke-width': 1, opacity: 0.5 }, f.svg);
      }
      if (lo) {
        el('path', { d: areaFrom(xs, lo, hi, sx, sy), fill: f.p.bandInner, opacity: 0.9 }, f.svg);
      }
      if (line) {
        el('path', { d: pathFrom(xs, line, sx, sy), fill: 'none', stroke: f.p.series[0],
          'stroke-width': 0.6, opacity: 0.8 }, f.svg);
      }
      if (run) {
        el('path', { d: pathFrom(xs, run, sx, sy), fill: 'none', stroke: f.p.series[1],
          'stroke-width': 2, 'stroke-linejoin': 'round' }, f.svg);
      }
      hover(f, sx, xs.filter(i => i % 3 === 0), i => {
        const at = dateAt(i);
        const rows = [];
        if (lo) {
          rows.push({ k: cap(spec.bandLabel), v: nf(lo[i], v.digits) + ' to ' + nf(hi[i], v.digits)
            + ' ' + v.units, color: 'var(--band-inner)' });
        }
        if (line) rows.push({ k: cap(spec.lineLabel), v: nf(line[i], v.digits) + ' ' + v.units,
          color: f.p.series[0] });
        if (run) rows.push({ k: '31-day running mean', v: nf(run[i], v.digits) + ' ' + v.units,
          color: f.p.series[1] });
        return tipRows(at.d + ' ' + MONTH_NAME[at.m - 1] + ' ' + at.y, rows);
      }, i => {
        const at = dateAt(i);
        location.hash = at.y + '-' + pad2(at.m) + '-' + pad2(at.d);
      });
    };
  }

  /* The daily record runs to thousands of days, so its table gives each month: the mean (or the
     total) of its days, and its lowest and highest day. */
  function dailyRecordTable(key) {
    const v = VARS[key];
    const spec = dailyRecordSpec(v);
    const lowStat = spec.band ? spec.band[0] : spec.run;
    const highStat = spec.band ? spec.band[1] : spec.run;
    const rows = MONTHS.map(mo => {
      const mid = [], lows = [], highs = [];
      for (let i = mo.i0; i < mo.i0 + mo.n; i++) {
        if (spec.run && isNum(dayStat(key, spec.run, i))) mid.push(dayStat(key, spec.run, i));
        if (lowStat && isNum(dayStat(key, lowStat, i))) lows.push(dayStat(key, lowStat, i));
        if (highStat && isNum(dayStat(key, highStat, i))) highs.push(dayStat(key, highStat, i));
      }
      const middle = !mid.length ? null : v.agg === 'sum' ? mid.reduce((a, b) => a + b, 0)
        : meanOf(mid);
      return ['<a href="#' + mo.y + '-' + pad2(mo.m) + '">' + MONTH_ABBR[mo.m - 1] + ' ' + mo.y
        + '</a>', nf(middle, v.digits),
      { v: lows.length ? nf(Math.min.apply(null, lows), v.digits) : '–', cls: 'num-cold' },
      { v: highs.length ? nf(Math.max.apply(null, highs), v.digits) : '–', cls: 'num-warm' }];
    });
    return tableHTML(['Month', (v.agg === 'sum' ? 'Total of the days' : 'Mean of the days')
      + ' (' + v.units + ')', 'Lowest day (' + v.units + ')', 'Highest day (' + v.units + ')'],
    rows);
  }

  /* ---- Year by year ---------------------------------------------------------------------- */

  /** The spread of each year's half-hours, with the year's own figure where it is comparable. */
  function drawDistribution(key) {
    const v = VARS[key], R = recordOf(key);
    // A total and a half-hourly percentile differ by orders of magnitude, so a summed variable's
    // annual figure is left off this axis rather than put on a second one.
    const withValue = v.agg !== 'sum';
    return function (host) {
      const years = YEAR_ROWS.map(r => r.y);
      const yearly = withValue ? YEAR_ROWS.map(r => varValue(r, key)) : null;
      const f = frame(host, { aspect: 0.42,
        ariaLabel: 'Percentiles of the ' + R.basis + ' of ' + shortInText(v) + ', per year' });
      const ext = extent([R.q05, R.q95, yearly]);
      const pad = (ext[1] - ext[0]) * 0.06 || 1;
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0] - pad, ext[1] + pad, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: R.digits, yLabel: R.units, xTicks: yearTicksFor(years, f) });
      el('path', { d: areaFrom(years, R.q05, R.q95, sx, sy), fill: f.p.bandOuter, opacity: 0.8 },
        f.svg);
      el('path', { d: areaFrom(years, R.q25, R.q75, sx, sy), fill: f.p.bandInner, opacity: 0.9 },
        f.svg);
      el('path', { d: pathFrom(years, R.q50, sx, sy), fill: 'none', stroke: f.p.series[0],
        'stroke-width': 2 }, f.svg);
      years.forEach((y, i) => {
        if (isNum(R.q50[i])) el('circle', { cx: sx(y), cy: sy(R.q50[i]), r: 2.6, fill: f.p.series[0] }, f.svg);
      });
      if (yearly) {
        el('path', { d: pathFrom(years, yearly, sx, sy), fill: 'none', stroke: f.p.series[1],
          'stroke-width': 1.8, 'stroke-dasharray': '5 3' }, f.svg);
      }
      hover(f, sx, years, y => {
        const i = years.indexOf(y);
        const at = x => nf(x, R.digits) + ' ' + R.units;
        const rows = [
          { k: '5th to 95th percentile', v: at(R.q05[i]) + ' to ' + at(R.q95[i]),
            color: 'var(--band-outer)' },
          { k: '25th to 75th percentile', v: at(R.q25[i]) + ' to ' + at(R.q75[i]),
            color: 'var(--band-inner)' },
          { k: 'Median', v: at(R.q50[i]), color: f.p.series[0] }];
        if (yearly) rows.push({ k: 'Annual mean', v: at(yearly[i]), color: f.p.series[1] });
        return tipRows(String(y), rows);
      }, y => { location.hash = y + '-' + M.year_slug; });
    };
  }

  function distributionTable(key) {
    const v = VARS[key], R = recordOf(key);
    const u = ' (' + R.units + ')';
    return tableHTML(['Year', '5th' + u, '25th' + u, 'Median' + u, '75th' + u, '95th' + u]
      .concat(v.agg !== 'sum' ? ['Annual mean' + u] : []),
    YEAR_ROWS.map((r, i) => [yearLink(r.y), nf(R.q05[i], R.digits), nf(R.q25[i], R.digits),
      nf(R.q50[i], R.digits), nf(R.q75[i], R.digits), nf(R.q95[i], R.digits)]
      .concat(v.agg !== 'sum' ? [nf(varValue(r, key), R.digits)] : [])));
  }

  /** The last ten years against the earlier ones, as a small table of its own. */
  function recentCard(grid, key) {
    const v = VARS[key];
    const re = recentEarlier(key);
    const d = monthDigits(key);
    const body = cardEl(grid, { title: 'Recent against earlier years', width: 'w-5',
      sub: 'The mean ' + aggWord(v) + ' of the last ' + N_RECENT + ' years of this variable '
        + 'against all of its earlier years, over the years covered well enough to stand for the '
        + 'variable.',
      foot: 'The difference is given in per cent only where the earlier mean is at least the '
        + 'standard deviation of the annual values, measured against the size of that mean: '
        + 'nearer zero, a small change would read as a large percentage.' });
    if (!isNum(re.diff)) {
      body.innerHTML = '<p class="card-sub">' + re.missing + '.</p>';
      return;
    }
    const sensed = x => nf(x, d) + ' ' + v.units + (senseOf(v, x) ? ', ' + senseOf(v, x) : '');
    body.innerHTML = '<dl class="kv wide">'
      + '<dt>' + re.early[0] + '–' + re.early[1] + '</dt><dd>' + sensed(re.earlyMean) + ' ('
      + re.nEarly + ' years)</dd>'
      + '<dt>' + re.recent[0] + '–' + re.recent[1] + '</dt><dd>' + sensed(re.recentMean) + ' ('
      + re.nRecent + ' years)</dd>'
      + '<dt>Difference</dt><dd>' + nfs(re.diff, d) + ' ' + v.units
      + (isNum(re.pct) ? ', ' + nfs(re.pct, 1) + ' %' : ', no percentage stated') + '</dd>'
      + '<dt>Spread between years</dt><dd>' + (isNum(re.sd) ? nf(re.sd, d) + ' ' + v.units
        : '–') + ' (standard deviation)</dd></dl>';
  }

  /* ---- The annual cycle ------------------------------------------------------------------- */

  /**
   * Each calendar month's normal, the lowest and highest year of that month, and the measured
   * half-hourly record either side of it. The record is drawn for a variable that averages only:
   * the half-hour of a total is a different quantity from its monthly total and would sit on the
   * same axis as though it were comparable.
   */
  function drawClimRange(key) {
    const v = VARS[key], R = recordOf(key);
    const records = !!R && v.agg !== 'sum' && !R.rate;
    const d = monthDigits(key);
    return function (host) {
      const clim = CLIM[key] || {};
      const rows = MONTH_NAME.map((name, i) => ({ m: i + 1, n: clim[String(i + 1)] || null,
        lo: records ? R.clim_lo[i] : null, hi: records ? R.clim_hi[i] : null }));
      const step = 22;
      const left = textWidth(MONTH_ABBR, 'ax-text') + 14;
      const f = frame(host, { height: 12 * step + 46, margin: { top: 8, right: 16, bottom: 38,
        left: left }, ariaLabel: 'Normal, lowest and highest year of each calendar month, '
          + shortInText(v) });
      const ext = extent([rows.map(r => r.n && r.n.min), rows.map(r => r.n && r.n.max),
        rows.map(r => r.lo), rows.map(r => r.hi)]);
      const pad = (ext[1] - ext[0]) * 0.05 || 1;
      const sx = linear(ext[0] - pad, ext[1] + pad, f.m.left, f.m.left + f.iw);
      const ticks = niceTicks(ext[0] - pad, ext[1] + pad, Math.max(3, Math.floor(f.iw / 80)));
      const digits = tickDigits(ticks, v.digits);
      ticks.forEach(t => {
        const x = sx(t);
        if (x < f.m.left - 1 || x > f.m.left + f.iw + 1) return;
        el('line', { x1: x, x2: x, y1: f.m.top, y2: f.m.top + 12 * step, class: 'gridline' }, f.svg);
        svgText(f.svg, x, f.m.top + 12 * step + 16, nf(t, digits), 'ax-text',
          { 'text-anchor': 'middle' });
      });
      svgText(f.svg, f.m.left + f.iw / 2, f.height - 4, v.units, 'ax-title',
        { 'text-anchor': 'middle' });
      rows.forEach((row, i) => {
        const y = f.m.top + step * (i + 0.5);
        svgText(f.svg, f.m.left - 8, y + 4, MONTH_ABBR[i], 'ax-text', { 'text-anchor': 'end' });
        if (isNum(row.lo) && isNum(row.hi)) {
          el('line', { x1: sx(row.lo), x2: sx(row.hi), y1: y, y2: y, stroke: f.p.bandOuter,
            'stroke-width': 3, 'stroke-linecap': 'round' }, f.svg);
        }
        if (row.n) {
          el('rect', { x: sx(row.n.min), y: y - 6, width: Math.max(2, sx(row.n.max) - sx(row.n.min)),
            height: 12, rx: 4, fill: f.p.bandInner }, f.svg);
          el('circle', { cx: sx(row.n.mean), cy: y, r: 5, fill: f.p.series[0], stroke: f.p.surface,
            'stroke-width': 2 }, f.svg);
        }
        const hit = el('rect', { class: 'hit', x: f.m.left, y: y - step / 2, width: f.iw,
          height: step }, f.svg);
        hit.addEventListener('mousemove', ev => {
          const lines = row.n ? [
            { k: 'Normal', v: nf(row.n.mean, d) + ' ' + v.units + ' (' + row.n.n + ' years)',
              color: f.p.series[0] },
            { k: 'Lowest and highest year', v: nf(row.n.min, d) + ' in ' + row.n.min_year + ', '
              + nf(row.n.max, d) + ' in ' + row.n.max_year, color: 'var(--band-inner)' }]
            : [{ k: 'Normal', v: 'not enough years' }];
          if (isNum(row.lo)) {
            lines.push({ k: 'Measured half-hours', v: nf(row.lo, R.digits) + ' to '
              + nf(row.hi, R.digits) + ' ' + R.units, color: 'var(--band-outer)' });
          }
          tip.show(tipRows(MONTH_NAME[i], lines), ev.clientX, ev.clientY);
        });
        hit.addEventListener('mouseleave', tip.hide);
      });
    };
  }

  function climRangeTable(key) {
    const v = VARS[key], R = recordOf(key);
    const records = !!R && v.agg !== 'sum' && !R.rate;
    const d = monthDigits(key);
    const clim = CLIM[key] || {};
    return tableHTML(['Month', 'Normal (' + v.units + ')', 'SD (' + v.units + ')', 'Lowest year',
      'Highest year'].concat(records ? ['Lowest half-hour (' + R.units + ')',
      'Highest half-hour (' + R.units + ')'] : []),
    MONTH_NAME.map((name, i) => {
      const n = clim[String(i + 1)];
      return [name, n ? nf(n.mean, d) : '–', n ? nf(n.sd, d) : '–',
        n ? n.min_year + ' (' + nf(n.min, d) + ')' : '–',
        n ? n.max_year + ' (' + nf(n.max, d) + ')' : '–']
        .concat(records ? [{ v: nf(R.clim_lo[i], R.digits), cls: 'num-cold' },
          { v: nf(R.clim_hi[i], R.digits), cls: 'num-warm' }] : []);
    }));
  }

  /** One row per year and one column per calendar month, read off the month rows. */
  function yearMonthRows(key, pick) {
    return YEARS.map(y => ({ label: String(y), y: y,
      values: MONTH_ABBR.map((name, i) => {
        const mo = monthAt(y, i + 1);
        return mo ? pick(mo[key]) : null;
      }) }));
  }

  /* What each year-by-month surface shows. `value` is the month's own figure on the variable's
     own ramp, `anom` its departure from the calendar-month normal on the variable's departure
     poles, and `missing` the share of the month not measured, from nothing to all of it. */
  const YEAR_MONTH = {
    value: { pick: rec => (rec && isNum(rec.v) ? rec.v : null) },
    anom: { pick: rec => (rec && isNum(rec.a) ? rec.a : null) },
    missing: { pick: rec => (rec && isNum(rec.meas) ? 100 - rec.meas : null) }
  };

  function yearMonthColour(key, kind, values) {
    if (kind === 'missing') {
      const neutral = hex2rgb(token('--neutral-mid')), warm = hex2rgb(token('--pole-warm'));
      return { lo: 0, hi: 100, center: null,
        fill: x => css(rampRGB([neutral, warm], Math.max(0, Math.min(1, x / 100)))) };
    }
    if (kind === 'anom') {
      const sorted = values.map(Math.abs).sort((a, b) => a - b);
      return departureColour(key, sorted.length ? quantileOf(sorted, 0.95) : 1);
    }
    const ext = extent([values]);
    return surfaceColour(key, ext[0], ext[1]);
  }

  function drawYearMonth(key, kind) {
    const v = VARS[key];
    const d = kind === 'missing' ? 0 : monthDigits(key);
    const rows = yearMonthRows(key, YEAR_MONTH[kind].pick);
    const values = rows.reduce((all, r) => all.concat(r.values.filter(isNum)), []);
    const unit = kind === 'missing' ? '%' : v.units;
    const what = { value: 'monthly ' + aggWord(v), anom: 'departure from the calendar-month normal',
      missing: 'share not measured' }[kind];
    return function (host) {
      drawHeat({
        rows: rows, cols: MONTH_ABBR, rowHeight: 16, colour: yearMonthColour(key, kind, values),
        keyLabel: unit, ariaLabel: cap(what) + ' of ' + shortInText(v) + ' by year and month',
        format: x => (kind === 'anom' ? nfs(x, d) : nf(x, d)),
        tip: (r, c) => {
          const x = rows[r].values[c];
          const lines = [{ k: cap(what), v: isNum(x) ? (kind === 'anom' ? nfs(x, d) : nf(x, d))
            + ' ' + unit : 'no value' }];
          const sense = kind === 'anom' ? departureSense(v, x) : kind === 'value' ? senseOf(v, x)
            : null;
          if (sense) lines.push({ k: 'Direction', v: sense });
          return tipRows(MONTH_NAME[c] + ' ' + rows[r].y, lines);
        },
        onClick: (r, c) => { location.hash = rows[r].y + '-' + pad2(c + 1); }
      })(host);
    };
  }

  function yearMonthTable(key, kind) {
    const d = kind === 'missing' ? 0 : monthDigits(key);
    const rows = yearMonthRows(key, YEAR_MONTH[kind].pick);
    return tableHTML(['Year'].concat(MONTH_ABBR), rows.map(r => [yearLink(r.y)]
      .concat(r.values.map(x => (kind === 'anom' ? { v: nfs(x, d), cls: tone(x) } : nf(x, d))))));
  }

  /* ---- Threshold days and records --------------------------------------------------------- */

  /** Days of each year that set a new record against every measured day before them. */
  function drawNewRecords(key) {
    const v = VARS[key], R = recordOf(key);
    return function (host) {
      const years = YEAR_ROWS.map(r => r.y);
      const highs = R.rec_high, lows = R.rec_low;
      const f = frame(host, { aspect: 0.36,
        ariaLabel: 'Days setting a new record of ' + shortInText(v) + ', per year' });
      const top = Math.max(1, Math.max.apply(null, highs.concat(lows || []).filter(isNum)));
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(0, top * 1.1, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: 'days', xTicks: yearTicksFor(years, f) });
      const slot = f.iw / years.length;
      const bw = Math.max(2, (slot - 4) / (lows ? 2 : 1));
      years.forEach((y, i) => {
        [[highs, f.p.warm, 0], [lows, f.p.cold, 1]].forEach(([list, fill, k]) => {
          if (!list || !isNum(list[i])) return;
          const x0 = sx(y) - (lows ? bw : bw / 2) + k * bw;
          el('rect', { x: x0, y: sy(list[i]), width: bw - 1,
            height: Math.max(list[i] ? 1 : 0, sy(0) - sy(list[i])), fill: fill }, f.svg);
        });
      });
      hover(f, sx, years, y => {
        const i = years.indexOf(y);
        if (!isNum(highs[i])) return tipRows(String(y), [{ k: 'New records', v: 'not counted' }]);
        const rows = [{ k: 'New highs', v: highs[i] + ' days', color: f.p.warm }];
        if (lows) rows.push({ k: 'New lows', v: lows[i] + ' days', color: f.p.cold });
        return tipRows(String(y), rows);
      }, y => { location.hash = y + '-' + M.year_slug; });
    };
  }

  function newRecordsTable(key) {
    const R = recordOf(key);
    return tableHTML(['Year', 'New highs (days)'].concat(R.rec_low ? ['New lows (days)'] : []),
      YEAR_ROWS.map((r, i) => [yearLink(r.y), { v: isNum(R.rec_high[i]) ? R.rec_high[i] : '–',
        cls: 'num-warm' }].concat(R.rec_low ? [{ v: isNum(R.rec_low[i]) ? R.rec_low[i] : '–',
        cls: 'num-cold' }] : [])));
  }

  function renderVarRecords(key) {
    const host = document.getElementById('var-records');
    const R = recordOf(key);
    if (!host || !R || !R.rec_high || !R.rec_high.some(isNum)) return;
    const v = VARS[key];
    host.innerHTML = '<h2 class="section">New records</h2><div class="grid"></div>';
    chartCard(host.querySelector('.grid'), {
      title: 'Days setting a new record', width: 'w-12',
      sub: 'Days whose measured daily ' + (R.rec_low ? 'maximum or minimum' : 'maximum')
        + ' passed every measured day before them. Read forwards: a record is a record against '
        + 'what came before it. The first year with a measured day is left out, because by '
        + 'construction almost every day of it sets one.'
        + (R.rec_low ? '' : ' Only highs are counted: the low end of ' + shortInText(v)
          + ' is a floor the record reaches routinely.'),
      legend: [{ color: 'var(--pole-warm)', label: 'new record highs' }]
        .concat(R.rec_low ? [{ color: 'var(--pole-cold)', label: 'new record lows' }] : []),
      foot: 'Records necessarily thin out as the record grows, so a late year holding several is '
        + 'the notable case. From measured half-hours only; these complement the records for each '
        + 'calendar date, which compare a day only with the same date of other years.',
      draw: drawNewRecords(key), table: () => newRecordsTable(key)
    });
  }

  /* ---- Coverage and provenance ------------------------------------------------------------ */

  /* Colours for the codes of a source flag. A flag can carry eight codes, more than the page's
     four series colours, so the warm and cold steps follow them. */
  const CODE_COLOURS = ['--series-1', '--series-2', '--series-3', '--series-4', '--warm-2',
    '--cold-2', '--seq-6', '--warm-3', '--cold-1', '--seq-3'];

  /** The codes of a source flag that occur in at least one year, as indices into its lists. */
  const sourceUsed = S => S.codes.map((c, i) => i)
    .filter(i => S.shares.some(row => row && row[i] > 0));

  function drawSource(key) {
    const v = VARS[key], S = v.source;
    const used = sourceUsed(S);
    return function (host) {
      const years = YEAR_ROWS.map(r => r.y);
      const f = frame(host, { aspect: 0.32,
        ariaLabel: 'Share of each year of ' + shortInText(v) + ' by source' });
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(0, 100, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: '%', yTicks: [0, 25, 50, 75, 100],
        xTicks: yearTicksFor(years, f) });
      const bw = Math.max(3, f.iw / years.length - 5);
      years.forEach((y, i) => {
        const row = S.shares[i];
        if (!row) return;
        let base = 0;
        used.forEach((j, k) => {
          const p = row[j];
          if (!(p > 0)) return;
          const top = Math.min(100, base + p);
          el('rect', { x: sx(y) - bw / 2, y: sy(top), width: bw,
            height: Math.max(0.5, sy(base) - sy(top)),
            fill: token(CODE_COLOURS[k % CODE_COLOURS.length]) }, f.svg);
          base = top;
        });
      });
      hover(f, sx, years, y => {
        const row = S.shares[years.indexOf(y)];
        if (!row) return tipRows(String(y), [{ k: 'Source', v: 'not flagged in this year' }]);
        return tipRows(String(y), used.filter(j => row[j] > 0).map(j => ({
          k: esc(S.short[j]), v: nf(row[j], 1) + ' %',
          color: 'var(' + CODE_COLOURS[used.indexOf(j) % CODE_COLOURS.length] + ')' })));
      }, y => { location.hash = y + '-' + M.year_slug; });
    };
  }

  function sourceTable(key) {
    const S = VARS[key].source;
    const used = sourceUsed(S);
    return tableHTML(['Year'].concat(used.map(j => esc(S.short[j]) + ' (%)')),
      YEAR_ROWS.map((r, i) => [yearLink(r.y)].concat(used.map(j => (S.shares[i]
        ? nf(S.shares[i][j], 1) : '–')))));
  }

  /** The share of a span under each source code, in the words of the flag's short labels. */
  function sourcePhrase(v, rec) {
    const S = v.source;
    if (!S || !rec.src) return null;
    const parts = rec.src.map((p, j) => (p > 0 ? nf(p, 0) + ' % ' + esc(S.short[j]) : null))
      .filter(Boolean);
    if (!parts.length) return null;
    return '<span title="Source flag ' + esc(S.column) + '">source: ' + parts.join(', ')
      + '</span>';
  }

  function sourceCard(grid, key) {
    const v = VARS[key], S = v.source;
    if (!S || !S.shares.some(Boolean)) return;
    const used = sourceUsed(S);
    chartCard(grid, {
      title: 'Source per year', width: 'w-12',
      sub: 'Share of each year’s flagged records by the code of <code>' + esc(S.column)
        + '</code>, which names the sensor, record or calibration behind each value. It is '
        + 'independent of the fill flag and gates nothing.'
        + (S.reference_from ? ' The reference era, code ' + S.reference_code + ', begins on '
          + isoLabel(S.reference_from) + '.' : ''),
      legend: used.map((j, k) => ({ color: 'var(' + CODE_COLOURS[k % CODE_COLOURS.length] + ')',
        label: S.codes[j] + ': ' + esc(S.long[j]) })),
      foot: (S.codes.length > used.length ? 'Codes that never occur in these years are not '
        + 'drawn. ' : '') + 'A year split between two codes cannot be compared with an undivided '
        + 'one without knowing what separates the two.',
      draw: drawSource(key), table: () => sourceTable(key)
    });
  }

  /** The correction figures, and the correction by year. */
  function correctionCards(grid, key) {
    const v = VARS[key], C = v.correction;
    if (!C) return;
    const d = Math.max(3, v.digits + 2);
    const u = ' ' + v.units;
    const rows = [
      ['Uncorrected column', '<code>' + esc(C.column) + '</code>'],
      ['Records compared', C.n.toLocaleString('en-GB')],
      ['Records changed', C.n_changed.toLocaleString('en-GB') + ' ('
        + nf(100 * C.n_changed / C.n, 1) + ' %)'],
      ['Change, lowest to highest', nfs(C.min, d) + ' to ' + nfs(C.max, d) + u],
      ['Mean change', nfs(C.mean, d) + u],
      ['Distinct changes', C.distinct.toLocaleString('en-GB')]];
    if (C.reference_from) {
      rows.push(['Reference era from', isoLabel(C.reference_from) + ' (code ' + C.reference_code
        + ')']);
    }
    if (isNum(C.offset)) rows.push(['Constant offset before it', nfs(C.offset, d) + u]);
    const body = cardEl(grid, { title: 'Correction', width: 'w-6',
      sub: 'The series shown on this page minus its uncorrected twin, read back out of the file. '
        + 'The difference is exactly what the correction did.',
      foot: C.note ? noteHTML(C.note) : '' });
    body.innerHTML = '<dl class="kv wide">' + rows.map(r => '<dt>' + r[0] + '</dt><dd>' + r[1]
      + '</dd>').join('') + '</dl>'
      + (C.eras && C.eras.length ? tableHTML(['Source era', 'Records', 'Changed',
        'Mean (' + v.units + ')', 'Range (' + v.units + ')', 'Constant'],
      C.eras.map(e => [e.code + ': ' + esc(e.label), e.n.toLocaleString('en-GB'),
        e.n_changed.toLocaleString('en-GB'), nfs(e.mean, d), nfs(e.min, d) + ' to '
        + nfs(e.max, d), isNum(e.offset) ? nfs(e.offset, d) : 'no'])) : '');

    chartCard(grid, {
      title: 'Correction by year', width: 'w-6',
      sub: 'The mean change in each year, within the lowest and the highest change of that year.',
      legend: [{ color: 'var(--series-1)', label: 'mean change', line: true },
        { color: 'var(--band-outer)', label: 'lowest to highest change' }],
      draw: function (host) {
        const years = C.yearly.map(r => r.y);
        const f = frame(host, { aspect: 0.5, ariaLabel: 'Correction of ' + shortInText(v)
          + ' by year' });
        const ext = extent([C.yearly.map(r => r.min), C.yearly.map(r => r.max), [0]]);
        const pad = (ext[1] - ext[0]) * 0.08 || 1;
        const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
        const sy = linear(ext[0] - pad, ext[1] + pad, f.m.top + f.ih, f.m.top);
        drawAxes(f, sx, sy, { yDigits: d, yLabel: v.units, xTicks: yearTicksFor(years, f) });
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0), stroke: f.p.ink,
          'stroke-width': 1, opacity: 0.5 }, f.svg);
        el('path', { d: areaFrom(years, C.yearly.map(r => r.min), C.yearly.map(r => r.max), sx, sy),
          fill: f.p.bandOuter, opacity: 0.8 }, f.svg);
        el('path', { d: pathFrom(years, C.yearly.map(r => r.mean), sx, sy), fill: 'none',
          stroke: f.p.series[0], 'stroke-width': 2 }, f.svg);
        hover(f, sx, years, y => {
          const r = C.yearly[years.indexOf(y)];
          return tipRows(String(y), [
            { k: 'Mean change', v: nfs(r.mean, d) + u, color: f.p.series[0] },
            { k: 'Lowest to highest', v: nfs(r.min, d) + ' to ' + nfs(r.max, d) + u,
              color: 'var(--band-outer)' },
            { k: 'Records', v: r.n.toLocaleString('en-GB') }]);
        }, y => { location.hash = y + '-' + M.year_slug; });
      },
      table: () => tableHTML(['Year', 'Mean change (' + v.units + ')', 'Lowest (' + v.units + ')',
        'Highest (' + v.units + ')', 'Records'],
      C.yearly.map(r => [yearLink(r.y), nfs(r.mean, d), nfs(r.min, d), nfs(r.max, d),
        r.n.toLocaleString('en-GB')]))
    });
  }

  /* ---- The reference station -------------------------------------------------------------- */

  function drawResidual(key) {
    const v = VARS[key], R = DATA.reference.vars[key];
    return function (host) {
      const xs = R.months.map((m, i) => i);
      const f = frame(host, { aspect: 0.4, margin: { right: 18 },
        ariaLabel: 'Residual of ' + shortInText(v) + ' against the reference station' });
      const ext = extent(R.series.map(s => s.values).concat(R.series.map(s => s.smooth)));
      const pad = (ext[1] - ext[0]) * 0.06 || 1;
      const sx = linear(0, Math.max(1, xs.length - 1), f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0] - pad, ext[1] + pad, f.m.top + f.ih, f.m.top);
      const starts = xs.filter(i => R.months[i].slice(5) === '01');
      const every = Math.max(1, Math.ceil(starts.length / Math.max(3, Math.floor(f.iw / 54))));
      drawAxes(f, sx, sy, { yDigits: v.digits + 1, yLabel: v.units,
        xTicks: starts.filter((i, k) => k % every === 0)
          .map(i => ({ v: i, label: R.months[i].slice(0, 4) })) });
      if (ext[0] - pad < 0 && ext[1] + pad > 0) {
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0), stroke: f.p.ink,
          'stroke-width': 1, opacity: 0.4 }, f.svg);
      }
      const at = R.break_year ? R.months.indexOf(R.break_year + '-01') : -1;
      if (at >= 0) {
        el('line', { x1: sx(at), x2: sx(at), y1: f.m.top, y2: f.m.top + f.ih, stroke: f.p.ink,
          'stroke-width': 1.2, 'stroke-dasharray': '4 3' }, f.svg);
        svgText(f.svg, sx(at) + 4, f.m.top + 12, 'hardware change ' + R.break_year, 'ax-text',
          { 'text-anchor': 'start' });
      }
      R.series.forEach((s, k) => {
        el('path', { d: pathFrom(xs, s.values, sx, sy), fill: 'none', stroke: f.p.series[k],
          'stroke-width': 0.8, opacity: 0.4 }, f.svg);
        el('path', { d: pathFrom(xs, s.smooth, sx, sy), fill: 'none', stroke: f.p.series[k],
          'stroke-width': 2.4, 'stroke-linejoin': 'round' }, f.svg);
      });
      hover(f, sx, xs, i => {
        const p = R.months[i].split('-');
        const rows = [];
        R.series.forEach((s, k) => {
          rows.push({ k: cap(s.label) + ', monthly mean', v: isNum(s.values[i])
            ? nfs(s.values[i], v.digits + 1) + ' ' + v.units : 'no overlap', color: f.p.series[k] });
          rows.push({ k: cap(s.label) + ', 12-month median', v: nfs(s.smooth[i], v.digits + 1)
            + ' ' + v.units });
        });
        return tipRows(MONTH_NAME[+p[1] - 1] + ' ' + p[0], rows);
      }, i => { location.hash = R.months[i]; });
    };
  }

  function residualTable(key) {
    const v = VARS[key], R = DATA.reference.vars[key];
    const d = v.digits + 1;
    const split = R.series.length > 1;
    return tableHTML(['Year', 'Mean residual (' + v.units + ')']
      .concat(split ? ['Night (' + v.units + ')', 'Day (' + v.units + ')'] : [])
      .concat(['SD (' + v.units + ')', 'Overlapping half-hours']),
    R.yearly.map(r => [yearLink(r.y), nfs(r.mean, d)]
      .concat(split ? [nfs(r.night, d), nfs(r.day, d)] : [])
      .concat([nf(r.sd, d), r.n.toLocaleString('en-GB')])));
  }

  function referenceCards(grid, key) {
    const RF = DATA.reference;
    const R = RF && RF.vars ? RF.vars[key] : null;
    if (!R) return;
    const v = VARS[key];
    const station = esc(RF.station);
    const where = [isNum(RF.distance_km) ? nf(RF.distance_km, 1) + ' km from the site' : null,
      isNum(RF.elevation_m) ? 'at ' + nf(RF.elevation_m, 0) + ' m a.s.l.' : null]
      .filter(Boolean).join(' ');
    if (R.withheld) {
      cardEl(grid, { title: 'Residual against ' + station, width: 'w-12' }).innerHTML =
        '<p class="card-sub">Not drawn: ' + esc(R.withheld) + '. The column compared is <code>'
        + esc(R.column) + '</code>.</p>';
      return;
    }
    const d = v.digits + 1;
    chartCard(grid, {
      title: 'Residual against ' + station, width: R.steps ? 'w-8' : 'w-12',
      sub: 'Measured half-hours of ' + shortInText(v) + ' minus <code>' + esc(R.column)
        + '</code> of ' + station + (where ? ', ' + where : '') + '. A station run by another '
        + 'institution takes the weather out of the difference and leaves the instruments. Where '
        + 'the two stand at different heights a constant offset is expected; what the chart shows '
        + 'is whether it stayed constant.'
        + (R.split ? ' Night and day are split by the position of the sun at the site.' : ''),
      legend: R.series.map((s, k) => ({ color: 'var(--series-' + (k + 1) + ')',
        label: s.label + ': monthly mean (thin), 12-month rolling median (thick)', line: true })),
      foot: R.n.toLocaleString('en-GB') + ' overlapping measured half-hours, '
        + isoLabel(R.start) + ' to ' + isoLabel(R.stop) + '. r = ' + nf(R.r, 3)
        + ', mean residual ' + nfs(R.mean, d) + ' ± ' + nf(R.sd, d) + ' ' + v.units
        + ' (standard deviation).'
        + (R.shift ? ' The station’s stamps were moved by ' + nfs(R.shift, 0) + ' minutes onto '
          + 'the windows of the product.' : ''),
      draw: drawResidual(key), table: () => residualTable(key)
    });
    if (R.steps) {
      cardEl(grid, { title: 'Step across the hardware change', width: 'w-4',
        sub: 'The mean residual in the ' + R.step_years + ' years before ' + R.break_year
          + ' against the ' + R.step_years + ' years after it, the year of the change left out so '
          + 'an outage at the changeover sits in neither window.',
        foot: 'A step that remains in the product is part of the record as published.' })
        .innerHTML = tableHTML(['Window', 'Before (' + v.units + ')', 'After (' + v.units + ')',
          'Step (' + v.units + ')'],
        R.steps.map(s => [s.window, nfs(s.before, d), nfs(s.after, d),
          { v: nfs(s.step, d), cls: tone(s.step) }]));
    }
  }

  /* ---- Tables ----------------------------------------------------------------------------- */

  /** Everything on this page, per year, in one table. */
  function yearTable(key) {
    const v = VARS[key], R = recordOf(key);
    const d = monthDigits(key);
    const tests = FLAGS.filter(f => f.var === key);
    const columns = ['Year', cap(aggWord(v)) + ' (' + v.units + ')',
      'Departure (' + v.units + ')', 'Rank'];
    const cells = [r => nf(ofKey(r, key).v, d),
      r => ({ v: nfs(ofKey(r, key).a, d), cls: tone(ofKey(r, key).a) }),
      r => (isNum(ofKey(r, key).r) ? ofKey(r, key).r + ' of ' + ofKey(r, key).n : '–')];
    if (R) {
      columns.push('Measured low (' + R.units + ')', 'Measured high (' + R.units + ')');
      cells.push((r, i) => ({ v: nf(R.mmin[i], R.digits), cls: 'num-cold' }),
        (r, i) => ({ v: nf(R.mmax[i], R.digits), cls: 'num-warm' }));
    }
    tests.forEach(f => {
      columns.push(cap(f.short) + ' days');
      cells.push(r => { const c = yearCount(r, f); return isNum(c) ? c : '–'; });
    });
    if (key === 'TA') {
      columns.push('Growing season (days)', 'Degree days (' + v.units + ' d)');
      cells.push(r => (r.x && isNum(r.x.gslen) ? r.x.gslen : '–'),
        r => (r.x && isNum(r.x.gdd) ? nf(r.x.gdd, 0) : '–'));
    }
    if (R) {
      columns.push('New highs');
      cells.push((r, i) => (isNum(R.rec_high[i]) ? R.rec_high[i] : '–'));
      if (R.rec_low) {
        columns.push('New lows');
        cells.push((r, i) => (isNum(R.rec_low[i]) ? R.rec_low[i] : '–'));
      }
    }
    columns.push('Not measured (%)');
    cells.push(r => (isNum(ofKey(r, key).meas) ? nf(100 - r[key].meas, 0) : '–'));
    if (R) {
      columns.push('Longest gap (h)');
      cells.push((r, i) => nf(R.gap_h[i], 1));
    }
    return tableHTML(columns, YEAR_ROWS.map((r, i) => [yearLink(r.y)].concat(cells.map(c => c(r, i)))));
  }

  /* ---- The section index ------------------------------------------------------------------ */

  const VAR_SECTIONS = [['vs-summary', 'Summary'], ['vs-record', 'Record'], ['vs-years', 'Years'],
    ['vs-seasons', 'Annual cycle'], ['vs-thresholds', 'Thresholds and extremes'],
    ['vs-coverage', 'Coverage'], ['vs-reference', 'Reference'], ['vs-tables', 'Tables']];
  let varObserver = null;

  /**
   * The index at the top of the variable page, one link per section that drew anything. A link
   * scrolls rather than navigates, since the address names the variable and not a place on its
   * page. Where the browser reports what is on screen, the section in view is marked.
   */
  function varNav(key) {
    const nav = document.getElementById('var-nav');
    VAR_SECTIONS.forEach(([id]) => {
      const node = document.getElementById(id);
      if (node) node.hidden = !node.querySelector('.card, .tiles');
    });
    const present = VAR_SECTIONS.filter(([id]) => {
      const node = document.getElementById(id);
      return node && !node.hidden;
    });
    nav.innerHTML = present.map(([id, label]) => '<a href="#var-' + key + '" data-target="' + id
      + '">' + label + '</a>').join('');
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const target = document.getElementById(a.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    if (varObserver) varObserver.disconnect();
    if (!('IntersectionObserver' in window)) return;
    varObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        nav.querySelectorAll('a').forEach(a => a.classList.toggle('active',
          a.dataset.target === e.target.id));
      });
    }, { rootMargin: '-120px 0px -65% 0px' });
    present.forEach(([id]) => varObserver.observe(document.getElementById(id)));
  }

  function renderVariable() {
    const key = state.variable;
    const v = VARS[key];
    const met = ownMetric(v);
    const R = recordOf(key);
    const host = document.getElementById('var-body');
    compactCharts();
    document.getElementById('var-title').textContent = v.title;

    const list = DATA.variables.map(x => x.key);
    const idx = list.indexOf(key);
    document.getElementById('var-prev').disabled = idx <= 0;
    document.getElementById('var-next').disabled = idx >= list.length - 1;

    // Each section is filled below, and hidden - with its entry in the index - where nothing in it
    // drew. The containers inside a section are filled by one part of the page each, and stay
    // empty where the build carries nothing for that part.
    host.innerHTML = '<p class="monthlede" id="var-lede"></p>'
      + '<nav class="sectionnav varnav" id="var-nav" aria-label="Sections of this page"></nav>'
      + '<section class="varsec" id="vs-summary"><div id="var-tiles"></div>'
      + '<div class="grid" id="var-summary"></div></section>'
      + '<section class="varsec" id="vs-record"><h2 class="section">The record</h2>'
      + '<div class="grid" id="var-record"></div><div id="var-hourly"></div></section>'
      + '<section class="varsec" id="vs-years"><h2 class="section">Year by year</h2>'
      + '<div class="grid" id="var-years"></div><div class="grid" id="var-months"></div></section>'
      + '<section class="varsec" id="vs-seasons"><h2 class="section">Annual cycle</h2>'
      + '<div class="grid" id="var-cycle"></div>'
      + (hasDaily(v) ? '<h2 class="section">Daily series</h2><div class="grid" id="var-daily">'
        + '</div>' : '')
      + '<div id="var-season"></div><div id="var-diurnal"></div></section>'
      + '<section class="varsec" id="vs-thresholds"><div id="var-thresholds"></div>'
      + '<div id="var-records"></div><div id="var-extremes"></div></section>'
      + '<section class="varsec" id="vs-coverage"><h2 class="section">Coverage and provenance</h2>'
      + '<div class="grid" id="var-cov"></div></section>'
      + '<section class="varsec" id="vs-reference"><h2 class="section">Reference station</h2>'
      + '<div class="grid" id="var-ref"></div></section>'
      + '<section class="varsec" id="vs-tables"><h2 class="section">Tables</h2>'
      + '<div class="grid" id="var-tables"></div></section>';

    document.getElementById('var-lede').innerHTML = v.about
      + ' ' + sourceOf(v) + ', ' + v.first_year + '–' + v.last_year + '.'
      + (M.primary && M.primary[key] ? ' Of the series of ' + key + ' in this build, this one ('
        + esc(M.primary[key]) + ') stands in for ' + key + ' in the badges, the composite and the '
        + 'grid.' : '');

    document.getElementById('var-tiles').innerHTML = varTiles(key);
    const summary = document.getElementById('var-summary');
    cardEl(summary, {
      title: 'Summary, ' + M.first_year + '–' + M.last_year, width: 'w-12',
      sub: 'The figures shown on the grid. Each span is stated as its '
        + (v.agg === 'sum' ? 'total' : 'mean') + '.'
    }).innerHTML = varSummary(key);
    varNotes(summary, key);

    // -- The record ---------------------------------------------------------------------------
    const rec = document.getElementById('var-record');
    if (YEAR_ROWS.some(r => isNum(ofKey(r, key).a))) {
      chartCard(rec, {
        title: 'Anomaly stripes', width: 'w-12',
        sub: 'Each year as a departure from the record’s annual ' + aggWord(v) + ', the year '
          + 'normal of the year panel. Colour is the only encoding; the values are in the table and '
          + 'on the annual chart below. Select a year to open it.',
        foot: 'The reference is the record itself. A year with no departure is one the record does '
          + 'not cover well enough to compare.',
        draw: drawStripes(key), table: () => stripesTable(key)
      });
    }
    const daily = dailyRecordSpec(v);
    if (daily.run) {
      chartCard(rec, {
        title: 'The daily record', width: 'w-12',
        sub: (daily.band ? cap(daily.bandLabel) + ' as a band, ' : '')
          + (daily.line ? 'the ' + daily.lineLabel + ' as a line, ' : '')
          + 'with a 31-day centred running mean of the ' + DAILY_STAT_WORD[daily.run]
          + '. Every day of the record is drawn, gap-filled days included. Select a day to open '
          + 'it.',
        legend: (daily.band ? [{ color: 'var(--band-inner)', label: daily.bandLabel }] : [])
          .concat(daily.line ? [{ color: 'var(--series-1)', label: daily.lineLabel, line: true }]
            : [])
          .concat([{ color: 'var(--series-2)', label: '31-day running mean', line: true }]),
        foot: 'The running mean needs ten days with a value in its window, so it breaks across a '
          + 'long gap rather than bridging it. The table gives each month.',
        draw: drawDailyRecord(key), table: () => dailyRecordTable(key)
      });
    }
    const band = yearBand(key);
    chartCard(rec, {
      title: 'Annual values', width: 'w-12',
      sub: 'One point per year' + (met && met.trend_year && met.trend_year.fit
        ? ', with the published Theil-Sen trend line' : '')
        + '. Select a year to open it.',
      legend: [{ color: 'var(--series-1)', label: 'annual value', line: true }]
        .concat(band ? [{ color: 'var(--band-outer)', label: band.label }] : [])
        .concat([{ color: 'var(--text-primary)', label: 'Theil-Sen trend', line: true }]),
      foot: [band ? band.note : '', met && met.trend_year ? trendSentence(met, met.trend_year) : '']
        .filter(Boolean).join(' '),
      draw: drawVarYears(key),
      table: () => tableHTML(['Year', cap(aggWord(v)) + ' (' + v.units + ')']
        .concat(band ? ['Band, ' + band.label.replace(/^± /, '') + ' (' + v.units + ')'] : [])
        .concat(['Rank', 'Measured (%)']),
      YEAR_ROWS.map((r, i) => [yearLink(r.y), nf(varValue(r, key), monthDigits(key))]
        .concat(band ? [isNum(band.half[i]) ? '± ' + nfu(band.half[i], monthDigits(key)) : '–']
          : [])
        .concat([isNum(ofKey(r, key).r) ? r[key].r + ' of ' + r[key].n : '–',
          nf(ofKey(r, key).meas, 0)])))
    });
    // A total is read as it builds up through the year as well as by what it came to.
    if (hasCumulative(v)) cumulativeCard(rec, v, YEARS[YEARS.length - 1], false);

    // -- Year by year ------------------------------------------------------------------------
    const yearsGrid = document.getElementById('var-years');
    if (R && R.q50 && R.q50.some(isNum)) {
      chartCard(yearsGrid, {
        title: 'Distribution per year', width: 'w-7',
        sub: 'Percentiles of the ' + R.basis + ' of each year, in ' + R.units + '. Bands moving '
          + 'together are a shift of the whole distribution; one edge moving alone is a change in '
          + 'the extremes only.'
          + (R.basis === 'half-hours above zero' ? ' Only the half-hours above zero are counted: '
            + 'most half-hours of ' + shortInText(v) + ' rest on zero, and their percentiles would '
            + 'be a column of zeros.' : ''),
        legend: [{ color: 'var(--band-outer)', label: '5th to 95th percentile' },
          { color: 'var(--band-inner)', label: '25th to 75th percentile' },
          { color: 'var(--series-1)', label: 'median', line: true }]
          .concat(v.agg !== 'sum' ? [{ color: 'var(--series-2)', label: 'annual mean (dashed)',
            line: true }] : []),
        foot: v.agg === 'sum' ? 'The annual total is a different quantity from a half-hourly '
          + 'percentile and is not drawn on this axis; it is on the annual chart above.'
          : 'Gap-filled half-hours are included, as in every other figure on this page.',
        draw: drawDistribution(key), table: () => distributionTable(key)
      });
    }
    recentCard(yearsGrid, key);

    const byMonth = document.getElementById('var-months');
    if (met) {
      chartCard(byMonth, {
        title: 'Trends by calendar month', width: 'w-7',
        sub: 'Slope per decade fitted to each calendar month separately, with its 95 % interval. '
          + 'Bars are solid where Kendall p is below ' + nf(TREND_ALPHA, 2) + '.',
        foot: 'The annual slope averages these twelve and can hide a change confined to some '
          + 'months, such as winters that have changed while summers have not.',
        draw: drawMonthlyTrends(key)
      });
      const table = monthlyTrendTable(key);
      if (table) {
        cardEl(byMonth, { title: 'Monthly trend statistics', width: 'w-5',
          sub: 'Withheld for a calendar month with fewer than ' + M.trend_min_years
            + ' complete years.' }).innerHTML = table;
      }
    }
    cardEl(byMonth, {
      title: 'Highest and lowest months', width: 'w-12',
      sub: 'The five highest and five lowest months of the record, with the departure from the '
        + 'calendar-month normal. Select a month to open it.'
    }).innerHTML = varMoments(key);

    // -- The annual cycle --------------------------------------------------------------------
    const cycle = document.getElementById('var-cycle');
    chartCard(cycle, {
      title: 'Mean annual cycle', width: 'w-7',
      sub: 'Normal of each calendar month, ±1 standard deviation, and the full range over the '
        + 'record.',
      legend: [{ color: 'var(--series-1)', label: 'normal', line: true },
        { color: 'var(--band-outer)', label: 'range across the record' }],
      draw: drawVarCycle(key), table: () => climRangeTable(key)
    });
    chartCard(cycle, {
      title: 'Climatology per calendar month', width: 'w-5',
      sub: 'Dot: the normal. Bar: the lowest to the highest year of that month.'
        + (R && v.agg !== 'sum' && !R.rate ? ' Line: the lowest and the highest measured '
          + 'half-hour of that month in the record.' : ''),
      legend: [{ color: 'var(--series-1)', label: 'normal' },
        { color: 'var(--band-inner)', label: 'lowest to highest year' }]
        .concat(R && v.agg !== 'sum' && !R.rate ? [{ color: 'var(--band-outer)',
          label: 'measured half-hours', line: true }] : []),
      foot: v.agg === 'sum' ? 'The half-hourly record is not drawn: a half-hour of a total is a '
        + 'different quantity from a monthly total.' : 'The half-hourly record lies outside the '
        + 'monthly means because it is a single half-hour.',
      draw: drawClimRange(key), table: () => climRangeTable(key)
    });
    if (MONTHS.some(mo => isNum(ofKey(mo, key).v))) {
      chartCard(cycle, {
        title: 'Monthly ' + aggWord(v) + ' by year and month', width: 'w-6',
        sub: 'The seasonal cycle dominates this surface; the anomaly beside it removes it. '
          + 'Select a month to open it.',
        draw: drawYearMonth(key, 'value'), table: () => yearMonthTable(key, 'value')
      });
    }
    if (MONTHS.some(mo => isNum(ofKey(mo, key).a))) {
      chartCard(cycle, {
        title: 'Monthly anomaly by year and month', width: 'w-6',
        sub: 'Each month minus the normal of its calendar month. The scale is symmetric about '
          + 'zero and saturates at the departure 95 % of months stay within, so a run of unusual '
          + 'months reads as a block. Select a month to open it.',
        foot: 'A month without a normal - one not covered well enough, or a calendar month with '
          + 'too few years - has no departure.',
        draw: drawYearMonth(key, 'anom'), table: () => yearMonthTable(key, 'anom')
      });
    }

    if (hasDaily(v)) {
      const dailyGrid = document.getElementById('var-daily');
      const stat = dailyStatOf(v);
      chartCard(dailyGrid, {
        title: 'Daily values by day of year', width: 'w-6',
        sub: 'One faint line per year on a day-of-year axis, over the ±' + M.clim_window
          + ' day normal band for each date.',
        legend: [
          { color: 'var(--band-outer)', label: 'normal 10th–90th percentile' },
          { color: 'var(--series-1)', label: 'one year', line: true },
          { color: 'var(--text-primary)', label: 'normal for the date', line: true }
        ],
        foot: 'Plotted by day of year, so the spread between years at each date is visible.',
        draw: drawVarDailyCycle(key),
        table: () => {
          const n = NORM[key][stat];
          const rows = [];
          for (let d = 1; d <= 365; d++) {
            const at = new Date(Date.UTC(2001, 0, d));
            rows.push([at.getUTCDate() + ' ' + MONTH_ABBR[at.getUTCMonth()], nf(n.mean[d], v.digits),
              nf(n.p10[d], v.digits), nf(n.p90[d], v.digits)]);
          }
          return tableHTML(['Date', 'Normal (' + v.units + ')', '10th percentile', '90th percentile'],
            rows);
        }
      });
      chartCard(dailyGrid, {
        title: 'Daily departures from the normal', width: 'w-6',
        sub: 'Each day of the record minus the normal for the same date, with a centred one-year '
          + 'running mean of the departures.',
        legend: [
          { color: 'var(--pole-warm)', label: 'above the normal for the date' },
          { color: 'var(--pole-cold)', label: 'below the normal for the date' },
          { color: 'var(--text-primary)', label: 'one-year running mean', line: true }
        ],
        foot: 'The running mean separates departures that persist for years from those that last '
          + 'weeks. Select a point to open its year.',
        draw: drawVarDailyDeparture(key),
        table: () => tableHTML(['Year', 'Mean departure (' + v.units + ')', 'Days above',
          'Days below'], YEARS.map(y => {
          const dev = [];
          for (let i = Math.max(0, dayIndex(y, 1, 1)); i < Math.min(DAYS.n, dayIndex(y + 1, 1, 1)); i++) {
            const at = dateAt(i);
            const value = dayStat(key, stat, i), mid = NORM[key][stat].mean[doy365(at.y, at.m, at.d)];
            if (isNum(value) && isNum(mid)) dev.push(value - mid);
          }
          return [yearLink(y), dev.length ? { v: nfs(meanOf(dev), v.digits), cls: tone(meanOf(dev)) }
            : '–', dev.filter(x => x > 0).length, dev.filter(x => x < 0).length];
        }))
      });
    }

    // -- Coverage and provenance -------------------------------------------------------------
    /* Where the variable has a flag, the part of each bar above the measured share is split by how
       it was filled, in that flag's own convention, which the sub names. */
    const nee = partitionedFrom(v);
    const fillLegend = v.fill ? v.fill.levels.map((label, j) => ({ color: fillSwatch(j),
      label: nee ? nee + ' ' + label : label })) : [];
    /* A partitioning product is modelled in every half-hour, so its bars are not a measured share
       of its own: they are the share of the net flux it was partitioned from that was measured,
       and the card says so in its title, its text and its legend. */
    const covSub = nee
      ? v.short + ' is not measured: every value is modelled by partitioning the net ecosystem '
        + 'exchange ' + nee + '. Bars show the share of each year covered by the product and the '
        + 'share for which ' + nee + ' was measured rather than gap-filled. The remainder is split '
        + 'by how ' + v.fill.flag + ' states ' + nee + ' was filled; the flag follows '
        + v.fill.note + '. The dashed line is the warning threshold for this variable.'
      : v.partitioned && !v.fill
        ? v.short + ' is not measured: every value is modelled by partitioning the net ecosystem '
          + 'exchange. This build carries no flag for the net flux, so the bars show only the '
          + 'share of each year covered by the product.'
        : 'Share of each year covered by the product, and share measured rather than gap-filled. '
          + 'The dashed line is the warning threshold for this variable.'
          + (v.fill ? ' Above the measured share, the remainder is split by how ' + v.fill.flag
            + ' states it was filled; the flag follows ' + v.fill.note + '.' : '');
    const covLegend = [{ color: 'var(--band-outer)', label: 'available' }]
      .concat(v.partitioned && !v.fill ? []
        : [{ color: 'var(--series-1)', label: nee ? nee + ' measured' : 'measured' }])
      .concat(fillLegend, [{ color: 'var(--pole-warm)', label: 'warning line', line: true }]);
    const covGrid = document.getElementById('var-cov');
    chartCard(covGrid, {
      title: nee ? 'Coverage and share partitioned from measured net exchange, by year'
        : v.partitioned ? 'Coverage by year'
          : 'Coverage and measured share by year',
      width: 'w-12',
      sub: covSub,
      legend: covLegend,
      foot: 'Every statistic on this page is gated on availability; the measured share only '
        + 'raises a warning. Where the measured share itself trends through the record, part of '
        + 'a slope above may follow that trend rather than a change in the ecosystem.'
        + (R ? ' The longest gap is the longest run of half-hours not measured, counted in the '
          + 'year it starts in; a year interrupted by many short gaps differs from one with a '
          + 'single long outage.' : ''),
      draw: drawVarCoverage(key),
      table: () => tableHTML(['Year', 'Available (%)']
        .concat(v.partitioned && !v.fill ? [] : [(nee ? nee + ' measured' : 'Measured') + ' (%)'])
        .concat((v.fill ? v.fill.levels : []).map(label => cap(esc(label)) + ' (%)'))
        .concat(R ? ['Longest gap (h)'] : []),
      YEAR_ROWS.map((r, i) => {
        const rec2 = ofKey(r, key);
        return [yearLink(r.y), nf(rec2.avail, 0)]
          .concat(v.partitioned && !v.fill ? [] : [nf(rec2.meas, 0)])
          .concat((v.fill ? v.fill.levels : []).map((label, j) => nf((rec2.f || [])[j] || 0, 0)))
          .concat(R ? [nf(R.gap_h[i], 1)] : []);
      }))
    });
    if (!(v.partitioned && !v.fill) && MONTHS.some(mo => isNum(ofKey(mo, key).meas))) {
      chartCard(covGrid, {
        title: 'Missing share by year and month', width: 'w-12',
        sub: 'Share of each month not measured' + (nee ? ' (of ' + nee + ')' : '')
          + ': gap-filled or missing. It locates the outages behind the coverage chart. Select '
          + 'a month to open it.',
        foot: 'A month the record does not reach is drawn empty.',
        draw: drawYearMonth(key, 'missing'), table: () => yearMonthTable(key, 'missing')
      });
    }
    sourceCard(covGrid, key);
    correctionCards(covGrid, key);

    // -- The reference station ---------------------------------------------------------------
    referenceCards(document.getElementById('var-ref'), key);

    // -- Tables -------------------------------------------------------------------------------
    cardEl(document.getElementById('var-tables'), {
      title: 'Year by year', width: 'w-12',
      sub: 'Everything on this page, per year, in one table. Measured extremes and new records '
        + 'are from measured half-hours; the ' + aggWord(v) + ', the counts and the departures use '
        + 'the full series. A dash marks a year that cannot be counted.'
    }).innerHTML = yearTable(key);

    renderVarSeason(key);
    renderVarThresholds(key);
    renderVarRecords(key);
    renderVarExtremes(key);
    renderVarDiurnal(key);
    renderVarHourly(key);
    varNav(key);
  }

  /* ---- When the season runs: growing season on TA, carbon uptake period on NEE. -------------
     Fills #var-season from DATA.season_timing. */

  /* A folded day of the year (29 February shares 28 February's slot) as "21 Mar", read off an
     ordinary year because that is the year the folded numbering is. */
  function doyLabel(doy, long) {
    const at = new Date(Date.UTC(2001, 0, Math.round(doy)));
    return at.getUTCDate() + ' ' + (long ? MONTH_NAME : MONTH_ABBR)[at.getUTCMonth()];
  }

  /* "2016-04-03" as "3 April 2016", the form the season badges state a date in. */
  function isoLabel(iso) {
    const p = String(iso).split('-').map(Number);
    return p[2] + ' ' + MONTH_NAME[p[1] - 1] + ' ' + p[0];
  }

  /* The words a slope of each timing figure is read in. A start that moves to a smaller day of the
     year is an earlier start; a length that grows is a longer season. */
  const TIMING_WORDS = {
    start: ['earlier', 'later'], end: ['earlier', 'later'],
    length: ['shorter', 'longer'], days: ['fewer', 'more']
  };

  /* One timing slope in words: "6.7 days per decade earlier (95 % interval ...), Kendall p = ...". */
  function timingSlope(t, name) {
    if (!t) return 'not computed';
    if (!isNum(t.slope)) {
      return 'withheld: ' + t.n + ' complete year' + (t.n === 1 ? '' : 's') + ' of the '
        + M.trend_min_years + ' required';
    }
    const words = TIMING_WORDS[name];
    const size = Math.abs(+t.slope.toFixed(1));
    const sig = isNum(t.p) && t.p < TREND_ALPHA;
    return (size === 0 ? 'no change' : nf(size, 1) + ' days per decade '
      + (t.slope < 0 ? words[0] : words[1]))
      + ' (95 % interval ' + nfs(t.lo, 1) + ' to ' + nfs(t.hi, 1) + '), Kendall p = '
      + (isNum(t.p) ? nf(t.p, 3) : 'not defined') + (sig ? '' : ', not significant');
  }

  /* How far one year's figure sat from the record median, in the badges' own terms. */
  function timingDelta(row, name, unit) {
    const d = row.delta ? row.delta[name] : null;
    if (!isNum(d)) return '';
    const words = TIMING_WORDS[name];
    if (d === 0) return ', ' + (name === 'start' || name === 'end' ? 'the record median date'
      : 'the record median');
    return ', ' + Math.abs(d) + ' ' + unit + (Math.abs(d) === 1 ? '' : 's') + ' '
      + (d < 0 ? words[0] : words[1]) + ' than the record median';
  }

  /** One bar per year on a day-of-year axis: the growing season, or the uptake periods. */
  function drawSeasonTiming(key, T) {
    const v = VARS[key];
    const uptake = T.kind === 'uptake';
    return function (host) {
      const rows = T.years;
      const n = rows.length;
      const every = n > 32 ? 2 : 1;
      const labels = rows.map(row => String(row.y));
      const rowH = 16;
      const f0 = { top: 24, right: uptake ? 46 : 16, bottom: 30,
        left: Math.max(40, textWidth(labels, 'ax-text') + 14) };
      const f = frame(host, { height: f0.top + n * rowH + f0.bottom, margin: f0,
        ariaLabel: (uptake ? 'Carbon uptake period' : 'Growing season')
          + ' by year on a day-of-year axis' });
      const sx = linear(1, 366, f.m.left, f.m.left + f.iw);
      const rowY = i => f.m.top + i * rowH;
      const mid = i => rowY(i) + rowH / 2;
      const sy = linear(0, n, f.m.top, f.m.top + f.ih);
      drawAxes(f, sx, sy, { yTicks: [],
        xTicks: MONTH_START.map((doy, i) => ({ v: doy, label: MONTH_ABBR[i] }))
          .filter((t, i) => f.iw > 520 || i % 2 === 0) });
      MONTH_START.forEach(doy => {
        el('line', { x1: sx(doy), x2: sx(doy), y1: f.m.top, y2: f.m.top + f.ih,
          class: 'gridline' }, f.svg);
      });

      /* Where a bar ends. The growing season is dated to end on the first day out of it, so its
         bar stops where that day begins; an uptake period is dated to its last day inside, so its
         bar runs through that day. Either way a bar is as long as the length the page states. */
      const through = uptake ? 1 : 0;
      const colour = uptake ? 'var(--series-3)' : f.p.series[0];
      rows.forEach((row, i) => {
        if (i % every === 0) {
          svgText(f.svg, f.m.left - 8, mid(i) + 4, labels[i], 'ax-text', { 'text-anchor': 'end' });
        }
        // A year that is not complete is drawn, since its dates are real, but faintly: it is kept
        // out of the slopes, and a season dated beside a gap may be dated to the gap.
        const weight = row.complete ? 1 : 0.35;
        if (!isNum(row.start)) {
          svgText(f.svg, f.m.left + 6, mid(i) + 4, uptake ? 'no uptake period'
            : 'no growing season', 'ax-text', { opacity: 0.8 });
        } else if (uptake) {
          el('line', { x1: sx(row.start), x2: sx(row.end + through), y1: mid(i), y2: mid(i),
            stroke: colour, 'stroke-width': 1.2, opacity: 0.55 * weight }, f.svg);
          row.periods.forEach(p => {
            el('rect', { x: sx(p[0]), y: rowY(i) + 3,
              width: Math.max(1.5, sx(p[1] + through) - sx(p[0])), height: rowH - 6, rx: 2,
              fill: colour, opacity: 0.9 * weight }, f.svg);
          });
        } else {
          el('rect', { x: sx(row.start), y: rowY(i) + 3,
            width: Math.max(1.5, sx(row.end + through) - sx(row.start)), height: rowH - 6, rx: 2,
            fill: colour, opacity: 0.85 * weight }, f.svg);
        }
        if (uptake && i % every === 0) {
          svgText(f.svg, f.m.left + f.iw + 8, mid(i) + 4, String(row.days), 'ax-text',
            { opacity: weight === 1 ? 1 : 0.6 });
        }
      });
      if (uptake) {
        svgText(f.svg, f.m.left + f.iw + 8, f.m.top - 8, 'days', 'ax-text');
      }

      // The record medians, which are the dates the season badges measure against. Each label reads
      // away from the middle of the year, and turns back where it would run off the chart.
      const med = T.median || {};
      const marks = [['start', 0], ['end', through]].filter(([name]) => isNum(med[name]))
        .map(([name, shift]) => ({ name: name, x: sx(med[name] + shift) }));
      marks.forEach(mk => {
        el('line', { x1: mk.x, x2: mk.x, y1: f.m.top - 4, y2: f.m.top + f.ih, stroke: f.p.ink,
          'stroke-width': 1.2, 'stroke-dasharray': '2 3', opacity: 0.7 }, f.svg);
      });
      /* Where the two medians are close on a narrow chart their labels would run into each other,
         so they shorten until they do not: "median start 10 Mar", then "start 10 Mar", then the
         date alone. */
      // The column of uptake days has its own heading at the right, which a label must not reach.
      const edge = uptake ? f.m.left + f.iw + 4 : f.width;
      const place = words => marks.map(mk => {
        const text = words(mk.name) + doyLabel(med[mk.name]);
        const w = textWidth([text], 'ax-text');
        const left = mk.name === 'start' ? mk.x - 4 - w >= 0 : mk.x + 4 + w > edge;
        return { text: text, left: left, at: mk.x + (left ? -4 : 4),
          x0: left ? mk.x - 4 - w : mk.x + 4, x1: left ? mk.x - 4 : mk.x + 4 + w };
      });
      const clear = ls => ls.length < 2 || ls[0].x1 + 6 <= ls[1].x0 || ls[1].x1 + 6 <= ls[0].x0;
      let medLabels = place(name => 'median ' + name + ' ');
      if (!clear(medLabels)) medLabels = place(name => name + ' ');
      if (!clear(medLabels)) medLabels = place(() => '');
      medLabels.forEach(l => svgText(f.svg, l.at, f.m.top - 8, l.text, 'ax-text',
        { 'text-anchor': l.left ? 'end' : 'start' }));

      // The fitted slopes of the start and the end, drawn through the rows they were fitted on,
      // from the two endpoints the build published rather than a fit made here.
      const at = y => rows.findIndex(row => row.y === y);
      [['start', 0], ['end', through]].forEach(([name, shift]) => {
        const t = T.trend && T.trend[name];
        if (!t || !t.fit || at(t.y0) < 0 || at(t.y1) < 0) return;
        el('line', { x1: sx(t.fit[0] + shift), x2: sx(t.fit[1] + shift), y1: mid(at(t.y0)),
          y2: mid(at(t.y1)), stroke: f.p.ink, 'stroke-width': 1.8, 'stroke-dasharray': '6 4',
          opacity: isNum(t.p) && t.p < TREND_ALPHA ? 0.9 : 0.45 }, f.svg);
      });

      // Read by row rather than by column: the question under the cursor is which year.
      const band = el('rect', { x: f.m.left, width: f.iw, height: rowH, y: f.m.top,
        fill: f.p.ink, opacity: 0 }, f.svg);
      const hit = el('rect', { class: 'hit', x: f.m.left, y: f.m.top, width: f.iw, height: f.ih },
        f.svg);
      const rowAt = ev => {
        const box = f.svg.getBoundingClientRect();
        const py = (ev.clientY - box.top) * (f.height / (box.height || f.height));
        const i = Math.floor((py - f.m.top) / rowH);
        return Math.max(0, Math.min(n - 1, isFinite(i) ? i : 0));
      };
      hit.addEventListener('mousemove', ev => {
        const i = rowAt(ev);
        band.setAttribute('y', rowY(i));
        band.setAttribute('opacity', 0.06);
        tip.show(timingTip(v, T, rows[i]), ev.clientX, ev.clientY);
      });
      hit.addEventListener('mouseleave', () => { band.setAttribute('opacity', 0); tip.hide(); });
      hit.addEventListener('click', ev => { location.hash = rows[rowAt(ev)].y + '-' + M.year_slug; });
    };
  }

  /** What one year's row says, in the words the season badges and the sign convention use. */
  function timingTip(v, T, row) {
    const uptake = T.kind === 'uptake';
    const lines = [];
    if (!isNum(row.start)) {
      lines.push({ k: uptake ? 'Uptake period' : 'Growing season',
        v: 'none' });
    } else {
      lines.push({ k: uptake ? 'First uptake day' : 'Start', v: isoLabel(row.s)
        + timingDelta(row, 'start', 'day') });
      lines.push({ k: uptake ? 'Last uptake day' : 'End', v: isoLabel(row.e)
        + timingDelta(row, 'end', 'day') });
      lines.push({ k: uptake ? 'First to last' : 'Length', v: row.length + ' days'
        + timingDelta(row, 'length', 'day') });
    }
    if (uptake) {
      if (row.periods.length) {
        lines.push({ k: 'Uptake periods', v: row.periods.length + ', covering ' + row.inside
          + ' days' });
        row.periods.slice(0, 5).forEach(p => {
          lines.push({ k: '', v: doyLabel(p[0]) + ' – ' + doyLabel(p[1]), color: 'var(--series-3)' });
        });
        if (row.periods.length > 5) lines.push({ k: '', v: 'and ' + (row.periods.length - 5) + ' more' });
      }
      lines.push({ k: 'Days of net ' + (v.sign ? v.sign.low : 'uptake'), v: row.days
        + timingDelta(row, 'days', 'day') });
    }
    if (!row.complete) {
      lines.push({ rule: true, k: 'Not every month of this year is covered; excluded from the '
        + 'trends.' });
    }
    return tipRows(String(row.y), lines);
  }

  /** The medians and slopes as numbers, one row per timing figure. */
  function timingTable(T) {
    const uptake = T.kind === 'uptake';
    const names = uptake ? ['start', 'end', 'length', 'days'] : ['start', 'end', 'length'];
    const title = {
      start: uptake ? 'First uptake day' : 'Start', end: uptake ? 'Last uptake day' : 'End',
      length: uptake ? 'First to last, days' : 'Length, days', days: 'Uptake days'
    };
    const med = T.median || {};
    const rows = names.map(name => {
      const t = T.trend ? T.trend[name] : null;
      const has = t && isNum(t.slope);
      const sig = has && isNum(t.p) && t.p < TREND_ALPHA;
      const middle = !isNum(med[name]) ? '—'
        : (name === 'start' || name === 'end') ? doyLabel(med[name]) : nf(med[name], 0);
      return '<tr><th scope="row">' + title[name] + '</th><td>' + middle + '</td>'
        + '<td>' + (has ? nfs(t.slope, 1) : '—') + '</td>'
        + '<td>' + (has && isNum(t.lo) ? nfs(t.lo, 1) + ' to ' + nfs(t.hi, 1) : '—') + '</td>'
        + '<td>' + (has && isNum(t.p) ? nf(t.p, 3) + (sig ? ' *' : '') : '—') + '</td>'
        + '<td>' + (t ? t.n : 0) + '</td></tr>';
    });
    return '<div class="tablewrap"><table class="datatable"><thead><tr><th scope="col"></th>'
      + '<th scope="col">Median</th><th scope="col">Days / decade</th>'
      + '<th scope="col">95 % interval</th><th scope="col">Kendall p</th>'
      + '<th scope="col">Years</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function renderVarSeason(key) {
    const host = document.getElementById('var-season');
    const T = DATA.season_timing ? DATA.season_timing[key] : null;
    if (!host || !T || !T.years || !T.years.length) return;
    const v = VARS[key];
    const uptake = T.kind === 'uptake';
    host.innerHTML = '<div class="grid" style="margin-top:var(--gap)"></div>';
    const grid = host.firstChild;
    const tr = T.trend || {};
    const slopes = ['start', 'end', 'length'].concat(uptake ? ['days'] : []).map(name =>
      '<b>' + { start: uptake ? 'first uptake day' : 'start', end: uptake ? 'last uptake day' : 'end',
        length: uptake ? 'first to last' : 'length', days: 'uptake days' }[name] + '</b> '
      + timingSlope(tr[name], name));
    const none = uptake ? T.years.filter(row => !isNum(row.start)).map(row => row.y) : [];
    const partial = T.years.filter(row => !row.complete).map(row => row.y);
    const sign = v.sign || { low: 'uptake', high: 'release' };

    const sub = uptake
      ? 'One row per year. Each solid bar is an uptake period: at least ' + T.span
        + ' consecutive days on which the ' + T.window + '-day running mean of daily net exchange '
        + 'is below zero, so that the site is a net carbon sink. The thin line runs from the first '
        + 'to the last uptake day. The number at the right counts the days with a daily total of '
        + 'net ' + sign.low + '. Select a row to open its year.'
      : 'One bar per year from the start to the end of the growing season. The start is the '
        + 'first run of ' + T.span + ' days with a daily mean above ' + nf(T.base, 0) + ' '
        + T.units + '; the end is the first such run below it after 1 July. The season badges '
        + 'use the same dates. Select a row to open its year.';
    const foot = [
      'Trends: ' + slopes.join('; ') + '.',
      'The start and end trends show whether a change in length comes from an earlier start or '
        + 'a later end.',
      uptake ? 'At a managed site, uptake need not be continuous between the first and last '
        + 'uptake day. A cropland can be a net sink under a winter cereal in spring and under a '
        + 'catch crop in autumn, and a net source after harvest and tillage in between. A shift '
        + 'in either date can reflect a change in the crop rather than in the climate; read it '
        + 'together with the uptake periods and the count of uptake days. A period that crosses '
        + 'the turn of the year is split there, and each part is drawn in its own year.' : '',
      none.length ? 'No uptake period in ' + none.join(', ') + '.' : '',
      partial.length ? 'Years without full monthly coverage, drawn faintly and excluded from the '
        + 'trends: ' + partial.join(', ') + '.' : ''
    ].filter(Boolean).join(' ');

    chartCard(grid, {
      title: uptake ? 'Carbon uptake period by year' : 'Growing season by year', width: 'w-8',
      sub: sub,
      legend: [{ color: uptake ? 'var(--series-3)' : 'var(--series-1)',
        label: uptake ? 'uptake period (net ' + sign.low + ')' : 'growing season' }]
        .concat(uptake ? [{ color: 'var(--series-3)', label: 'first to last uptake day',
          line: true }] : [])
        .concat([{ color: 'var(--text-primary)', label: 'record median (dotted)', line: true },
          { color: 'var(--text-primary)', label: 'Theil-Sen trend of start and end (dashed)',
            line: true }]),
      foot: foot,
      draw: drawSeasonTiming(key, T)
    });
    cardEl(grid, {
      title: uptake ? 'Uptake period medians and trends' : 'Growing season medians and trends',
      width: 'w-4',
      sub: 'Medians over all years with a ' + (uptake ? 'period' : 'season')
        + '. Theil-Sen slopes over complete years, withheld below ' + M.trend_min_years
        + ' years. A negative slope of a date is a shift earlier in the year.'
    }).innerHTML = timingTable(T);
  }

  /* ---- Threshold days and the longest spell, year by year. ----------------------------------
     Fills #var-thresholds from the year rows' counts and spells. */

  /* The runs drawn beside a test other than its own. A dry spell is not a day test: it is the
     longest run of days that failed the wet-day test, which the build counts because a drought is
     the run a precipitation record is read for. It sits with the test it is the absence of. */
  const RUNS_BESIDE = { wet: [{ key: 'dry', label: 'longest run without a wet day',
    short: 'dry run' }] };

  /**
   * One day test's count in one year, or null where the year cannot be counted.
   *
   * A year is counted where enough of it carries the variable at all: the availability gate every
   * other statistic on the page reads. A year the instrument was absent for would otherwise enter
   * the line as a year with no frost, which is a statement about the weather it cannot support.
   */
  function yearCount(row, f) {
    const rec = row[f.var];
    if (!rec || !isNum(rec.avail) || rec.avail < cov(f.var).normal) return null;
    return isNum(row.c[f.key]) ? row.c[f.key] : null;
  }

  /** The runs a test is drawn with: its own longest spell, where the build defines one, and any
      run that belongs beside it. */
  function runsOf(f) {
    const has = k => YEAR_ROWS.some(row => row.sp && isNum(row.sp[k]));
    return (has(f.key) ? [{ key: f.key, label: 'longest consecutive run', short: 'run' }] : [])
      .concat((RUNS_BESIDE[f.key] || []).filter(run => has(run.key)));
  }

  const daysWord = n => n + (n === 1 ? ' day' : ' days');

  /** Years in running text: one, two or three by name, and more than that by how many. */
  function yearsNamed(list) {
    if (list.length > 3) return 'each of ' + list.length + ' years';
    return list.length === 1 ? String(list[0])
      : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  /**
   * What the count and the run of one test say together, as a sentence.
   *
   * The two are drawn side by side because they do not move together: a year can reach the highest
   * count of the record without ever holding the threshold for a week, and the sentence names both
   * years so a reader does not have to find that on the chart.
   */
  function thresholdSentence(counts, runs) {
    const years = YEAR_ROWS.map(row => row.y);
    const at = (values, want) => years.filter((y, i) => isNum(values[i]) && values[i] === want);
    const present = counts.filter(isNum);
    const most = Math.max.apply(null, present);
    const mostYears = at(counts, most);
    if (!runs) {
      const fewest = Math.min.apply(null, present);
      if (fewest === most) return 'Every counted year had ' + daysWord(most) + '.';
      const fewYears = at(counts, fewest);
      return 'The most, ' + daysWord(most) + ', came in ' + yearsNamed(mostYears) + '; '
        + (fewest === 0 ? fewYears.length + (fewYears.length === 1 ? ' year' : ' years')
          + ' had none.' : 'the fewest, ' + fewest + ', in ' + yearsNamed(fewYears) + '.');
    }
    const longest = Math.max.apply(null, runs.filter(isNum));
    const longYears = at(runs, longest);
    const one = mostYears.length === 1 && longYears.length === 1;
    if (one && mostYears[0] === longYears[0]) {
      return mostYears[0] + ' had both the most, ' + daysWord(most) + ', and the longest run, '
        + daysWord(longest) + '.';
    }
    const i = years.indexOf(mostYears[0]);
    const j = years.indexOf(longYears[0]);
    return 'The most, ' + daysWord(most) + ', came in ' + yearsNamed(mostYears)
      + (mostYears.length === 1 && isNum(runs[i]) ? ', whose longest run was '
        + daysWord(runs[i]) : '')
      + '; the longest run, ' + daysWord(longest) + ', in ' + yearsNamed(longYears)
      + (longYears.length === 1 && isNum(counts[j]) ? ', which had ' + counts[j] + ' in all' : '')
      + '.';
  }

  /** One test's count and runs across the years, on one axis of days. */
  function drawThreshold(f, counts, runs) {
    return function (host) {
      const years = YEAR_ROWS.map(row => row.y);
      const lines = [{ values: counts, label: 'days in the year' }].concat(runs);
      const fr = frame(host, { aspect: 0.5,
        ariaLabel: cap(f.label) + ' and longest run, by year' });
      const top = extent(lines.map(l => l.values))[1];
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, fr.m.left,
        fr.m.left + fr.iw);
      const sy = linear(0, Math.max(1, top) * 1.08, fr.m.top + fr.ih, fr.m.top);
      const every = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(fr.iw / 54))));
      drawAxes(fr, sx, sy, { yLabel: 'days', yTickCount: 4,
        yTicks: niceTicks(0, Math.max(1, top), 4).filter(t => t === Math.round(t)),
        xTicks: years.filter((y, i) => i % every === 0 || i === years.length - 1)
          .map(y => ({ v: y, label: String(y) })) });
      lines.forEach((line, k) => {
        const color = fr.p.series[k % fr.p.series.length];
        el('path', { d: pathFrom(years, line.values, sx, sy), fill: 'none', stroke: color,
          'stroke-width': k ? 1.8 : 2.2, 'stroke-dasharray': k ? '5 3' : null,
          'stroke-linejoin': 'round' }, fr.svg);
        years.forEach((y, i) => {
          if (!isNum(line.values[i])) return;
          el('circle', { cx: sx(y), cy: sy(line.values[i]), r: k ? 2.4 : 3, fill: color }, fr.svg);
        });
      });
      hover(fr, sx, years, y => {
        const i = years.indexOf(y);
        const rows = lines.map((line, k) => ({ k: cap(line.label),
          v: isNum(line.values[i]) ? daysWord(line.values[i]) : 'not counted',
          color: fr.p.series[k % fr.p.series.length] }));
        const rec = YEAR_ROWS[i][f.var];
        if (!isNum(counts[i])) {
          rows.push({ k: 'Available', v: (rec && isNum(rec.avail) ? nf(rec.avail, 0) + ' %'
            : 'none') + ' of the year' });
        }
        return tipRows(String(y), rows);
      }, y => { location.hash = y + '-' + M.year_slug; });
    };
  }

  /** The counts and runs as numbers, a row per year and a column per test drawn. */
  function thresholdTable(drawn) {
    const head = drawn.map(d => '<th scope="col">' + cap(d.f.short)
      + (d.runs.length ? ' <span class="muted">days · ' + d.runs.map(r => r.short).join(' · ')
        + '</span>' : '') + '</th>').join('');
    const body = YEAR_ROWS.map((row, i) => '<tr><th scope="row"><a href="#' + row.y + '-'
      + M.year_slug + '">' + row.y + '</a></th>' + drawn.map(d => '<td>'
      + (isNum(d.counts[i]) ? d.counts[i] : '—')
      + d.runs.map(r => ' <span class="muted">· ' + (isNum(r.values[i]) ? r.values[i] : '—')
        + '</span>').join('') + '</td>').join('') + '</tr>').join('');
    return '<div class="tablewrap"><table class="datatable"><thead><tr><th scope="col">Year</th>'
      + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderVarThresholds(key) {
    const host = document.getElementById('var-thresholds');
    if (!host) return;
    const tests = FLAGS.filter(f => f.var === key);
    if (!tests.length) return;

    const drawn = [];
    const never = [];
    tests.forEach(f => {
      const counts = YEAR_ROWS.map(row => yearCount(row, f));
      if (!counts.some(isNum)) return;
      const runs = runsOf(f).map(run => ({ key: run.key, label: run.label, short: run.short,
        values: YEAR_ROWS.map((row, i) => (isNum(counts[i]) && row.sp && isNum(row.sp[run.key])
          ? row.sp[run.key] : null)) }));
      if (!counts.some(c => isNum(c) && c > 0)) { never.push(f.short); return; }
      drawn.push({ f: f, counts: counts, runs: runs });
    });
    if (!drawn.length && !never.length) return;

    host.innerHTML = '<h2 class="section">Threshold days by year</h2>'
      + '<div class="grid" id="var-thresholds-grid"></div>';
    const grid = document.getElementById('var-thresholds-grid');
    const gate = nf(cov(key).normal, 0);
    drawn.forEach(d => {
      chartCard(grid, {
        title: cap(d.f.label), width: 'w-4',
        sub: 'Days per year that meet this threshold'
          + (d.runs.length ? ', and the longest run of consecutive days, counted within the '
            + 'calendar year (a run that crosses 1 January is split there)' : '')
          + '. Years less than ' + gate + ' % available are not counted.',
        legend: [{ color: 'var(--series-1)', label: 'days in the year', line: true }]
          .concat(d.runs.map((r, k) => ({ color: 'var(--series-' + (k + 2) + ')',
            label: r.label, line: true }))),
        foot: thresholdSentence(d.counts,
          (d.runs.find(r => r.key === d.f.key) || { values: null }).values),
        draw: drawThreshold(d.f, d.counts, d.runs)
      });
    });
    if (drawn.length) {
      cardEl(grid, {
        title: 'Threshold day counts by year', width: 'w-12',
        sub: 'Days per year that meet each threshold'
          + (drawn.some(d => d.runs.length) ? ', followed by the longest run where one is defined'
            : '') + '. A dash marks a year less than ' + gate + ' % available. Select a year to '
          + 'open it.',
        foot: drawn.some(d => d.runs.length)
          ? 'The count is how often the threshold was reached; the run is how long it was held. '
            + 'A high count can come from scattered days without a long run.' : ''
      }).innerHTML = thresholdTable(drawn);
    }
    if (never.length) {
      grid.insertAdjacentHTML('beforeend', '<p class="card-sub w-12" style="max-width:none">'
        + 'Not drawn because no counted year had such a day: ' + never.join(', ')
        + '.</p>');
    }
  }

  /* ---- The days and half-hours at either end. -------------------------------------------------
     Fills #var-extremes from DAYS and DATA.extreme_halfhours. */

  const DAILY_STAT_WORD = { mean: 'daily mean', sum: 'daily total', max: 'daily maximum',
    min: 'daily minimum' };

  /**
   * What each end of a list is called, in the registry's words for this variable.
   *
   * The same rule `varMoments` follows for the months. "Highest" NEE is the largest release, and
   * where every value listed at one end sits on the far side of zero the registry's word for that
   * end is false: at a site whose every measured half-hour of the top ten is an uptake, the highest
   * ten are its smallest uptakes, not its largest releases.
   */
  function endWords(v, high, low) {
    const all = (list, test) => list.length > 0 && list.every(x => isNum(x) && test(x));
    return {
      high: v.sign && all(high, x => x <= 0) ? 'smallest net ' + v.sign.low : v.word_high,
      low: v.sign && all(low, x => x >= 0) ? 'smallest net ' + v.sign.high : v.word_low
    };
  }

  const endHead = (side, count, noun, word) => cap(side) + ' ' + (NUMBER_WORD[count] || count)
    + ' ' + noun + (word ? ' <span class="muted">(' + word + ')</span>' : '');

  /**
   * The days at either end of a variable's record, by the daily statistic its own charts use.
   *
   * Only days measured to the share a day needs before it may set a record for its date are
   * ranked: a gap-filled day is a model result, and a model result cannot hold a record. The share
   * is compared in the rounded form the page carries, against the threshold the build states in
   * that form, so the browser admits exactly the days `date_record` admits.
   */
  function extremeDays(key) {
    const v = VARS[key];
    const EH = DATA.extreme_halfhours;
    const stat = dailyStatOf(v);
    const values = DAYS.series[key + '_' + stat];
    const meas = DAYS.meas[key];
    if (!EH || !values || !meas) return null;
    const days = [];
    for (let i = 0; i < DAYS.n; i++) {
      if (isNum(values[i]) && isNum(meas[i]) && meas[i] >= EH.day_meas_min) days.push(i);
    }
    const own = EH.vars[key] || {};
    const withLow = own.low_day !== false && days.length > 1;
    // Fewer qualifying days than two full lists would put one day at both ends.
    const k = Math.min(EH.n, withLow ? Math.floor(days.length / 2) : days.length);
    /* One end, or the bound it rests on. The daily series is shipped at the precision it is
       printed at, so two days that read alike compare equal, and where more of them reach the
       extreme than the list has room for, the list would be days picked by the calendar. */
    const end = sign => {
      const order = days.slice().sort((a, b) => sign * (values[b] - values[a]) || a - b);
      if (!order.length) return { list: [], tie: null };
      const extreme = values[order[0]];
      const reaching = order.filter(i => values[i] === extreme).length;
      return reaching > k ? { list: [], tie: { value: extreme, days: reaching } }
        : { list: order.slice(0, k), tie: null };
    };
    return { stat: stat, values: values, n: days.length, high: end(1),
      low: withLow ? end(-1) : null };
  }

  function dayItem(v, stat, values, i) {
    const at = dateAt(i);
    const value = values[i];
    const normal = dayNormal(v.key, stat, at.y, at.m, at.d);
    const sense = senseOf(v, value);
    return '<li><a href="#' + at.y + '-' + pad2(at.m) + '-' + pad2(at.d) + '">' + at.d + ' '
      + MONTH_NAME[at.m - 1] + ' ' + at.y + '</a> <b>' + nf(value, v.digits) + '</b> ' + v.units
      + (sense ? ', ' + sense : '')
      + (isNum(normal) ? ' (' + nfs(value - normal, v.digits) + ')' : '')
      + '</li>';
  }

  /** "2019-07-25T14:30" as the half-hour it opens: its date and the window it covers. */
  function halfhourAt(stamp) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(stamp);
    if (!m) return null;
    const start = +m[4] * 60 + +m[5];
    const end = start + 30;
    const clock = t => pad2(Math.floor(t / 60) % 24) + ':' + pad2(t % 60);
    return { y: +m[1], m: +m[2], d: +m[3], window: clock(start) + '–' + clock(end) };
  }

  function halfhourItem(v, own, row) {
    const at = halfhourAt(row[0]);
    if (!at || !isNum(row[1])) return '';
    const sense = senseOf(v, row[1]);
    return '<li><a href="#' + at.y + '-' + pad2(at.m) + '-' + pad2(at.d) + '">' + at.d + ' '
      + MONTH_ABBR[at.m - 1] + ' ' + at.y + ', ' + at.window + '</a> <b>'
      + nf(row[1], own.digits) + '</b> ' + own.units + (sense ? ', ' + sense : '') + '</li>';
  }

  /**
   * One end of a list as a card of its own: its entries, or the bound it rests on in their place.
   *
   * `end` is `{ items, word, tie }`, or null where the registry says this end of the variable is a
   * floor it rests on - zero rain, a night without sunshine - rather than anything a reader would
   * look for. Each list is a short column of short lines, so it gets a narrow card and the lists
   * sit side by side rather than spanning the page half empty.
   */
  function endCard(grid, side, noun, end, units, digits, sub) {
    if (!end) return;
    if (end.tie) {
      const value = nf(end.tie.value, digits) + ' ' + units;
      const days = end.tie.days.toLocaleString('en-GB') + ' days';
      cardEl(grid, { title: cap(side) + ' ' + noun, width: 'rank' }).innerHTML =
        '<p class="card-sub">'
        + (noun === 'days' ? days + ' reach ' + value
          : 'On ' + days + ' at least one half-hour reaches ' + value)
        + ', more than a list has room for. This end is a bound of the variable rather than an '
        + 'event and is not listed.</p>';
      return;
    }
    if (!end.items.length) return;
    cardEl(grid, { title: endHead(side, end.items.length, noun, end.word), width: 'rank',
      sub: sub }).innerHTML = '<ul class="ranklist">' + end.items.join('') + '</ul>';
  }

  function renderVarExtremes(key) {
    const host = document.getElementById('var-extremes');
    const EH = DATA.extreme_halfhours;
    if (!host || !EH) return;
    const v = VARS[key];
    const days = extremeDays(key);
    const own = (EH.vars || {})[key];
    const ties = (own && own.ties) || {};
    const halfhours = own && ((own.high && own.high.length) || ties.high) ? own : null;
    if (!(days && days.n) && !halfhours) return;

    host.innerHTML = '<h2 class="section">Highest and lowest days and half-hours</h2>'
      + '<div class="grid ranks' + (v.sign ? ' signed' : '')
      + '" id="var-extremes-grid"></div><p class="section-note"></p>';
    const grid = document.getElementById('var-extremes-grid');
    const rule = nf(EH.day_coverage, 0) + ' %';
    // What applies to every list is said once, under them, so each card is only its list.
    const notes = [];
    const floors = [];

    if (days && days.n) {
      const words = endWords(v, days.high.list.map(i => days.values[i]),
        days.low ? days.low.list.map(i => days.values[i]) : []);
      const end = (side, found) => (found ? { tie: found.tie, word: words[side],
        items: found.list.map(i => dayItem(v, days.stat, days.values, i)) } : null);
      const sub = 'By ' + DAILY_STAT_WORD[days.stat] + ', in ' + v.units + ', with the departure '
        + 'from the normal for the date.';
      endCard(grid, 'highest', 'days', end('high', days.high), v.units, v.digits, sub);
      endCard(grid, 'lowest', 'days', end('low', days.low), v.units, v.digits, sub);
      notes.push('Only days at least ' + rule + ' measured are ranked, the share a day needs to set '
        + 'a record for its date, since a gap-filled value cannot hold a record. '
        + days.n.toLocaleString('en-GB') + ' of the record’s ' + DAYS.n.toLocaleString('en-GB')
        + ' days qualify.');
      if (own && own.low_day === false) floors.push('days');
    }

    if (halfhours) {
      const high = halfhours.high || [];
      const low = halfhours.low || [];
      const words = endWords(v, high.map(row => row[1]), low.map(row => row[1]));
      const end = (side, rows) => (rows ? { tie: ties[side], word: words[side],
        items: rows.map(row => halfhourItem(v, halfhours, row)) } : null);
      const sub = 'Measured half-hours, in ' + halfhours.units + ', at most one per day.';
      endCard(grid, 'highest', 'half-hours', end('high', halfhours.high), halfhours.units,
        halfhours.digits, sub);
      endCard(grid, 'lowest', 'half-hours', end('low', halfhours.low), halfhours.units,
        halfhours.digits, sub);
      notes.push('Gap-filled half-hours are not ranked, and each day contributes at most one '
        + 'half-hour, so a single afternoon cannot fill a list. Times are the start and end of '
        + 'the averaging window, as stated in the file.');
      if (halfhours.rate) {
        notes.push('Half-hours are stated as the published rate, in ' + halfhours.units
          + ', not as the ' + v.units + ' one half-hour contributes to a total. Days and longer '
          + 'spans are in ' + v.units + '.');
      }
      if (!halfhours.low) floors.push('half-hours');
      if (!(days && days.n)) {
        notes.push('No day of the record is at least ' + rule + ' measured, so no day is ranked.');
      }
      if (halfhours.partitioned) {
        notes.push(v.short + ' is not measured but partitioned out of the net flux. A half-hour '
          + 'counts as measured where that net flux was measured, so these are partitioned values '
          + 'at observed half-hours, not observations.');
      }
    }
    if (floors.length) {
      notes.push('The lowest ' + floors.join(' and ') + ' are not listed: for this variable the low '
        + 'end is a floor reached by much of the record, not an event.');
    }
    notes.push('Select an entry to open its day.');
    host.querySelector('.section-note').innerHTML = notes.join(' ');

    /* Whether the gap-filled series stays inside what was measured. A value outside the measured
       range is a model result the instrument never recorded; where there is one, the page says
       where the series reaches and how often. */
    const R = recordOf(key);
    const inside = R && R.inside;
    if (inside && v.fill) {
      const range = (lo, hi) => nf(lo, R.digits) + ' to ' + nf(hi, R.digits) + ' ' + R.units;
      host.insertAdjacentHTML('beforeend', inside.ok
        ? '<p class="section-note">The gap-filled series stays inside the measured range, '
          + range(inside.mlo, inside.mhi) + '.</p>'
        : '<p class="callout warn">The gap-filled series reaches ' + range(inside.lo, inside.hi)
          + ', outside the measured range of ' + range(inside.mlo, inside.mhi) + ': '
          + (inside.n_over ? inside.n_over.toLocaleString('en-GB') + ' half-hour'
            + (inside.n_over === 1 ? '' : 's') + ' above it' : '')
          + (inside.n_over && inside.n_under ? ' and ' : '')
          + (inside.n_under ? inside.n_under.toLocaleString('en-GB') + ' half-hour'
            + (inside.n_under === 1 ? '' : 's') + ' below it' : '')
          + '. Those values are model results, not measurements.</p>');
    }
  }

  /* ---- Through the day: the month-by-hour surface and the mean day of each calendar month. ----
     Fills #var-diurnal from DATA.diurnal. */

  /* The month-by-hour surfaces, built in Python for every variable whatever the hourly arrays
     carry: for each year, the mean of each hour of the day in each calendar month, with the
     record's own surface and the 10th to 90th percentile of the years beside it. A variable that
     sums is stated as its mean total per hour. Stored as integers at a per-variable scale, flat in
     the order year, month, hour. Read through these accessors and nothing else, so the layout is
     decided in one place. */
  const surfaceOf = key => (DATA.diurnal && DATA.diurnal.vars[key]) || null;
  const surfaceKeys = () => DATA.variables.map(v => v.key).filter(k => surfaceOf(k));
  const surfaceDigits = s => Math.max(0, Math.round(Math.log10(s.scale)));
  const surfaceAt = (s, arr, i) => (arr[i] === null || arr[i] === undefined ? null
    : arr[i] / s.scale);

  /** One calendar month of the record's surface - `mean`, `lo` or `hi` - as twenty-four values. */
  function surfaceRecord(s, which, m) {
    const out = [];
    for (let h = 0; h < 24; h++) out.push(surfaceAt(s, s[which], (m - 1) * 24 + h));
    return out;
  }

  /** One month of one year, as twenty-four values; all missing outside the record. */
  function surfaceYear(s, y, m) {
    const i = y - DATA.diurnal.first_year;
    const out = [];
    for (let h = 0; h < 24; h++) {
      out.push(i < 0 || i >= DATA.diurnal.n_years ? null
        : surfaceAt(s, s.values, (i * 12 + m - 1) * 24 + h));
    }
    return out;
  }

  /** How many years carry a value for one hour of one calendar month. */
  function surfaceYears(s, m, h) {
    let n = 0;
    for (let i = 0; i < DATA.diurnal.n_years; i++) {
      if (isNum(surfaceAt(s, s.values, (i * 12 + m - 1) * 24 + h))) n += 1;
    }
    return n;
  }

  /** The calendar months a span is made of, as [year, month]; a season's may start a year early. */
  function spanMonths(mo) {
    if (state.scale === 'season') return mo.months;
    if (state.scale === 'year') return MONTH_NAME.map((name, i) => [mo.y, i + 1]);
    return [[mo.y, mo.m]];
  }
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  /**
   * A span's mean day and the record's, from the surfaces: each hour is the mean over the span's
   * months weighted by their days, which is the mean over every day of the span. A month enters an
   * hour only where both it and the record carry that hour, so the two lines are always averages
   * over the same months.
   */
  function spanSurface(key, mo) {
    const s = surfaceOf(key);
    if (!s) return null;
    const months = spanMonths(mo);
    const values = [], record = [];
    for (let h = 0; h < 24; h++) {
      let sv = 0, sr = 0, w = 0;
      months.forEach(ym => {
        const x = surfaceYear(s, ym[0], ym[1])[h];
        const r = surfaceAt(s, s.mean, (ym[1] - 1) * 24 + h);
        if (!isNum(x) || !isNum(r)) return;
        const d = daysIn(ym[0], ym[1]);
        sv += x * d; sr += r * d; w += d;
      });
      values.push(w ? sv / w : null);
      record.push(w ? sr / w : null);
    }
    return values.some(isNum) ? { values: values, record: record } : null;
  }

  const hourSpan = h => String(h).padStart(2, '0') + ':00–' + String(h + 1).padStart(2, '0')
    + ':00';
  const clampIndex = (x, n) => (Number.isFinite(x) ? Math.min(n - 1, Math.max(0, Math.floor(x)))
    : (x > 0 ? n - 1 : 0));

  /**
   * The colour of the record's surface. Where the variable's own metric diverges about zero - the
   * net exchange - the surface does too, green uptake and red release as everywhere on the page;
   * everything else runs from the low end of the surface to the high end on its own metric's
   * ramp, so a surface reads in the colours the grid gives the same variable.
   */
  function surfaceColour(key, lo, hi) {
    const met = ownMetric(VARS[key]);
    const neutral = hex2rgb(token('--neutral-mid'));
    if (met && met.scale === 'div' && met.center === 0) {
      const absmax = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      const neg = hex2rgb(token(met.poles[0])), pos = hex2rgb(token(met.poles[1]));
      return { lo: -absmax, hi: absmax, center: 0,
        fill: x => css(rampRGB([neutral, x < 0 ? neg : pos], Math.abs(x) / absmax)) };
    }
    const stops = (met && met.scale === 'div' ? [met.poles[0], '--neutral-mid', met.poles[1]]
      : met && met.stops && met.stops.length ? met.stops : ['--neutral-mid', '--series-1'])
      .map(t => hex2rgb(token(t)));
    return { lo: lo, hi: hi, center: null,
      fill: x => css(rampRGB(stops, (x - lo) / ((hi - lo) || 1))) };
  }

  /* The two poles of a departure. A variable's own anomaly metric is where the page has already
     said what its departures look like - cold and warm, dry and wet, uptake and release - and a
     variable without one takes the page's two generic series colours rather than borrowing the
     temperature poles for a quantity that has no warm side. */
  function departurePoles(key) {
    const anom = DATA.metrics.find(x => x.var === key && x.scale === 'div'
      && (x.field === 'anom' || x.field === 'pctn'));
    if (anom) return anom.poles;
    const met = ownMetric(VARS[key]);
    if (met && met.scale === 'div') return met.poles;
    return ['--series-1', '--series-2'];
  }

  function departureColour(key, spread) {
    const absmax = spread || 1;
    const poles = departurePoles(key).map(t => hex2rgb(token(t)));
    const neutral = hex2rgb(token('--neutral-mid'));
    return { lo: -absmax, hi: absmax, center: 0,
      fill: x => css(rampRGB([neutral, poles[x < 0 ? 0 : 1]], Math.abs(x) / absmax)) };
  }

  /** Which way a departure of a signed variable moved: toward uptake, or toward release. */
  const departureSense = (v, d) => (v.sign && isNum(d) && d !== 0
    ? 'toward ' + (d < 0 ? v.sign.low : v.sign.high) : null);

  /**
   * Rows of twenty-four hours, one coloured cell per hour, with a colour key beneath.
   *
   * `rows` is [{label, values}], `colour` what `surfaceColour` or `departureColour` returns, and
   * `tip(row, hour)` the tooltip of one cell. The cell under the cursor is outlined, and a missing
   * value is drawn as a faint empty cell rather than left out, so a gap reads as a gap.
   */
  function drawHeat(spec) {
    return function (host) {
      const rows = spec.rows;
      // Twenty-four hours unless the caller names its own columns, as the year-by-month surfaces do.
      const cols = spec.cols ? spec.cols.length : 24;
      const width = Math.max(260, host.clientWidth || 640);
      const left = textWidth(rows.map(r => r.label), 'ax-text') + 12;
      const m = { top: 6, right: 14, bottom: 62, left: left };
      const cw = (width - m.left - m.right) / cols;
      const rh = spec.rowHeight || Math.max(14, Math.min(26, cw * 0.62));
      const f = frame(host, { height: Math.round(m.top + m.bottom + rh * rows.length), margin: m,
        ariaLabel: spec.ariaLabel });
      // How many rows the surface holds, stated on the element so a reader of the page - and the
      // tests - can tell a month's single row from a year's twelve without counting cells.
      f.svg.setAttribute('data-rows', rows.length);
      const gap = cw > 10 ? 1 : 0;
      rows.forEach((row, i) => {
        const y = m.top + i * rh;
        svgText(f.svg, m.left - 8, y + rh / 2 + 4, row.label, 'ax-text', { 'text-anchor': 'end' });
        row.values.forEach((x, h) => {
          el('rect', { x: m.left + h * cw, y: y, width: Math.max(1, cw - gap),
            height: Math.max(1, rh - gap), fill: isNum(x) ? spec.colour.fill(x) : f.p.grid,
            opacity: isNum(x) ? 1 : 0.45 }, f.svg);
        });
      });
      const base = m.top + rh * rows.length;
      if (spec.cols) {
        // Named columns are labelled at their middles, every one that fits.
        const every = Math.max(1, Math.ceil(cols / Math.max(2, Math.floor(cols * cw / 34))));
        spec.cols.forEach((label, c) => {
          if (c % every) return;
          svgText(f.svg, m.left + (c + 0.5) * cw, base + 16, label, 'ax-text',
            { 'text-anchor': 'middle' });
        });
      } else {
        [0, 3, 6, 9, 12, 15, 18, 21, 24].forEach(h => {
          const x = m.left + h * cw;
          el('line', { x1: x, x2: x, y1: base, y2: base + 4, class: 'ax-line' }, f.svg);
          // The last label ends at its tick rather than centring on it, which would run it past
          // the right edge of the chart in any face wider than the page's own.
          if (h % 6 === 0) {
            svgText(f.svg, x, base + 16, String(h).padStart(2, '0') + ':00', 'ax-text',
              { 'text-anchor': h === 24 ? 'end' : 'middle' });
          }
        });
      }

      // The key: the ramp from one end of the scale to the other, with its ends and its centre.
      const c = spec.colour;
      const kw = Math.min(260, cols * cw), kx = m.left, ky = base + 28, steps = 48;
      for (let k = 0; k < steps; k++) {
        const x = c.lo + (c.hi - c.lo) * (k + 0.5) / steps;
        el('rect', { x: kx + k * kw / steps, y: ky, width: kw / steps + 0.5, height: 8,
          fill: c.fill(x) }, f.svg);
      }
      const label = x => spec.format(x);
      svgText(f.svg, kx, ky + 21, label(c.lo), 'ax-text', { 'text-anchor': 'start' });
      svgText(f.svg, kx + kw, ky + 21, label(c.hi), 'ax-text', { 'text-anchor': 'end' });
      if (isNum(c.center)) {
        svgText(f.svg, kx + kw / 2, ky + 21, label(c.center), 'ax-text',
          { 'text-anchor': 'middle' });
      }
      // The unit beside the key, where there is room for it; a facet states it in its own title.
      if (spec.keyLabel) {
        const room = f.width - (kx + kw + 10) - 4;
        if (room > 40) {
          trimText(svgText(f.svg, kx + kw + 10, ky + 8, spec.keyLabel, 'ax-text',
            { 'text-anchor': 'start' }), room, spec.keyLabel);
        }
      }

      const mark = el('rect', { fill: 'none', stroke: f.p.ink, 'stroke-width': 1.5, opacity: 0,
        width: cw, height: rh, 'pointer-events': 'none' }, f.svg);
      const hit = el('rect', { class: 'hit', x: m.left, y: m.top, width: cols * cw,
        height: rh * rows.length }, f.svg);
      hit.addEventListener('mousemove', ev => {
        const box = f.svg.getBoundingClientRect();
        const k = f.width / box.width;
        const r = clampIndex(((ev.clientY - box.top) * k - m.top) / rh, rows.length);
        const h = clampIndex(((ev.clientX - box.left) * k - m.left) / cw, cols);
        mark.setAttribute('x', m.left + h * cw);
        mark.setAttribute('y', m.top + r * rh);
        mark.setAttribute('opacity', 1);
        tip.show(spec.tip(r, h), ev.clientX, ev.clientY);
      });
      hit.addEventListener('mouseleave', () => { mark.setAttribute('opacity', 0); tip.hide(); });
      if (spec.onClick) {
        hit.addEventListener('click', ev => {
          const box = f.svg.getBoundingClientRect();
          const k = f.width / box.width;
          spec.onClick(clampIndex(((ev.clientY - box.top) * k - m.top) / rh, rows.length),
            clampIndex(((ev.clientX - box.left) * k - m.left) / cw, cols));
        });
      }
    };
  }

  /** The record's surface of one variable: calendar months down, hours of the day across. */
  function drawVarSurface(key) {
    const v = VARS[key], s = surfaceOf(key);
    const digits = surfaceDigits(s);
    const rows = MONTH_ABBR.map((label, i) => ({ label: label,
      values: surfaceRecord(s, 'mean', i + 1) }));
    const ext = extent(rows.map(r => r.values));
    const colour = () => surfaceColour(key, ext[0], ext[1]);
    return function (host) {
      drawHeat({
        rows: rows, colour: colour(), keyLabel: s.units,
        ariaLabel: v.short + ', record mean by calendar month and hour of day',
        format: x => nf(x, digits),
        tip: (r, h) => {
          const x = rows[r].values[h];
          const lines = [{ k: 'Record mean', v: isNum(x) ? nf(x, digits) + ' ' + s.units
            : 'fewer than ' + M.min_normal_years + ' years cover this hour' }];
          const sense = senseOf(v, x);
          if (sense) lines.push({ k: 'Direction', v: sense });
          const lo = surfaceAt(s, s.lo, r * 24 + h), hi = surfaceAt(s, s.hi, r * 24 + h);
          if (isNum(lo) && isNum(hi)) {
            lines.push({ k: 'Years, 10th–90th percentile', v: nf(lo, digits) + ' to '
              + nf(hi, digits) });
          }
          lines.push({ k: 'Years covering this hour', v: String(surfaceYears(s, r + 1, h)) });
          return tipRows(MONTH_NAME[r] + ', ' + hourSpan(h), lines);
        }
      })(host);
    };
  }

  /** One calendar month's mean day, over the spread of the years' own means for each hour. */
  function drawMonthDay(key, m, ext) {
    const v = VARS[key], s = surfaceOf(key);
    const digits = surfaceDigits(s);
    const mean = surfaceRecord(s, 'mean', m);
    const lo = surfaceRecord(s, 'lo', m), hi = surfaceRecord(s, 'hi', m);
    const hours = mean.map((x, h) => h + 0.5);
    return function (host) {
      const f = frame(host, { aspect: 0.62, margin: { top: 8, right: 10, bottom: 26, left: 42 },
        ariaLabel: 'Mean diurnal cycle of ' + MONTH_NAME[m - 1] + ', ' + v.short });
      const sx = linear(0, 24, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0], ext[1], f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: Math.min(digits, 2), yTickCount: 3,
        xTicks: [0, 6, 12, 18, 24].map(h => ({ v: h, label: h + 'h' })) });
      if (v.sign && ext[0] < 0 && ext[1] > 0) {
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0), stroke: f.p.muted,
          'stroke-width': 1, 'stroke-dasharray': '3 3' }, f.svg);
      }
      el('path', { d: areaFrom(hours, lo, hi, sx, sy), fill: f.p.bandOuter, opacity: 0.9 },
        f.svg);
      el('path', { d: pathFrom(hours, mean, sx, sy), fill: 'none', stroke: f.p.series[0],
        'stroke-width': 2, 'stroke-linejoin': 'round' }, f.svg);
      hover(f, sx, hours, x => {
        const h = Math.floor(x);
        const lines = [{ k: 'Record mean', v: isNum(mean[h]) ? nf(mean[h], digits) + ' '
          + s.units : 'too few years', color: f.p.series[0] }];
        const sense = senseOf(v, mean[h]);
        if (sense) lines.push({ k: 'Direction', v: sense });
        if (isNum(lo[h]) && isNum(hi[h])) {
          lines.push({ k: 'Years, 10th–90th percentile', v: nf(lo[h], digits) + ' to '
            + nf(hi[h], digits), color: 'var(--band-outer)' });
        }
        return tipRows(MONTH_NAME[m - 1] + ', ' + hourSpan(h), lines);
      });
    };
  }

  function renderVarDiurnal(key) {
    const host = document.getElementById('var-diurnal');
    const s = surfaceOf(key);
    if (!host || !s || !s.mean.some(isNum)) return;
    const v = VARS[key];
    const per = s.total ? ', stated as the mean total per hour' : '';
    host.innerHTML = '<h2 class="section">Diurnal cycle</h2><div class="grid"></div>';
    const grid = host.querySelector('.grid');

    chartCard(grid, {
      title: 'Mean by calendar month and hour of day', width: 'w-12',
      sub: 'Record mean for each hour of the day in each calendar month' + per + '. Hours follow '
        + 'the file’s timestamps, which FLUXNET states in local standard time; each hour combines '
        + 'the two half-hours that begin in it.',
      foot: (v.sign ? 'Green is net ' + v.sign.low + ' and red net ' + v.sign.high + '; the '
        + 'scale diverges about zero, as everywhere on the page. ' : '')
        + (s.total ? 'The 24 values of a row sum to the mean daily total of that calendar month. '
          + 'Each is a mean over all days, not over the days on which anything occurred in that '
          + 'hour. ' : '')
        + 'A year contributes to a cell where the product covers at least '
        + nf(cov(key).normal, 0) + ' % of its half-hours, gap-filled values included. A cell is '
        + 'drawn where at least ' + M.min_normal_years + ' years contribute.',
      draw: drawVarSurface(key),
      table: () => tableHTML(['Month'].concat(Array.from({ length: 24 }, (x, h) => pad2(h))),
        MONTH_NAME.map((name, i) => [name].concat(surfaceRecord(s, 'mean', i + 1)
          .map(x => nf(x, surfaceDigits(s))))))
    });
    lastYearCard(grid, key);

    const all = [];
    for (let m = 1; m <= 12; m++) {
      all.push(surfaceRecord(s, 'lo', m), surfaceRecord(s, 'hi', m),
        surfaceRecord(s, 'mean', m));
    }
    const ext = extent(all);
    const pad = (ext[1] - ext[0]) * 0.06;
    const shared = [ext[0] - pad, ext[1] + pad];
    const body = cardEl(grid, {
      title: 'Mean diurnal cycle by calendar month', width: 'w-12',
      sub: 'Record mean for each hour' + per + ', over the 10th–90th percentile of the '
        + 'individual years’ means for that hour. The twelve panels share one y-axis.',
      foot: 'The band is the spread between years, not between the days of one month.'
    });
    const wrap = document.createElement('div');
    wrap.className = 'dayfacets tight';
    body.appendChild(wrap);
    for (let m = 1; m <= 12; m++) {
      if (!surfaceRecord(s, 'mean', m).some(isNum)) continue;
      const box = document.createElement('div');
      box.innerHTML = '<p class="facet-title">' + MONTH_NAME[m - 1]
        + ' <span class="unit">(' + s.units + ')</span></p><div class="chart"></div>';
      wrap.appendChild(box);
      mountChart(box.querySelector('.chart'), drawMonthDay(key, m, shared));
    }
    body.insertAdjacentHTML('beforeend', legendHTML([
      { color: 'var(--series-1)', label: 'record mean, ' + M.first_year + '–' + M.last_year,
        line: true },
      { color: 'var(--band-outer)', label: '10th–90th percentile of the years' }
    ]));
  }

  /**
   * The last year of the variable against the record, by calendar month and hour: the year
   * panel's departure surface for its most recent year, on the variable's own page. The same
   * colour scale every span panel uses, so a strong colour here is a strong departure there too.
   */
  function lastYearCard(grid, key) {
    const v = VARS[key], s = surfaceOf(key);
    const D = DATA.diurnal;
    const year = Math.min(v.last_year, D.first_year + D.n_years - 1);
    const digits = surfaceDigits(s);
    const rows = MONTH_ABBR.map((label, i) => {
      const own = surfaceYear(s, year, i + 1), record = surfaceRecord(s, 'mean', i + 1);
      return { label: label, values: own.map((x, h) => (isNum(x) && isNum(record[h])
        ? x - record[h] : null)) };
    });
    if (!rows.some(r => r.values.some(isNum))) return;
    chartCard(grid, {
      title: year + ' against the mean, by month and hour', width: 'w-12',
      sub: 'Each hour of each calendar month of ' + year + ' minus the record mean for that hour '
        + 'and month' + (s.total ? ', as the mean total per hour' : '') + ', so the time of day at '
        + 'which the year differed can be read. Select the year panel for every year.',
      foot: 'The scale is the one every span panel uses, symmetric about zero and saturating at '
        + 'the departure 95 % of the record’s cells stay within. A cell is empty where the year or '
        + 'the record does not cover that hour.',
      draw: host => drawHeat({
        rows: rows, colour: departureColour(key, s.spread), keyLabel: s.units,
        ariaLabel: v.short + ', ' + year + ' minus the record mean by calendar month and hour',
        format: x => nfs(x, digits),
        tip: (r, h) => {
          const x = rows[r].values[h];
          const lines = [{ k: year + ' minus the record', v: isNum(x) ? nfs(x, digits) + ' '
            + s.units : 'no value' }];
          const sense = departureSense(v, x);
          if (sense) lines.push({ k: 'Direction', v: sense });
          return tipRows(MONTH_NAME[r] + ' ' + year + ', ' + hourSpan(h), lines);
        },
        onClick: r => { location.hash = year + '-' + pad2(r + 1); }
      })(host),
      table: () => tableHTML(['Month'].concat(Array.from({ length: 24 }, (x, h) => pad2(h))),
        rows.map((r, i) => [MONTH_NAME[i]].concat(r.values.map(x => ({ v: nfs(x, digits),
          cls: tone(x) })))))
    });
  }

  /**
   * At what hour a span departed from the record: each hour of each of its months minus the
   * record's mean for that hour and month. One row for a month, a row per month for a season, the
   * full twelve for a year. Every span of a variable is coloured on one scale, saturating at the
   * departure the build found 95 % of the record's cells to stay within, so a strong colour is a
   * strong departure whichever span is open.
   */
  function departureCard(parent, mo) {
    const keys = surfaceKeys();
    if (!keys.length) return;
    const months = spanMonths(mo);
    const label = ym => MONTH_ABBR[ym[1] - 1]
      + (state.scale === 'season' ? ' ' + ym[0] : '');
    const facets = [];
    keys.forEach(key => {
      const s = surfaceOf(key);
      const rows = months.map(ym => {
        const own = surfaceYear(s, ym[0], ym[1]);
        const rec = surfaceRecord(s, 'mean', ym[1]);
        return { ym: ym, label: label(ym), own: own, rec: rec,
          values: own.map((x, h) => (isNum(x) && isNum(rec[h]) ? x - rec[h] : null)) };
      });
      if (rows.some(r => r.values.some(isNum))) facets.push({ key: key, s: s, rows: rows });
    });
    const whole = state.scale === 'month' ? 'one row of 24 hours'
      : state.scale === 'season' ? 'one row per month'
        : 'twelve rows, one per month';
    const body = cardEl(parent, {
      title: 'Hourly departures of this ' + spanNoun() + ' from the record', width: 'w-12',
      sub: (state.scale === 'month'
        ? 'Each hour of ' + scale().title(mo) + ' minus the mean of that hour over every '
          + peerWord(mo) + ' of the record'
        : 'Each hour of each month of ' + scale().title(mo) + ' minus the record mean of that '
          + 'hour in the same calendar month') + '; ' + whole
        + ' per variable. Summed variables are stated as mean totals per hour.',
      foot: 'A monthly anomaly is one number for the whole month. This chart shows at which hours '
        + 'the departure occurred: warm nights or warm afternoons, uptake lost at midday or over '
        + 'the whole day. Each variable uses one colour scale for every span, saturating at the '
        + 'departure that 95 % of the record’s hours stay within.'
    });
    if (!facets.length) {
      body.innerHTML = '<p class="card-sub">No hour of this ' + spanNoun() + ' has both a value '
        + 'and a record mean.</p>';
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = state.scale === 'month' ? 'dayfacets tight' : 'dayfacets';
    body.appendChild(wrap);
    facets.forEach(fc => {
      const v = VARS[fc.key], s = fc.s;
      const digits = surfaceDigits(s);
      // The largest departure in words, because a colour says where and not by how much.
      let best = null;
      fc.rows.forEach(r => r.values.forEach((d, h) => {
        if (isNum(d) && (!best || Math.abs(d) > Math.abs(best.d))) best = { d: d, h: h, ym: r.ym };
      }));
      const sense = best ? departureSense(v, best.d) : null;
      const where = best ? hourSpan(best.h)
        + (months.length > 1 ? ' in ' + MONTH_NAME[best.ym[1] - 1] : '') : '';
      const box = document.createElement('div');
      box.innerHTML = '<p class="facet-title">' + v.short + ' <span class="unit">(' + s.units
        + ')</span></p><div class="chart"></div>'
        + (best ? '<p class="card-sub" style="margin:2px 0 0">' + (+best.d.toFixed(digits) === 0
          ? 'No hour departed from the record by as much as ' + nf(1 / s.scale, digits) + ' '
            + s.units + '.'
          : 'Largest departure ' + nfs(best.d, digits) + ' ' + s.units
            + (sense ? ', ' + sense : '') + ', at ' + where + '.') + '</p>' : '');
      wrap.appendChild(box);
      mountChart(box.querySelector('.chart'), function (host) {
        drawHeat({
          rows: fc.rows, colour: departureColour(fc.key, s.spread), keyLabel: null,
          rowHeight: fc.rows.length === 1 ? 30 : null,
          ariaLabel: v.short + ', ' + scale().title(mo) + ' minus the record, by hour of day',
          format: x => nfs(x, digits),
          tip: (r, h) => {
            const row = fc.rows[r];
            const d = row.values[h];
            const lines = [
              { k: MONTH_NAME[row.ym[1] - 1] + ' ' + row.ym[0], v: isNum(row.own[h])
                ? nf(row.own[h], digits) + ' ' + s.units : 'no value' },
              { k: 'Record mean', v: isNum(row.rec[h]) ? nf(row.rec[h], digits) + ' ' + s.units
                : 'too few years' }
            ];
            if (isNum(d)) {
              const ds = departureSense(v, d);
              lines.push({ k: 'Departure', v: nfs(d, digits) + ' ' + s.units
                + (ds ? ', ' + ds : '') });
            }
            return tipRows(MONTH_NAME[row.ym[1] - 1] + ' ' + row.ym[0] + ', ' + hourSpan(h),
              lines);
          }
        })(host);
      });
    });
  }

  /* ---- Every hour of the record, as date against time of day. --------------------------------
     Fills #var-hourly from HOURLY.

     The whole record in one picture: one column per day, one row per hour of it, so the daily
     cycle, the seasons and the years read together - the shape of a day and how it moves through
     the year, which no monthly figure shows.

     It is the renderer's one canvas. Twenty years is some 184,000 hours, which as SVG marks is a
     document too large to lay out and far too slow to rebuild on every resize and theme change.
     The cells are written into an ImageData one pixel per cell and scaled up with smoothing off,
     so every cell keeps a hard edge; the axes stay SVG, over the canvas, so their text is the
     page's own type and the hover target is the `rect.hit` every other chart uses. */

  const HOURLY_ROW = 8;               // CSS pixels per hour of the day
  const HOURLY_QUANTILES = [0.01, 0.99];
  const HOURLY_SCHEMES = {};          // per variable: the domain is fixed, only the colours move
  const HOURLY_GAP = '--text-muted';  // a grey that is neither end of any ramp, in either theme
  // A variable signed by a convention (NEE) is drawn red-yellow-blue, blue for negative (uptake).
  const HOURLY_SIGNED = Array.from({ length: 11 }, (_, i) => '--rdylbu-' + (i + 1));

  function quantileOf(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, i = Math.floor(pos);
    return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * (pos - i) : sorted[i];
  }

  /**
   * How one variable's hours are coloured: which ramp, over which domain.
   *
   * The ramp is the variable's own metric's, so an hour reads in the colours its months do. The
   * domain is a percentile range of the hours rather than their extent, because one extreme hour
   * in twenty years would otherwise put everything else in the middle third of the ramp. A variable
   * whose sign is a convention (NEE) diverges about zero instead, symmetrically, so a colour's
   * depth means the same magnitude of uptake as of release. A total that is mostly nothing
   * (precipitation) is drawn from zero, and a dry hour takes the neutral colour rather than the
   * palest step of the ramp.
   * Computed once per variable; the colours are looked up again at every draw.
   */
  function hourlyScheme(key) {
    if (key in HOURLY_SCHEMES) return HOURLY_SCHEMES[key];
    const h = HOURLY.vars[key], v = VARS[key], met = ownMetric(v);
    const all = [], positive = [];
    for (let i = 0; i < h.values.length; i++) {
      const raw = h.values[i];
      if (raw === null || raw === undefined) continue;
      const x = raw / h.scale;
      all.push(x);
      if (x > 0) positive.push(x);
    }
    let out = null;
    if (all.length) {
      const sorted = Float64Array.from(all).sort();
      const digits = Math.max(0, Math.round(Math.log10(h.scale || 1)));
      const pole = met && met.scale === 'div'
        ? [met.poles[0], '--neutral-mid', met.poles[1]] : null;
      // Signed by a convention: zero is the boundary that means something, whatever the record
      // mean the metric itself diverges about.
      if (v.sign && pole) {
        const dev = Float64Array.from(all, x => Math.abs(x)).sort();
        const half = quantileOf(dev, HOURLY_QUANTILES[1]) || 1;
        out = { kind: 'centred', lo: -half, hi: half, center: 0, stops: HOURLY_SIGNED };
      } else if (v.agg === 'sum' && !v.sign) {
        const pos = Float64Array.from(positive).sort();
        out = { kind: 'zero', lo: 0, hi: quantileOf(pos, HOURLY_QUANTILES[1]) || 1,
          stops: met && met.stops ? met.stops : ['--neutral-mid', '--series-1'],
          zero: '--neutral-mid' };
      } else {
        const lo = quantileOf(sorted, HOURLY_QUANTILES[0]);
        let hi = quantileOf(sorted, HOURLY_QUANTILES[1]);
        if (!(hi > lo)) hi = lo + 1;
        out = { kind: 'range', lo: lo, hi: hi,
          stops: pole || (met && met.stops) || ['--neutral-mid', '--series-1'] };
      }
      out.digits = digits;
      out.n = all.length;
    }
    HOURLY_SCHEMES[key] = out;
    return out;
  }

  /** What one hour of a variable is: its mean, or for a total what fell or passed in it. */
  const hourlyUnit = v => (v.agg === 'sum' ? v.units + ' per hour' : v.units);

  function hourlyLegend(key, s) {
    const v = VARS[key];
    const ramp = 'linear-gradient(90deg,' + s.stops.map(t => 'var(' + t + ')').join(',') + ')';
    const swatch = bg => '<span class="legend-swatch" style="background:' + bg + '"></span>';
    const wide = '<span class="legend-swatch" style="width:64px;background:' + ramp + '"></span>';
    const q0 = ord(Math.round(HOURLY_QUANTILES[0] * 100));
    const q1 = ord(Math.round(HOURLY_QUANTILES[1] * 100));
    let scaleText;
    if (s.kind === 'centred') {
      const end = x => nfs(x, s.digits) + (v.sign ? ' (' + senseOf(v, x) + ')' : '');
      scaleText = end(s.lo) + ' to ' + end(s.hi) + ' ' + hourlyUnit(v)
        + ', diverging about ' + nf(s.center, 0)
        + ' and bounded at the ' + q1 + ' percentile of the absolute departures from it';
    } else {
      scaleText = nf(s.lo, s.digits) + ' to ' + nf(s.hi, s.digits) + ' ' + hourlyUnit(v)
        + (s.kind === 'zero'
          ? ', from zero to the ' + q1 + ' percentile of the hours above zero'
          : ', ' + q0 + ' to ' + q1 + ' percentile of all hours');
    }
    const items = ['<span class="legend-item">' + wide + scaleText + '</span>'];
    if (s.kind === 'zero') {
      items.push('<span class="legend-item">' + swatch('var(' + s.zero + ')') + 'none</span>');
    }
    items.push('<span class="legend-item">' + swatch('var(' + HOURLY_GAP + ')')
      + 'no value in the file</span>');
    return '<div class="legend">' + items.join('') + '</div>';
  }

  /** Day index and hour under a pointer, from its position over the plot. */
  function hourlyAt(hit, ev, nDays) {
    const box = hit.getBoundingClientRect();
    // A box with no size is a page not laid out yet, where the first cell is the honest answer.
    const fx = box.width > 0 ? (ev.clientX - box.left) / box.width : 0;
    const fy = box.height > 0 ? (ev.clientY - box.top) / box.height : 0;
    const day = Math.max(0, Math.min(nDays - 1, Math.floor(fx * nDays)));
    // Midnight is the bottom row, so the hour counts up the axis.
    const hour = Math.max(0, Math.min(23, 23 - Math.floor(fy * 24)));
    return { day: day, hour: hour };
  }

  function drawHourly(key, s) {
    return function (host) {
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      const h = HOURLY.vars[key], v = VARS[key];
      const nDays = Math.floor(HOURLY.n / 24);
      const H0 = Date.parse(HOURLY.start + 'T00:00:00Z');
      const dateOf = i => new Date(H0 + i * 86400000);
      const f = frame(host, {
        height: 10 + 24 * HOURLY_ROW + 28,
        margin: { top: 10, right: 12, bottom: 28, left: 40 }
      });
      // The canvas carries the accessible name; the SVG over it is axes and a hover target only.
      f.svg.removeAttribute('role');
      f.svg.removeAttribute('aria-label');
      f.svg.setAttribute('aria-hidden', 'true');
      f.svg.style.position = 'relative';
      host.style.position = 'relative';

      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', v.title + ', every hour from ' + M.first_year + ' to '
        + M.last_year + ': one column per day and one row per hour of the day, midnight at the '
        + 'bottom, coloured by the hourly ' + (v.agg === 'sum' ? 'total' : 'mean') + ' in '
        + hourlyUnit(v) + '. Hours without a value in the file are grey.');
      canvas.style.cssText = 'position:absolute;left:' + f.m.left + 'px;top:' + f.m.top
        + 'px;width:' + f.iw + 'px;height:' + f.ih + 'px';
      host.insertBefore(canvas, f.svg);

      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(f.iw * dpr)), Hpx = Math.max(1, Math.round(f.ih * dpr));
      canvas.width = W;
      canvas.height = Hpx;

      /* More days than device pixels: a column is then the mean of `per` days, so no day is
         dropped by the downscale, and a column is greyed in proportion to the hours among its days
         that carry no value, so a gap of two days in a column of five still shows. */
      const per = Math.max(1, Math.ceil(nDays / W));
      const cols = Math.ceil(nDays / per);
      const ctx = canvas.getContext && canvas.getContext('2d');
      const off = document.createElement('canvas');
      off.width = cols;
      off.height = 24;
      const octx = off.getContext && off.getContext('2d');
      if (ctx && octx) {
        const stops = s.stops.map(t => hex2rgb(token(t)));
        const gap = hex2rgb(token(HOURLY_GAP));
        const zero = s.zero ? hex2rgb(token(s.zero)) : null;
        const lut = [];
        for (let k = 0; k < 256; k++) lut.push(rampRGB(stops, k / 255));
        const span = (s.hi - s.lo) || 1;
        const img = octx.createImageData(cols, 24);
        const px = img.data;
        for (let hh = 0; hh < 24; hh++) {
          const row = 23 - hh;
          for (let c = 0; c < cols; c++) {
            let sum = 0, n = 0, all = 0;
            const d1 = Math.min(nDays, (c + 1) * per);
            for (let d = c * per; d < d1; d++) {
              all += 1;
              const raw = h.values[d * 24 + hh];
              if (raw === null || raw === undefined) continue;
              sum += raw;
              n += 1;
            }
            let rgb;
            if (!n) {
              rgb = gap;
            } else {
              const x = sum / n / h.scale;
              rgb = zero && x === 0 ? zero
                : lut[Math.max(0, Math.min(255, Math.round((x - s.lo) / span * 255)))];
              if (n < all) rgb = mix(rgb, gap, 1 - n / all);
            }
            const o = (row * cols + c) * 4;
            px[o] = rgb[0];
            px[o + 1] = rgb[1];
            px[o + 2] = rgb[2];
            px[o + 3] = 255;
          }
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, W, Hpx);
        // The last column may hold fewer than `per` days, so the image is drawn at the width its
        // columns would have in full and the canvas clips the rest. Anything else stretches the
        // record by up to a column and puts every year's first day a few days off its tick.
        ctx.drawImage(off, 0, 0, W * cols * per / nDays, Hpx);
      }

      // Hours up the side, midnight at the bottom.
      const yOf = hh => f.m.top + f.ih - hh / 24 * f.ih;
      [0, 6, 12, 18, 24].forEach(hh => {
        el('line', { x1: f.m.left - 4, x2: f.m.left, y1: yOf(hh), y2: yOf(hh), class: 'ax-line' },
          f.svg);
        svgText(f.svg, f.m.left - 7, yOf(hh) + 4, String(hh).padStart(2, '0') + ':00',
          'ax-text', { 'text-anchor': 'end' });
      });
      // Years along the foot, labelled as often as they fit.
      const xOf = i => f.m.left + i / nDays * f.iw;
      const perYear = f.iw * 365.25 / nDays;
      const every = perYear >= 34 ? 1 : perYear * 2 >= 34 ? 2 : perYear * 5 >= 34 ? 5 : 10;
      YEARS.forEach(y => {
        const i0 = Math.round((Date.UTC(y, 0, 1) - H0) / 86400000);
        const i1 = Math.round((Date.UTC(y + 1, 0, 1) - H0) / 86400000);
        if (i1 <= 0 || i0 >= nDays) return;
        el('line', { x1: xOf(i0), x2: xOf(i0), y1: f.m.top + f.ih, y2: f.m.top + f.ih + 4,
          class: 'ax-line' }, f.svg);
        if (y % every) return;
        svgText(f.svg, every === 1 ? (xOf(Math.max(0, i0)) + xOf(Math.min(nDays, i1))) / 2
          : xOf(i0), f.m.top + f.ih + 17, String(y), 'ax-text', { 'text-anchor': 'middle' });
      });

      const hit = el('rect', { class: 'hit', x: f.m.left, y: f.m.top, width: f.iw,
        height: f.ih }, f.svg);
      hit.style.cursor = 'pointer';
      hit.addEventListener('mousemove', ev => {
        const at = hourlyAt(hit, ev, nDays);
        const t = dateOf(at.day);
        const raw = h.values[at.day * 24 + at.hour];
        const hours = String(at.hour).padStart(2, '0') + ':00–'
          + String(at.hour + 1).padStart(2, '0') + ':00';
        let value;
        if (raw === null || raw === undefined) {
          value = 'no value in the file';
        } else {
          const x = raw / h.scale;
          const sense = senseOf(v, x);
          value = (v.sign ? nfs(x, s.digits) : nf(x, s.digits)) + ' ' + v.units
            + (sense ? ' (' + sense + ')' : '');
        }
        tip.show(tipRows(WEEKDAY[(t.getUTCDay() + 6) % 7] + ' ' + t.getUTCDate() + ' '
          + MONTH_NAME[t.getUTCMonth()] + ' ' + t.getUTCFullYear(), [
          { k: 'Hour', v: hours },
          { k: v.short + (v.agg === 'sum' ? ', total' : ', mean'), v: value }
        ]), ev.clientX, ev.clientY);
      });
      hit.addEventListener('mouseleave', () => tip.hide());
      hit.addEventListener('click', ev => {
        const t = dateOf(hourlyAt(hit, ev, nDays).day);
        location.hash = t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0')
          + '-' + String(t.getUTCDate()).padStart(2, '0');
      });

      const t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      canvas.dataset.drawMs = (t1 - t0).toFixed(1);
      canvas.dataset.columns = String(cols);
      canvas.dataset.daysPerColumn = String(per);
    };
  }

  function renderVarHourly(key) {
    const host = document.getElementById('var-hourly');
    if (!host) return;
    const v = VARS[key];
    // Built without the layer: said once, as the month and day panels say it.
    const heading = '<h2 class="section">Hourly values</h2>';
    const title = 'Hourly values by date and time of day';
    if (!HOURLY) {
      host.innerHTML = heading + '<div class="grid"></div>';
      cardEl(host.lastChild, { title: title, width: 'w-12' }).innerHTML =
        '<p class="card-sub" style="max-width:none">This page was built without the hourly '
        + 'arrays (<code>--no-hourly</code>), so hourly values are not shown.</p>';
      return;
    }
    // A variable the layer does not carry is left out, as the diurnal panels leave it out.
    if (!HOURLY.vars[key]) return;
    const s = hourlyScheme(key);
    if (!s) return;
    host.innerHTML = heading + '<div class="grid"></div>';
    const body = cardEl(host.lastChild, {
      title: title, width: 'w-12',
      sub: 'One column per day and one row per hour of the day, midnight at the bottom, coloured '
        + 'by the hourly ' + (v.agg === 'sum' ? 'total' : 'mean') + ' in the file’s time. '
        + 'Hover to read an hour; select it to open its day.',
      foot: 'Hours without a value in the file are grey. Each hour is the '
        + (v.agg === 'sum' ? 'sum' : 'mean') + ' of whichever of its two half-hours the file '
        + 'carries. Where the card has fewer pixel columns than the record has days, a column is '
        + 'the mean of several days, greyed in proportion to their hours without a value.'
    });
    const chart = document.createElement('div');
    chart.className = 'chart';
    body.appendChild(chart);
    body.insertAdjacentHTML('beforeend', hourlyLegend(key, s));
    mountChart(chart, drawHourly(key, s));
  }


  /**
   * What set one year apart, as the build ranked it.
   *
   * The entries are built in Python, where the other years are in hand: half of what makes a year
   * notable is its place among them, and a page that only read the year in front of it could state
   * a growing season of 225 days without being able to say that this was the shortest but two.
   */
  function stoodList(yr) {
    if (!yr.stood || !yr.stood.length) {
      return '<p class="card-sub" style="max-width:none">No departure in this year was large '
        + 'enough to rank, and no variable placed near the top or bottom of the record.</p>';
    }
    return '<dl class="kv stood">' + yr.stood.map(s =>
      '<dt>' + s.k + '</dt><dd class="tone-' + s.tone + '">' + s.v + '</dd>').join('') + '</dl>';
  }

  function renderMonth() {
    const mo = state.span;
    const sc = scale();
    const host = document.getElementById('month-body');
    compactCharts();
    document.getElementById('month-title').innerHTML = sc.title(mo)
      + (state.scale === 'month' && SEASON[mo.m]
        ? '<span class="season">' + SEASON[mo.m] + '</span>' : '');

    const list = sc.spans();
    const idx = list.indexOf(mo);
    const yearStep = state.scale === 'season' ? SEASON_DEFS.length
      : state.scale === 'year' ? 1 : 12;
    document.getElementById('month-prev').disabled = idx <= 0;
    document.getElementById('month-next').disabled = idx >= list.length - 1;
    document.getElementById('year-prev').disabled = idx - yearStep < 0;
    document.getElementById('year-next').disabled = idx + yearStep >= list.length;

    host.innerHTML = '<p class="monthlede" id="month-lede"></p>'
      + '<div class="tiles" id="month-tiles"></div>'
      + '<p class="seasonline" id="month-season"></p>'
      + '<h2 class="section">Badges and highlights</h2><div id="month-badges"></div>'
      + (state.scale === 'year' ? '<div class="grid" id="month-stood"></div>' : '')
      + '<div class="grid" id="month-highlights"></div>'
      + '<h2 class="section">Daily series</h2><div class="grid" id="month-charts"></div>'
      + '<h2 class="section">Mean diurnal cycle</h2><div class="grid" id="month-diurnal"></div>'
      + '<h2 class="section">Comparison with the record</h2>'
      + '<div class="grid" id="month-context"></div>'
      + '<h2 class="section">Calendar</h2><div class="grid" id="month-days"></div>'
      + '<div id="day-panel"></div>'
      + '<h2 class="section">Daily data</h2>'
      + '<div class="grid" id="month-table"></div>';

    document.getElementById('month-lede').innerHTML = monthLede(mo);
    document.getElementById('month-tiles').innerHTML = monthTiles(mo);
    document.getElementById('month-season').innerHTML = seasonLine(mo);
    document.getElementById('month-badges').innerHTML = monthBadges(mo) + suppressedNote(mo);

    /* A badge is a threshold and a placing is not, so the year carries both. A year can earn no
       badge at all and still be the third warmest of twenty-one, which is exactly the kind of
       thing a reader opening a year is looking for. */
    if (state.scale === 'year') {
      cardEl(document.getElementById('month-stood'), {
        title: 'Rank of ' + mo.y + ' among the ' + YEAR_ROWS.length + ' years', width: 'w-12',
        sub: 'Placings of this year among the ' + YEAR_ROWS.length + ' years of the record, '
          + 'strongest first. A year is ranked against every other year, so the normal behind '
          + 'each figure is the record mean.'
      }).innerHTML = stoodList(mo);
    }

    const hl = document.getElementById('month-highlights');
    hl.innerHTML = '';
    cardEl(hl, {
      title: 'Daily extremes', width: 'w-4',
      sub: 'Extreme days within the ' + spanNoun() + '.'
    }).innerHTML = monthHighlights(mo);
    cardEl(hl, {
      title: 'Standardised anomalies', width: 'w-4',
      sub: 'Departure of each variable from the ' + normalWord() + ', in standard deviations.'
    }).innerHTML = monthComposite(mo);

    // Named for the section rather than `charts`, which is the module's chart registry.
    const dayByDay = document.getElementById('month-charts');
    if (VARS.TA) {
      chartCard(dayByDay, {
        title: 'Daily air temperature', width: 'w-6',
        sub: 'Daily range and daily mean, over the ±' + M.clim_window
          + ' day normal band for the same date.',
        legend: [
          { color: 'var(--band-outer)', label: 'normal 10th–90th percentile' },
          { color: 'var(--band-inner)', label: 'daily minimum to maximum' },
          { color: 'var(--series-2)', label: 'daily mean', line: true },
          { color: 'var(--text-muted)', label: 'normal daily mean', line: true }
        ],
        draw: drawMonthTemperature(mo)
      });
      chartCard(dayByDay, {
        title: 'Daily air temperature anomaly', width: 'w-6',
        sub: 'Daily mean minus the normal for the same date. The dashed line is the running mean '
          + 'of the departures to date, from which the monthly anomaly follows.',
        legend: [
          { color: 'var(--pole-warm)', label: 'above the normal for the date' },
          { color: 'var(--pole-cold)', label: 'below the normal for the date' },
          { color: 'var(--text-primary)', label: 'mean to date', line: true }
        ],
        foot: 'The same monthly anomaly can come from a uniformly mild month or from a cold first '
          + 'week and a hot last week. The daily departures distinguish the two.',
        draw: drawMonthAnomaly(mo)
      });
    }
    if (VARS.PREC) {
      chartCard(dayByDay, {
        title: 'Daily precipitation', width: 'w-6',
        sub: 'Daily totals, with the normal for each date.',
        legend: [
          { color: 'var(--series-1)', label: 'daily total' },
          { color: 'var(--text-muted)', label: 'normal for the date', line: true }
        ],
        draw: drawMonthPrecip(mo)
      });
      chartCard(dayByDay, {
        title: 'Cumulative precipitation', width: 'w-6',
        sub: 'Running total against the running total of the daily normals. A day without a '
          + 'value adds nothing, so the running total stays level across it.',
        legend: [
          { color: 'var(--series-1)', label: 'this ' + spanNoun(), line: true },
          { color: 'var(--text-muted)', label: 'normal', line: true }
        ],
        draw: drawMonthCumulative(mo)
      });
    }
    if (VARS['SWC'] && VARS.PREC) {
      chartCard(dayByDay, {
        title: 'Soil water content and precipitation', width: 'w-6',
        sub: 'Soil water content with its ±' + M.clim_window + ' day normal band, and daily '
          + 'precipitation on a separate axis.',
        legend: [
          { color: 'var(--series-3)', label: 'soil water content', line: true },
          { color: 'var(--band-outer)', label: 'normal 10th–90th percentile' },
          { color: 'var(--series-1)', label: 'precipitation, right axis' }
        ],
        draw: drawMonthSoil(mo)
      });
    }

    // Radiation, evaporative demand and humidity have no chart of their own otherwise. They share
    // one card of compact panels rather than three half-width cards, which would push the day
    // calendar below two screens.
    const bands = [
      ['SW_IN', 'mean', 'area'], ['VPD', 'mean', 'line'], ['RH', 'mean', 'line']
    ].filter(b => VARS[b[0]] && DAYS.series[b[0] + '_' + b[1]]);
    if (bands.length) {
      const body = cardEl(dayByDay, {
        title: 'Radiation, evaporative demand and humidity', width: 'w-6',
        sub: 'Daily means over the ±' + M.clim_window + ' day normal band for each date. Select '
          + 'a day to open it.'
      });
      const wrap = document.createElement('div');
      wrap.className = 'dayfacets tight';
      body.appendChild(wrap);
      bands.forEach(b => {
        const v = VARS[b[0]];
        const box = document.createElement('div');
        box.innerHTML = '<p class="facet-title">' + v.short
          + ' <span class="unit">(' + v.units + ')</span></p><div class="chart"></div>';
        wrap.appendChild(box);
        mountChart(box.querySelector('.chart'), drawDailyBand(mo, b[0], b[1], b[2]));
      });
      body.insertAdjacentHTML('beforeend', legendHTML([
        { color: 'var(--band-outer)', label: 'normal 10th–90th percentile' },
        { color: 'var(--text-muted)', label: 'normal for the date', line: true }
      ]));
    }

    // -- The average day ---------------------------------------------------------------------
    const diurnal = document.getElementById('month-diurnal');
    /* Without the hourly arrays the mean day is drawn from the month-by-hour surfaces instead,
       which every build carries: a month's row of its surface is exactly the mean of each hour
       over its days, and a longer span's is the same weighted by the days of its months. The
       variables are the ones the hourly arrays would have carried, so the card reads the same
       either way. */
    const fromSurface = !HOURLY;
    const meanDayKeys = HOURLY ? diurnalVars()
      : DIURNAL_ORDER.filter(k => surfaceOf(k) && surfaceOf(k).hourly)
        .concat(surfaceKeys().filter(k => surfaceOf(k).hourly && DIURNAL_ORDER.indexOf(k) < 0));
    if (!HOURLY && !meanDayKeys.length) {
      cardEl(diurnal, { title: 'Mean diurnal cycle', width: 'w-12' }).innerHTML =
        '<p class="card-sub" style="max-width:none">This page was built without the hourly '
        + 'arrays, so no mean diurnal cycle can be drawn. Rebuild without '
        + '<code>--no-hourly</code>.</p>';
    } else {
      const body = cardEl(diurnal, {
        title: 'Mean diurnal cycle, ' + sc.title(mo), width: 'w-12',
        sub: 'All days of the ' + spanNoun() + ' averaged by hour of day, against the same '
          + 'average over every ' + peerWord(mo) + ' of the record.',
        foot: 'This shows whether a departure occurred at night or during the day, which a '
          + 'monthly mean does not.'
          + (fromSurface ? ' This page was built without the hourly arrays, so the mean diurnal '
            + 'cycle is computed from the mean of each hour of each month, weighted by the number '
            + 'of days in each month.' : '')
      });
      const wrap = document.createElement('div');
      wrap.className = 'dayfacets';
      body.appendChild(wrap);
      let drawn = 0;
      meanDayKeys.forEach(key => {
        const own = fromSurface ? spanSurface(key, mo) : null;
        const values = fromSurface ? (own && own.values) : composite(key, mo.i0, mo.n);
        if (!values) return;
        drawn += 1;
        const v = VARS[key];
        const box = document.createElement('div');
        // Both layers state a summed variable as its total per hour, the fluxes as well as rain.
        box.innerHTML = '<p class="facet-title">' + v.short
          + ' <span class="unit">(' + v.units + (v.agg === 'sum' ? ' per hour' : '')
          + ')</span></p><div class="chart"></div>';
        wrap.appendChild(box);
        const kind = key === 'PREC' ? 'bars' : (key === 'SW_IN' ? 'area' : 'line');
        const normal = fromSurface ? own.record
          : (state.scale === 'month' ? climComposite(key, mo.m) : null);
        mountChart(box.querySelector('.chart'), drawComposite(key, values, normal, kind));
      });
      if (!drawn) {
        wrap.innerHTML = '<p class="card-sub">No hourly values are available for this '
          + spanNoun() + '.</p>';
      } else {
        body.insertAdjacentHTML('beforeend', legendHTML([
          { color: 'var(--text-muted)', label: 'every '
            + peerOf(mo) + ' of ' + M.first_year + '–' + M.last_year,
          line: true }
        ]));
      }
    }
    // At what hour the span differed from the record, from the same surfaces.
    departureCard(diurnal, mo);

    // -- The month against every other year of the same month --------------------------------
    const context = document.getElementById('month-context');
    const ranks = cardEl(context, {
      title: 'Position within the record', width: 'w-6',
      sub: 'Every ' + peerWord(mo) + ' of the record on one line per variable; this one is '
        + 'filled. The dashed tick marks the ' + normalWord() + '.',
      foot: 'The spread of the other years shows whether a departure is large for this '
        + spanNoun() + ', which the anomaly alone does not. Select another year to open it.'
    });
    ranks.appendChild(rankStrips(mo));

    if (VARS.TA) {
      chartCard(context, {
        title: 'Daily air temperature, every ' + peerWord(mo) + ' in the record', width: 'w-6',
        sub: 'Daily mean air temperature through the ' + spanNoun() + ', one line per year, with '
          + 'this one on top.',
        legend: [
          { color: 'var(--series-2)', label: sc.title(mo), line: true },
          { color: 'var(--text-secondary)', label: 'the other years', line: true },
          { color: 'var(--text-muted)', label: 'normal for the date', line: true }
        ],
        // Counted rather than written: "twenty-one" was the length of the record this was first
        // written against, and on any other record it stated a number the chart does not show.
        foot: 'A rank places the ' + spanNoun() + ' as one value among '
          + sc.spans().filter(x => sc.idOf(x) === sc.idOf(mo)).length + '. The daily lines show '
          + 'whether a warm ' + spanNoun() + ' was warm throughout or owed its rank to a single '
          + 'spell.',
        draw: drawMonthShape(mo)
      });
    }

    /* The year's own carbon balance as it built up, among every other year's. A year is the one
       span whose running total starts where the convention starts it, on 1 January, so this is
       drawn on the year panel and nowhere below it. */
    if (state.scale === 'year') {
      DATA.variables.filter(v => v.sign && hasCumulative(v))
        .forEach(v => cumulativeCard(context, v, mo.y, true));
    }

    chartCard(context, {
      title: 'Every ' + peerWord(mo) + ' in the record', width: 'w-12',
      sub: metric().label + '. This ' + spanNoun() + ' is highlighted; select another to open it.',
      legend: [
        { color: 'var(--series-2)', label: sc.title(mo) },
        { color: 'var(--series-1)', label: 'the other years' },
        { color: 'var(--text-muted)', label: 'normal', line: true }
      ],
      draw: drawAcrossYears(mo)
    });

    const daysHost = document.getElementById('month-days');
    const body = cardEl(daysHost, {
      title: 'Days of ' + sc.title(mo), width: 'w-8',
      sub: 'Coloured by ' + metric().label.toLowerCase() + '. Chips mark the thresholds a day '
        + 'met; the bar along the bottom shows its precipitation. Select a day to open it.'
    });
    body.innerHTML = dayCalendar(mo);
    body.querySelectorAll('.daycell[data-day]').forEach(node => {
      node.addEventListener('click', () => {
        if (!node.dataset.ym) { selectDay(+node.dataset.day); return; }
        const ym = node.dataset.ym.split('-');
        location.hash = ym[0] + '-' + String(ym[1]).padStart(2, '0') + '-'
          + String(node.dataset.day).padStart(2, '0');
      });
    });

    document.getElementById('month-table').innerHTML = '';
    const tbody = cardEl(document.getElementById('month-table'), {
      title: 'Daily values', width: 'w-8',
      sub: 'The values behind the charts and the calendar above.'
    });
    tbody.innerHTML = dayTable(mo);

    if (state.d) renderDay();
  }

