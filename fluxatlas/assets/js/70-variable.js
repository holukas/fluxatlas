  /* ------------------------------------------------------------------------------------------
     Level 2b: one variable, over the whole record
     ------------------------------------------------------------------------------------------
     The grid answers "what happened in that month". This answers the other question a record of
     decades invites: "what has this variable done over all of it, and does that differ between
     the calendar months". A slope for January and a slope for July are separate statements - at
     most mid-latitude sites the winters have moved further than the summers - and an annual figure
     averages exactly that difference away.

     Everything here is read from the payload the grid already carries. The slopes are the ones the
     foot row of the grid prints, so the two cannot disagree, and the fitted line is drawn from the
     two endpoints the build ships rather than re-fitted in the browser.
     ------------------------------------------------------------------------------------------ */

  /** The metric that reads a variable straight off the product, which is what its page is about. */
  const ownMetric = v => (v.metric ? METRICS[v.metric] : null);

  const varSpans = key => MONTHS.filter(mo => mo[key] && isNum(mo[key].v));

  /** The value of one variable on one span, at the span's own aggregation. */
  const varValue = (row, key) => (row[key] && isNum(row[key].v) ? row[key].v : null);

  function varExtremes(key) {
    const v = VARS[key];
    const rows = varSpans(key).slice().sort((a, b) => b[key].v - a[key].v);
    const years = YEAR_ROWS.filter(yr => isNum(varValue(yr, key)))
      .slice().sort((a, b) => b[key].v - a[key].v);
    return { high: rows[0], low: rows[rows.length - 1], n: rows.length,
      yearHigh: years[0], yearLow: years[years.length - 1], v: v };
  }

  /** One statistic of the record, as the definition list the variable page opens with. */
  function varSummary(key) {
    const v = VARS[key];
    const met = ownMetric(v);
    const ex = varExtremes(key);
    const d = v.digits;
    const rows = [];
    const unit = ' ' + v.units;
    // A signed figure carries its direction wherever it is printed.
    const sensed = (x, when) => nf(x, d) + unit + ' in ' + when
      + (senseOf(v, x) ? ' (' + senseOf(v, x) + ')' : '');

    if (met && met.trend_year) {
      rows.push({ k: 'Trend over the record', v: trendSentence(met, met.trend_year) });
    }
    if (met && met.epoch && met.epoch.early) {
      const e = met.epoch;
      rows.push({ k: 'First and second half of the record',
        v: sensed(e.early.mean, e.early.y0 + '–' + e.early.y1) + ', '
          + sensed(e.late.mean, e.late.y0 + '–' + e.late.y1)
          + ' (' + nfs(e.late.mean - e.early.mean, d) + unit + ')' });
    }
    if (ex.high) {
      rows.push({ k: 'Highest month',
        v: sensed(ex.high[key].v, MONTH_NAME[ex.high.m - 1] + ' ' + ex.high.y) });
      rows.push({ k: 'Lowest month',
        v: sensed(ex.low[key].v, MONTH_NAME[ex.low.m - 1] + ' ' + ex.low.y) });
    }
    if (ex.yearHigh) {
      rows.push({ k: 'Highest year', v: sensed(ex.yearHigh[key].v, ex.yearHigh.y) });
      rows.push({ k: 'Lowest year', v: sensed(ex.yearLow[key].v, ex.yearLow.y) });
    }
    rows.push({ k: v.derived ? 'Computed from' : 'Read from',
      v: '<code>' + esc(v.derived ? v.column.replace(/^computed:\s*/, '') : v.column) + '</code>'
        + (v.product ? ' (' + esc(v.product) + ')' : '') });
    if (v.unc_note) rows.push({ k: 'Uncertainty components', v: v.unc_note });
    rows.push({ k: 'Coverage warning', v: 'below ' + nf(v.cov.warn, 0) + ' % measured; '
      + (v.thin ? v.thin + ' month' + (v.thin === 1 ? '' : 's') : 'no month') + ' below it' });
    return '<dl class="kv wide">' + rows.map(r =>
      '<dt>' + r.k + '</dt><dd>' + r.v + '</dd>').join('') + '</dl>';
  }

  /**
   * The slope of each calendar month, side by side.
   *
   * This is the chart the variable page exists for. One annual slope is the average of these
   * twelve, and averaging them is what hides the case this page is meant to show: a record whose
   * Januaries have moved three times as far as its Julys, or whose growing season has lengthened
   * at one end only.
   */
  function drawMonthlyTrends(key) {
    const met = ownMetric(VARS[key]);
    return function (host) {
      const slopes = [];
      for (let m = 1; m <= 12; m++) {
        const t = met && met.trend ? met.trend[String(m)] : null;
        slopes.push(t && isNum(t.slope) ? t : null);
      }
      const f = frame(host, { aspect: 0.4,
        ariaLabel: met.short + ' trend per decade, by calendar month' });
      const lows = slopes.map(t => (t ? t.lo : null)).filter(isNum);
      const highs = slopes.map(t => (t ? t.hi : null)).filter(isNum);
      if (!lows.length) {
        svgText(f.svg, f.width / 2, f.height / 2,
          'No calendar month has enough complete years for a trend', 'ax-text',
          { 'text-anchor': 'middle' });
        return;
      }
      const lo = Math.min(0, Math.min.apply(null, lows));
      const hi = Math.max(0, Math.max.apply(null, highs));
      const pad = (hi - lo) * 0.08 || 1;
      const sx = linear(0.5, 12.5, f.m.left, f.m.left + f.iw);
      const sy = linear(lo - pad, hi + pad, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: met.digits + 1, yLabel: met.units + ' / decade',
        xTicks: MONTH_ABBR.map((label, i) => ({ v: i + 1, label: label[0] })) });
      el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0),
        class: 'ax-line' }, f.svg);

      const bw = Math.max(6, f.iw / 12 - 10);
      slopes.forEach((t, i) => {
        if (!t) return;
        const m = i + 1;
        const sig = isNum(t.p) && t.p < TREND_ALPHA;
        const top = Math.min(sy(t.slope), sy(0)), bottom = Math.max(sy(t.slope), sy(0));
        el('rect', { x: sx(m) - bw / 2, y: top, width: bw, height: Math.max(1, bottom - top),
          rx: 2, fill: t.slope >= 0 ? f.p.warm : f.p.cold, opacity: sig ? 1 : 0.45 }, f.svg);
        // The interval, because a slope without one invites a reader to take every bar as real.
        el('line', { x1: sx(m), x2: sx(m), y1: sy(t.lo), y2: sy(t.hi),
          stroke: f.p.ink, 'stroke-width': 1.2, opacity: 0.75 }, f.svg);
        if (sig) svgText(f.svg, sx(m), sy(Math.max(t.hi, 0)) - 6, '*', 'ax-text',
          { 'text-anchor': 'middle' });
      });
      hover(f, sx, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], m => {
        const t = slopes[m - 1];
        if (!t) return tipRows(MONTH_NAME[m - 1], [{ k: 'Trend', v: 'not enough complete years' }]);
        return tipRows(MONTH_NAME[m - 1], [
          { k: 'Slope', v: nfs(t.slope, met.digits + 1) + ' ' + met.units + ' / decade' },
          { k: '95 % interval', v: nfs(t.lo, met.digits + 1) + ' to '
            + nfs(t.hi, met.digits + 1) },
          { k: 'Kendall p', v: nf(t.p, 3) + (isNum(t.p) && t.p < TREND_ALPHA ? ' *' : '') },
          { k: 'Years', v: String(t.n) }
        ]);
      });
    };
  }

  /**
   * What the band around a variable's annual figures is, and what it should be called.
   *
   * Two different things can be drawn there and they are not interchangeable, so the chart names
   * whichever it drew. Where the file publishes an uncertainty, that is the honest band: it is the
   * interval the page already prints beside every flux figure. Where it does not, a mean-aggregated
   * variable can still show the spread of its own months, which describes the year rather than the
   * confidence in it. A total with neither gets no band at all: the spread of twelve monthly totals
   * is not an uncertainty of their sum.
   */
  function yearBand(key) {
    const v = VARS[key];
    const published = YEAR_ROWS.map(r => (r[key] && isNum(r[key].u) ? r[key].u : null));
    if (published.some(isNum)) {
      return { half: published, label: '± ' + (v.unc_note || 'published uncertainty'),
        note: 'The band is the published uncertainty'
          + (v.unc_note ? ' (' + v.unc_note + ')' : '') + '.' };
    }
    if (v.agg === 'sum') return null;
    const half = YEAR_ROWS.map(r => {
      const months = MONTHS.filter(mo => mo.y === r.y && mo[key] && isNum(mo[key].v))
        .map(mo => mo[key].v);
      if (months.length < 6) return null;
      const mean = months.reduce((a, b) => a + b, 0) / months.length;
      const varc = months.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (months.length - 1);
      return Math.sqrt(varc);
    });
    return half.some(isNum)
      ? { half: half, label: '± 1 sd of monthly values',
        note: 'The band is ±1 standard deviation of the year’s monthly values. It shows the '
          + 'variability within the year, not the uncertainty of the annual value. The file '
          + 'publishes no uncertainty for ' + shortInText(v) + '.' }
      : null;
  }

  /** Every year of the record, with its band and the fitted slope the build published. */
  function drawVarYears(key) {
    const v = VARS[key];
    const met = ownMetric(v);
    return function (host) {
      const rows = YEAR_ROWS;
      const years = rows.map(r => r.y);
      const values = rows.map(r => varValue(r, key));
      const band = yearBand(key);
      const bandLo = values.map((x, i) => (isNum(x) && band && isNum(band.half[i])
        ? x - band.half[i] : null));
      const bandHi = values.map((x, i) => (isNum(x) && band && isNum(band.half[i])
        ? x + band.half[i] : null));

      const f = frame(host, { aspect: 0.36,
        ariaLabel: 'Annual ' + shortInText(v) + ', every year of the record' });
      const ext = extent([values, bandLo, bandHi]);
      const pad = (ext[1] - ext[0]) * 0.12 || 1;
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0] - pad, ext[1] + pad, f.m.top + f.ih, f.m.top);
      const every = Math.max(1, Math.ceil(years.length / Math.max(3, Math.floor(f.iw / 54))));
      drawAxes(f, sx, sy, { yDigits: v.digits, yLabel: v.units,
        xTicks: years.filter((y, i) => i % every === 0 || i === years.length - 1)
          .map(y => ({ v: y, label: String(y) })) });

      // Zero is a boundary rather than a gridline for a variable whose sign means something.
      if (v.sign && ext[0] < 0 && ext[1] > 0) {
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0),
          stroke: f.p.ink, 'stroke-width': 1.2, opacity: 0.5 }, f.svg);
      }
      if (band) {
        el('path', { d: areaFrom(years, bandLo, bandHi, sx, sy), fill: f.p.bandOuter,
          opacity: 0.75 }, f.svg);
      }
      const t = met && met.trend_year;
      if (t && t.fit) {
        el('line', { x1: sx(t.y0), x2: sx(t.y1), y1: sy(t.fit[0]), y2: sy(t.fit[1]),
          stroke: f.p.ink, 'stroke-width': 2, 'stroke-dasharray': '6 4' }, f.svg);
      }
      el('path', { d: pathFrom(years, values, sx, sy), fill: 'none', stroke: f.p.series[0],
        'stroke-width': 2.2, 'stroke-linejoin': 'round' }, f.svg);
      years.forEach((y, i) => {
        if (!isNum(values[i])) return;
        el('circle', { cx: sx(y), cy: sy(values[i]), r: 3, fill: f.p.series[0] }, f.svg);
      });

      hover(f, sx, years, y => {
        const i = years.indexOf(y);
        const row = rows[i];
        const lines = [{ k: v.short, v: isNum(values[i]) ? nf(values[i], v.digits) + ' ' + v.units
          : 'no value', color: f.p.series[0] }];
        const sense = row ? senseOf(v, values[i]) : null;
        if (sense) lines.push({ k: 'Direction', v: sense });
        if (band && isNum(band.half[i])) {
          lines.push({ k: band.label.replace('± ', ''), v: '± ' + nfu(band.half[i], v.digits)
            + ' ' + v.units, color: 'var(--band-outer)' });
        }
        if (row && isNum(row[key].r)) {
          lines.push({ k: 'Rank', v: ord(row[key].r) + ' of ' + row[key].n + ' years'
            + (v.rank_note ? ' (1st = ' + v.rank_note + ')' : '') });
        }
        if (row && isNum(row[key].meas)) {
          lines.push({ k: 'Measured', v: nf(row[key].meas, 0) + ' %' });
        }
        return tipRows(String(y), lines);
      }, y => { location.hash = y + '-' + M.year_slug; });
    };
  }

  /** The shape of the year: each calendar month's normal, its spread, and its full range. */
  function drawVarCycle(key) {
    const v = VARS[key];
    return function (host) {
      const clim = CLIM[key] || {};
      const months = [];
      for (let m = 1; m <= 12; m++) months.push(clim[String(m)] || null);
      const f = frame(host, { aspect: 0.4,
        ariaLabel: 'Normal, standard deviation and range of ' + shortInText(v)
          + ' by calendar month' });
      const all = [];
      months.forEach(n => { if (n) all.push(n.min, n.max); });
      if (!all.length) {
        svgText(f.svg, f.width / 2, f.height / 2, 'No calendar month has a normal', 'ax-text',
          { 'text-anchor': 'middle' });
        return;
      }
      const ext = extent([all]);
      const sx = linear(0.5, 12.5, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0], ext[1], f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: v.digits, yLabel: v.units,
        xTicks: MONTH_ABBR.map((label, i) => ({ v: i + 1, label: label[0] })) });

      // The range across the record, then one standard deviation, then the normal itself: three
      // bands rather than one line, because "the normal January" is a distribution.
      const bw = Math.max(8, f.iw / 12 - 12);
      months.forEach((n, i) => {
        if (!n) return;
        const m = i + 1;
        el('rect', { x: sx(m) - bw / 2, y: sy(n.max), width: bw,
          height: Math.max(1, sy(n.min) - sy(n.max)), rx: 3, fill: f.p.bandOuter, opacity: 0.55 },
        f.svg);
        el('rect', { x: sx(m) - bw / 2, y: sy(n.mean + n.sd), width: bw,
          height: Math.max(1, sy(n.mean - n.sd) - sy(n.mean + n.sd)), rx: 2,
          fill: f.p.series[0], opacity: 0.35 }, f.svg);
        el('line', { x1: sx(m) - bw / 2, x2: sx(m) + bw / 2, y1: sy(n.mean), y2: sy(n.mean),
          stroke: f.p.series[0], 'stroke-width': 2.4 }, f.svg);
      });
      hover(f, sx, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], m => {
        const n = months[m - 1];
        if (!n) return tipRows(MONTH_NAME[m - 1], [{ k: 'Normal', v: 'not enough years' }]);
        return tipRows(MONTH_NAME[m - 1], [
          { k: 'Normal', v: nf(n.mean, v.digits) + ' ' + v.units + ' (' + n.n + ' years)' },
          { k: 'Standard deviation', v: nf(n.sd, v.digits) + ' ' + v.units },
          { k: 'Highest', v: nf(n.max, v.digits) + ' in ' + n.max_year },
          { k: 'Lowest', v: nf(n.min, v.digits) + ' in ' + n.min_year }
        ]);
      });
    };
  }

  /* How strongly each fill level is drawn: one hue, fading a step for each level further from the
     instrument, so the measured part stays the one that reads and the fill sits quietly above it.
     The same steps serve the bars (as an opacity) and the legend and tooltip swatches (as a mix). */
  const FILL_OPACITY = [0.55, 0.36, 0.22, 0.12];
  const fillOpacity = i => FILL_OPACITY[Math.min(i, FILL_OPACITY.length - 1)];
  const fillSwatch = i => 'color-mix(in srgb, var(--series-1) ' + Math.round(fillOpacity(i) * 100)
    + '%, transparent)';

  /**
   * The net flux a partitioning product (GPP, RECO) was modelled from, named by its flag: the
   * column where the flag is an NEE one, and null where the build carries no such flag, in which
   * case nothing about the product's hours can be called measured.
   */
  function partitionedFrom(v) {
    if (!v.partitioned || !v.fill || !/^NEE.*_QC$/.test(v.fill.flag)) return null;
    return v.fill.flag.replace(/_QC$/, '');
  }

  /** What share of each year was measured rather than modelled, which qualifies everything above. */
  function drawVarCoverage(key) {
    const v = VARS[key];
    const nee = partitionedFrom(v);
    // A partitioning product read without any flag has no measured share to draw.
    const noMeas = v.partitioned && !v.fill;
    const measLabel = nee ? nee + ' measured' : 'Measured';
    return function (host) {
      const years = YEAR_ROWS.map(r => r.y);
      const meas = YEAR_ROWS.map(r => (!noMeas && r[key] && isNum(r[key].meas) ? r[key].meas
        : null));
      const avail = YEAR_ROWS.map(r => (r[key] && isNum(r[key].avail) ? r[key].avail : null));
      /* How the rest of each year was filled, one share per level of the variable's flag, stacked
         on the measured bar. A variable read without a flag has none, and its bars are as before. */
      const levels = v.fill ? v.fill.levels : [];
      const fills = YEAR_ROWS.map(r => (r[key] && r[key].f) || []);
      const f = frame(host, { aspect: 0.3, ariaLabel: nee
        ? v.short + ': share of each year with ' + nee + ' measured'
        : (noMeas ? 'Available' : 'Measured') + ' share of ' + shortInText(v) + ' by year' });
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(0, 100, f.m.top + f.ih, f.m.top);
      const every = Math.max(1, Math.ceil(years.length / Math.max(3, Math.floor(f.iw / 54))));
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: '%', yTicks: [0, 25, 50, 75, 100],
        xTicks: years.filter((y, i) => i % every === 0 || i === years.length - 1)
          .map(y => ({ v: y, label: String(y) })) });
      const bw = Math.max(3, f.iw / years.length - 5);
      years.forEach((y, i) => {
        if (isNum(avail[i])) {
          el('rect', { x: sx(y) - bw / 2, y: sy(avail[i]), width: bw,
            height: Math.max(1, sy(0) - sy(avail[i])), rx: 2, fill: f.p.bandOuter, opacity: 0.7 },
          f.svg);
        }
        if (isNum(meas[i])) {
          el('rect', { x: sx(y) - bw / 2, y: sy(meas[i]), width: bw,
            height: Math.max(1, sy(0) - sy(meas[i])), rx: 2, fill: f.p.series[0], opacity: 0.85 },
          f.svg);
          // Each share is rounded on its own, so the stack is capped at the top of the axis.
          let base = meas[i];
          fills[i].forEach((p, j) => {
            if (!(p > 0) || !levels[j] || base >= 100) return;
            const top = Math.min(100, base + p);
            el('rect', { x: sx(y) - bw / 2, y: sy(top), width: bw,
              height: Math.max(1, sy(base) - sy(top)), fill: f.p.series[0],
              opacity: fillOpacity(j) }, f.svg);
            base = top;
          });
        }
      });
      el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(v.cov.warn), y2: sy(v.cov.warn),
        stroke: f.p.warm, 'stroke-width': 1.4, 'stroke-dasharray': '5 3' }, f.svg);
      hover(f, sx, years, y => {
        const i = years.indexOf(y);
        const rows = [
          { k: 'Available', v: isNum(avail[i]) ? nf(avail[i], 0) + ' %' : '—', color: f.p.bandOuter }
        ];
        if (!noMeas) {
          rows.push({ k: measLabel, v: isNum(meas[i]) ? nf(meas[i], 0) + ' %' : '—',
            color: f.p.series[0] });
        }
        levels.forEach((label, j) => {
          rows.push({ k: nee ? nee + ' ' + esc(label) : cap(esc(label)),
            v: nf(fills[i][j] || 0, 0) + ' %', color: fillSwatch(j) });
        });
        const R = recordOf(key);
        if (R && isNum(R.gap_h[i])) {
          rows.push({ k: 'Longest gap', v: nf(R.gap_h[i], 1) + ' h' });
        }
        return tipRows(String(y), rows);
      });
    };
  }

  /* ------------------------------------------------------------------------------------------
     A total, accumulated through the year
     ------------------------------------------------------------------------------------------
     The standard figure of a flux site: the running total of daily net exchange from 1 January,
     one line per year. Where a year's line sits in July says how far into the season its uptake
     had got; where it ends says what the year came to; and the others around it say whether
     either was unusual. It is drawn for every variable that sums, since the same question - how
     the year's total built up, and whether it built up early or late - is as fair a question of
     precipitation as of carbon.

     A missing day enters exactly as it does in the span panel's accumulated precipitation: it adds
     nothing, and the line holds level across it. The card says so and counts the days, because a
     running total that silently skips a week is short by whatever that week carried.

     Built on the calendar year rather than the day-of-year the normals fold onto: a running total
     cannot drop 29 February without dropping what it carried. A leap year runs one day longer, one
     pixel in three hundred and sixty-six, which the raster accepts on the same grounds.
     ------------------------------------------------------------------------------------------ */

  /** Whether a variable sums, and the build shipped the daily totals a running total is made of. */
  const hasCumulative = v => v.agg === 'sum' && !!DAYS.series[v.key + '_sum'];

  /** One running total per year of the record, with the count of missing days to each date. */
  function cumulativeTracks(key) {
    return YEARS.map(y => {
      const start = dayIndex(y, 1, 1);
      const len = isLeap(y) ? 366 : 365;
      const run = [], gaps = [];
      let acc = 0, seen = false, missing = 0;
      for (let d = 0; d < len; d++) {
        const i = start + d;
        const v = i >= 0 && i < DAYS.n ? dayStat(key, 'sum', i) : null;
        if (isNum(v)) { acc += v; seen = true; } else missing += 1;
        // Nothing is drawn before the first value, as in the span panel: a line that began at
        // zero would claim the days before it had been measured and had carried nothing.
        run.push(seen ? acc : null);
        gaps.push(missing);
      }
      return { y: y, run: run, gaps: gaps, missing: missing };
    });
  }

  /** The running total of the daily normals, on the ordinary-year calendar they are built on. */
  function cumulativeNormal(key) {
    const n = NORM[key] && NORM[key].sum;
    if (!n) return null;
    const out = [];
    let acc = 0;
    for (let d = 1; d <= 365; d++) {
      if (isNum(n.mean[d])) acc += n.mean[d];
      out.push(acc);
    }
    return out;
  }

  function drawCumulative(key, focus, onPanel) {
    const v = VARS[key];
    return function (host) {
      const tracks = cumulativeTracks(key);
      const normal = cumulativeNormal(key);
      const here = tracks.find(t => t.y === focus);
      const days = [];
      for (let d = 1; d <= 366; d++) days.push(d);

      const f = frame(host, { aspect: 0.4,
        ariaLabel: 'Cumulative ' + shortInText(v) + ' from 1 January, every year of the record, '
          + focus + ' highlighted' });
      const ext = extent(tracks.map(t => t.run).concat(normal ? [normal] : []));
      // Zero is always on the axis: it is where every line starts, and for a signed variable it
      // is the boundary between the two words the page uses for the sign.
      const lo = Math.min(0, ext[0]), hi = Math.max(0, ext[1]);
      const pad = (hi - lo) * 0.06 || 1;
      const sx = linear(1, 366, f.m.left, f.m.left + f.iw);
      const sy = linear(lo - (lo < 0 ? pad : 0), hi + (hi > 0 ? pad : 0), f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: v.units,
        xTicks: MONTH_START.map((doy, i) => ({ v: doy, label: MONTH_ABBR[i] }))
          .filter((t, i) => f.iw > 520 || i % 2 === 0) });

      /* Which side of zero means what, painted rather than only stated. Green is uptake and red
         release everywhere on this page; the tint is faint so the lines stay the subject. */
      if (v.sign) {
        const zero = sy(0);
        if (zero > f.m.top) {
          el('rect', { x: f.m.left, y: f.m.top, width: f.iw, height: zero - f.m.top,
            fill: 'var(--pole-warm)', opacity: 0.07 }, f.svg);
          svgText(f.svg, f.m.left + f.iw - 6, f.m.top + 13, 'net ' + v.sign.high, 'ax-text',
            { 'text-anchor': 'end' });
        }
        if (zero < f.m.top + f.ih) {
          el('rect', { x: f.m.left, y: zero, width: f.iw, height: f.m.top + f.ih - zero,
            fill: 'var(--series-3)', opacity: 0.08 }, f.svg);
          svgText(f.svg, f.m.left + f.iw - 6, f.m.top + f.ih - 7, 'net ' + v.sign.low, 'ax-text',
            { 'text-anchor': 'end' });
        }
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: zero, y2: zero,
          stroke: f.p.ink, 'stroke-width': 1.2, opacity: 0.5 }, f.svg);
      }

      tracks.filter(t => t.y !== focus).forEach(t => {
        el('path', { d: pathFrom(days, t.run, sx, sy), fill: 'none', stroke: f.p.ink2,
          'stroke-width': 1.1, opacity: 0.26, 'stroke-linejoin': 'round' }, f.svg);
      });
      if (normal) {
        el('path', { d: pathFrom(days, normal, sx, sy), fill: 'none', stroke: f.p.muted,
          'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, f.svg);
      }
      if (here) {
        el('path', { d: pathFrom(days, here.run, sx, sy), fill: 'none', stroke: f.p.series[1],
          'stroke-width': 2.6, 'stroke-linejoin': 'round' }, f.svg);
      }

      /* Ranked the way the variable ranks everywhere else, so rank 1 of a net exchange is the
         largest uptake by that date rather than the largest number. */
      const low = v.rank_first === 'low';
      hover(f, sx, days, d => {
        const at = new Date(Date.UTC(focus, 0, d));
        const title = 'to ' + at.getUTCDate() + ' ' + MONTH_NAME[at.getUTCMonth()] + ' ' + focus;
        const value = here ? here.run[d - 1] : null;
        const others = tracks.filter(t => t.y !== focus).map(t => t.run[d - 1]).filter(isNum)
          .sort((a, b) => a - b);
        const sense = senseOf(v, value);
        const rows = [{ k: String(focus), v: isNum(value)
          ? nf(value, 0) + ' ' + v.units + (sense ? ', ' + sense : '') : 'no value',
        color: f.p.series[1] }];
        if (normal && d <= 365) {
          rows.push({ k: 'normal by this date', v: nf(normal[d - 1], 0) + ' ' + v.units,
            color: f.p.muted });
        }
        if (others.length) {
          rows.push({ k: 'other years, range', v: nf(others[0], 0) + ' to '
            + nf(others[others.length - 1], 0) + ' ' + v.units, color: f.p.ink2 });
        }
        if (isNum(value) && others.length) {
          const ahead = others.filter(x => (low ? x < value : x > value)).length;
          rows.push({ k: 'rank by this date', v: ord(ahead + 1) + ' of ' + (others.length + 1)
            + ' (1st = ' + (v.rank_note || 'highest') + ')' });
        }
        if (here && here.gaps[d - 1]) {
          rows.push({ k: 'missing days to date', v: here.gaps[d - 1] + ', each adding zero' });
        }
        return tipRows(title, rows);
      }, onPanel ? d => selectDay(Math.min(d, isLeap(focus) ? 366 : 365)) : null);
    };
  }

  /** The card around it, which says which year is drawn over the others and how gaps entered. */
  function cumulativeCard(parent, v, focus, onPanel) {
    const tracks = cumulativeTracks(v.key);
    const gappy = tracks.filter(t => t.missing > 0).length;
    const legend = [
      { color: 'var(--series-2)', label: String(focus), line: true },
      { color: 'var(--text-secondary)', label: 'other years', line: true }
    ];
    if (NORM[v.key] && NORM[v.key].sum) {
      legend.push({ color: 'var(--text-muted)', label: 'normal', line: true });
    }
    if (v.sign) {
      legend.push({ color: 'var(--series-3)', label: 'net ' + v.sign.low },
        { color: 'var(--pole-warm)', label: 'net ' + v.sign.high });
    }
    chartCard(parent, {
      title: 'Cumulative ' + shortInText(v) + ' from 1 January', width: 'w-12',
      sub: 'Running total of the daily values from 1 January, one line per year. '
        + (onPanel ? focus : 'The last year of the record, ' + focus + ',')
        + ' is highlighted; the dashed line is the running total of the daily normals.'
        + (v.sign ? ' Below zero the cumulative balance is net ' + v.sign.low
          + ', above zero net ' + v.sign.high + '.' : '')
        + (onPanel ? ' Select a date to open that day.' : ''),
      legend: legend,
      foot: 'A missing day adds zero, so the running total stays level across it, as in the '
        + 'cumulative precipitation of a span panel. A year with missing days is therefore short '
        + 'by whatever those days carried. '
        + (gappy ? gappy + ' of the ' + tracks.length + ' years '
          + (gappy === 1 ? 'has' : 'have') + ' at least one missing day; the tooltip gives the '
          + 'count to each date.'
          : 'No year has a missing day.'),
      draw: drawCumulative(v.key, focus, onPanel),
      table: onPanel ? null : () => tableHTML(['Year'].concat(MONTH_ABBR.map(m => 'to end of ' + m)),
        tracks.map(t => ['<a href="#' + t.y + '-' + M.year_slug + '">' + t.y + '</a>']
          .concat(MONTH_ABBR.map((m, i) => {
            const end = dayIndex(t.y, i + 2, 1) - dayIndex(t.y, 1, 1);
            return nf(t.run[end - 1], 0);
          }))))
    });
  }

  /* ------------------------------------------------------------------------------------------
     The variable page at daily resolution
     ------------------------------------------------------------------------------------------
     The span panel asks two questions of a month: how did its days run against the normal for
     their own dates, and how far did each of them sit from it. Both are worth asking of the whole
     record, and the answers are different in kind rather than only in length.

     Over one month the days are drawn along the month. Over twenty-one years they are drawn along
     the year, every year at once: 7,670 marks on one axis is a texture rather than a series, and
     what a reader can actually read off the daily scale at that length is where in the year the
     variable varies and where it holds still. The departures keep the record's own axis, since
     that is the one question the year-of-day view cannot answer, and carry a year-long running
     mean so the drift is visible under the noise.
     ------------------------------------------------------------------------------------------ */

  /** The daily statistic a variable is read by: the one its own metric draws, or its aggregation. */
  function dailyStatOf(v) {
    const met = ownMetric(v);
    if (met && met.day && met.day.stat && (met.day.kind === 'value' || met.day.kind === 'anom')) {
      return met.day.stat;
    }
    return v.agg === 'sum' ? 'sum' : 'mean';
  }

  const hasDaily = v => {
    const stat = dailyStatOf(v);
    return !!(DAYS.series[v.key + '_' + stat] && NORM[v.key] && NORM[v.key][stat]);
  };

  /** Every year of the record drawn along the year, over the normal band for each date. */
  function drawVarDailyCycle(key) {
    const v = VARS[key];
    const stat = dailyStatOf(v);
    return function (host) {
      const norm = NORM[key][stat];
      const doys = [];
      for (let d = 1; d <= 365; d++) doys.push(d);

      // One track per year, laid on the day-of-year axis. 29 February folds onto 1 March, exactly
      // as the normals were built, so the tracks and the band share one x axis.
      const tracks = YEARS.map(() => new Array(366).fill(null));
      for (let i = 0; i < DAYS.n; i++) {
        const at = dateAt(i);
        const row = at.y - M.first_year;
        if (row < 0 || row >= tracks.length) continue;
        tracks[row][doy365(at.y, at.m, at.d)] = dayStat(key, stat, i);
      }

      const f = frame(host, { aspect: 0.36,
        ariaLabel: 'Daily ' + shortInText(v) + ' by day of year, every year of the record' });
      const ext = extent([norm.p10, norm.p90].concat(tracks.map(t => t.slice(1))));
      const pad = (ext[1] - ext[0]) * 0.04 || 1;
      const sx = linear(1, 365, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0] - pad, ext[1] + pad, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: v.digits, yLabel: v.units,
        xTicks: MONTH_ABBR.map((label, i) => ({ v: doy365(2001, i + 1, 1), label: label })) });

      el('path', { d: areaFrom(doys, doys.map(d => norm.p10[d]), doys.map(d => norm.p90[d]), sx, sy),
        fill: f.p.bandOuter, opacity: 0.8 }, f.svg);
      tracks.forEach(track => {
        el('path', { d: pathFrom(doys, doys.map(d => track[d]), sx, sy), fill: 'none',
          stroke: f.p.series[0], 'stroke-width': 0.7, opacity: 0.4 }, f.svg);
      });
      el('path', { d: pathFrom(doys, doys.map(d => norm.mean[d]), sx, sy), fill: 'none',
        stroke: f.p.ink, 'stroke-width': 2, 'stroke-dasharray': '5 3' }, f.svg);

      hover(f, sx, doys.filter(d => d % 5 === 1), d => {
        const values = tracks.map(t => t[d]).filter(isNum);
        const at = new Date(Date.UTC(2001, 0, d));
        return tipRows(at.getUTCDate() + ' ' + MONTH_NAME[at.getUTCMonth()], [
          { k: 'Normal', v: nf(norm.mean[d], v.digits) + ' ' + v.units, color: f.p.ink },
          { k: '10th–90th percentile', v: nf(norm.p10[d], v.digits) + ' to '
            + nf(norm.p90[d], v.digits),
            color: 'var(--band-outer)' },
          { k: 'Years drawn', v: String(values.length) }
        ]);
      });
    };
  }

  /* How far every day of the record sat from the normal for its own date, and the year-long mean
     of those departures. The bars are the same statement the month panel makes; the running mean
     is what only this length can show, since a departure that persists for years is a different
     thing from one that persists for a fortnight. */
  function drawVarDailyDeparture(key) {
    const v = VARS[key];
    const stat = dailyStatOf(v);
    return function (host) {
      const norm = NORM[key][stat];
      const dev = new Array(DAYS.n).fill(null);
      for (let i = 0; i < DAYS.n; i++) {
        const at = dateAt(i);
        const value = dayStat(key, stat, i);
        const mid = norm.mean[doy365(at.y, at.m, at.d)];
        if (isNum(value) && isNum(mid)) dev[i] = value - mid;
      }

      // A centred year of departures, which is the shortest window that removes the seasonal cycle
      // from a daily series without also removing what a reader came here to see.
      const win = 365, half = Math.floor(win / 2);
      const run = new Array(DAYS.n).fill(null);
      let acc = 0, seen = 0;
      for (let i = 0; i < DAYS.n; i++) {
        if (isNum(dev[i])) { acc += dev[i]; seen += 1; }
        const out = i - win;
        if (out >= 0 && isNum(dev[out])) { acc -= dev[out]; seen -= 1; }
        if (i >= win - 1 && seen > win / 2) run[i - half] = acc / seen;
      }

      const f = frame(host, { aspect: 0.3,
        ariaLabel: 'Daily departure of ' + shortInText(v) + ' from the normal for the date' });
      const ext = extent([dev]);
      const span = Math.max(Math.abs(ext[0]), Math.abs(ext[1]), 1) * 1.06;
      const sx = linear(0, DAYS.n, f.m.left, f.m.left + f.iw);
      const sy = linear(-span, span, f.m.top + f.ih, f.m.top);
      const every = Math.max(1, Math.ceil(YEARS.length / Math.max(3, Math.floor(f.iw / 54))));
      drawAxes(f, sx, sy, { yDigits: v.digits > 1 ? 1 : 0, yLabel: v.units,
        xTicks: YEARS.filter((y, i) => i % every === 0)
          .map(y => ({ v: dayIndex(y, 1, 1), label: String(y) })) });

      /* Twenty-one years of days is roughly thirteen days to the pixel, so a bar each would draw
         a smear a fraction of a pixel wide and pile its opacity up into a solid block. Each pixel
         column gets the range of the days that fall in it instead: the warm half from zero up to
         the highest, the cold half from zero down to the lowest. The result is the same chart the
         month panel draws, at the only resolution this length has. */
      const cols = Math.max(1, Math.round(f.iw));
      const hi = new Array(cols).fill(null), lo = new Array(cols).fill(null);
      for (let i = 0; i < DAYS.n; i++) {
        if (!isNum(dev[i])) continue;
        const c = Math.min(cols - 1, Math.floor(i / DAYS.n * cols));
        if (hi[c] === null || dev[i] > hi[c]) hi[c] = dev[i];
        if (lo[c] === null || dev[i] < lo[c]) lo[c] = dev[i];
      }
      const bw = f.iw / cols;
      for (let c = 0; c < cols; c++) {
        if (hi[c] === null) continue;
        const x = f.m.left + c * bw;
        if (hi[c] > 0) {
          el('rect', { x: x, y: sy(hi[c]), width: bw,
            height: Math.max(0.8, sy(0) - sy(hi[c])), fill: f.p.warm }, f.svg);
        }
        if (lo[c] < 0) {
          el('rect', { x: x, y: sy(0), width: bw,
            height: Math.max(0.8, sy(lo[c]) - sy(0)), fill: f.p.cold }, f.svg);
        }
      }
      el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0),
        stroke: f.p.axis, 'stroke-width': 1 }, f.svg);
      el('path', { d: pathFrom(run.map((x, i) => i), run, sx, sy), fill: 'none',
        stroke: f.p.ink, 'stroke-width': 2 }, f.svg);

      hover(f, sx, YEARS.map(y => dayIndex(y, 7, 1)), i => {
        const at = dateAt(i);
        return tipRows(String(at.y), [
          { k: '365-day running mean', v: isNum(run[i]) ? nfs(run[i], v.digits) + ' ' + v.units
            : 'too few days', color: f.p.ink }
        ]);
      }, i => { location.hash = dateAt(i).y + '-' + M.year_slug; });
    };
  }

  /** The per-month slopes as a table, for the reader who wants the numbers rather than the bars. */
  function monthlyTrendTable(key) {
    const met = ownMetric(VARS[key]);
    if (!met || !met.trend) return '';
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const t = met.trend[String(m)];
      if (!t) continue;
      const sig = isNum(t.p) && t.p < TREND_ALPHA;
      rows.push('<tr><th scope="row">' + MONTH_NAME[m - 1] + '</th>'
        + '<td>' + (isNum(t.slope) ? nfs(t.slope, met.digits + 1) : '—') + '</td>'
        + '<td>' + (isNum(t.lo) ? nfs(t.lo, met.digits + 1) + ' to ' + nfs(t.hi, met.digits + 1)
          : '—') + '</td>'
        + '<td>' + (isNum(t.p) ? nf(t.p, 3) + (sig ? ' *' : '') : '—') + '</td>'
        + '<td>' + t.n + '</td></tr>');
    }
    if (!rows.length) return '';
    return '<div class="tablewrap"><table class="datatable"><thead><tr>'
      + '<th scope="col">Calendar month</th><th scope="col">Slope, ' + met.units + ' / decade</th>'
      + '<th scope="col">95 % interval</th><th scope="col">Kendall p</th>'
      + '<th scope="col">Years</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  /** The links out of the variable page: the months where this variable did something extreme. */
  function varMoments(key) {
    const v = VARS[key];
    const rows = varSpans(key).slice().sort((a, b) => b[key].v - a[key].v);
    if (!rows.length) return '';
    const top = rows.slice(0, 5);
    const bottom = rows.slice(-5).reverse();
    const item = mo => '<li><a href="#' + mo.y + '-' + String(mo.m).padStart(2, '0') + '">'
      + MONTH_NAME[mo.m - 1] + ' ' + mo.y + '</a> <b>' + nf(mo[key].v, v.digits) + '</b> '
      + v.units + (senseOf(v, mo[key].v) ? ', ' + senseOf(v, mo[key].v) : '')
      + (isNum(mo[key].a) ? ' (' + nfs(mo[key].a, v.digits) + ')' : '') + '</li>';
    /* Named from the registry's own words for each end. "The highest five months" of NEE are its
       largest releases, which is not what a reader takes "highest" to mean at a flux site. */
    const head = (side, word) => cap(side) + ' five months'
      + (word ? ' <span class="muted">(' + word + ')</span>' : '');
    /* Where every listed month sits on one side of zero, the registry's word for that end can be
       false: at a site that is a sink in every month the five highest are its smallest uptakes, not
       its largest releases. Each item already states its own direction; the header follows it. */
    const all = (list, test) => list.length && list.every(mo => isNum(mo[key].v) && test(mo[key].v));
    const highWord = v.sign && all(top, x => x <= 0) ? 'smallest net ' + v.sign.low : v.word_high;
    const lowWord = v.sign && all(bottom, x => x >= 0) ? 'smallest net ' + v.sign.high : v.word_low;
    return '<div class="twocol"><div><h4>' + head('highest', highWord)
      + '</h4><ul class="ranklist">' + top.map(item).join('') + '</ul></div>'
      + '<div><h4>' + head('lowest', lowWord) + '</h4><ul class="ranklist">'
      + bottom.map(item).join('') + '</ul></div></div>';
  }

