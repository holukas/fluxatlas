  /* ------------------------------------------------------------------------------------------
     Level 1: the grid
     ------------------------------------------------------------------------------------------ */

  function buildControls() {
    const host = document.getElementById('controls');
    /* Grouped rather than listed flat: sixteen metrics in one run have to be read end to end
       before a reader knows what the page can show them. */
    let html = '<div class="control"><label for="metric-pick">Colour by metric</label>'
      + '<select class="picker" id="metric-pick">';
    const seen = [];
    DATA.metrics.forEach(m => {
      const g = m.group || 'Other';
      if (seen.indexOf(g) < 0) seen.push(g);
    });
    seen.forEach(g => {
      html += '<optgroup label="' + g + '">';
      DATA.metrics.filter(m => (m.group || 'Other') === g).forEach(m => {
        html += '<option value="' + m.key + '">' + m.label + '</option>';
      });
      html += '</optgroup>';
    });
    html += '</select></div>'
      + '<div class="control" id="detail-control"><span class="control-label">Detail</span>'
      + '<div class="switchrow">'
      + '<label class="switch"><input type="checkbox" id="strip-toggle" checked>'
      + 'Show daily strips</label>'
      + '<label class="switch"><input type="checkbox" id="badge-toggle">'
      + 'Show all badges</label></div></div>'
      + '<div class="control"><label for="scale-pick">Scale</label>'
      + '<select class="picker narrow" id="scale-pick">'
      + '<option value="month">Months</option>'
      + (SEASON_DEFS.length
        ? '<option value="season">Seasons (' + SEASON_DEFS.map(d => d.key).join(', ') + ')</option>'
        : '')
      + '<option value="year">Years</option>'
      + '<option value="day">Days</option></select></div>'
      + '<div class="control" id="csv-control"><span class="control-label">Export</span>'
      + '<button type="button" class="btn" id="csv-download">Download CSV</button></div>'
      + '<p class="control-note" id="metric-about"></p>';
    host.innerHTML = html;

    const pick = document.getElementById('metric-pick');
    pick.value = state.metric;
    pick.addEventListener('change', () => {
      state.metric = pick.value;
      renderGrid();
      syncAddress();
    });
    document.getElementById('csv-download').addEventListener('click', downloadGrid);
    document.getElementById('strip-toggle').addEventListener('change', ev => {
      state.strips = ev.target.checked;
      renderGrid();
    });
    /* Letting the chips wrap makes the busiest month set the height of its whole row, so it is a
       choice rather than the default: compact keeps the grid even, and the tooltip carries the
       full list either way. */
    const scalePick = document.getElementById('scale-pick');
    scalePick.value = state.grid;
    /* Switching scale re-reads the same registries against a different list of spans; the metric,
       the badge filter and the strips all survive it. The day raster is not a span scale, so it
       moves `grid` alone and leaves the month view walking whichever spans it walked before. */
    scalePick.addEventListener('change', () => {
      setGrid(scalePick.value);
      renderGrid();
      syncAddress();
    });
    document.getElementById('badge-toggle').addEventListener('change', ev => {
      state.allBadges = ev.target.checked;
      document.getElementById('calgrid').classList.toggle('all-badges', state.allBadges);
      renderGrid();
    });
  }

  /**
   * Move the grid to one of its three resolutions, and everything that has to move with it.
   *
   * The two switches that describe a tile are hidden rather than disabled at the raster, where a
   * mark is one day and carries neither a strip of its own days nor a badge. A control that is
   * present but inert reads as a control that is broken.
   */
  function setGrid(which) {
    state.grid = which;
    if (which !== 'day') state.scale = which;
    const grid = document.getElementById('calgrid');
    grid.classList.toggle('seasons', which === 'season');
    grid.classList.toggle('years', which === 'year');
    grid.classList.toggle('raster', which === 'day');
    grid.setAttribute('aria-label', which === 'day' ? 'Every day of the record'
      : which === 'season' ? 'Seasons of the record'
        : which === 'year' ? 'Years of the record' : 'Months of the record');
    const detail = document.getElementById('detail-control');
    if (detail) detail.hidden = which === 'day';
    const pick = document.getElementById('scale-pick');
    if (pick && pick.value !== which) pick.value = which;
  }

  /* ------------------------------------------------------------------------------------------
     The grid as a table
     ------------------------------------------------------------------------------------------
     What the grid shows, as CSV: the active metric at the active scale, a row per year and a
     column per span, and the year's figure from the margin beside them. The values are the ones
     the tiles are coloured by, unrounded beyond what the page ships; the year's figure is the
     margin's own, formed the same way from whatever spans carry a value. A span without a value
     is an empty cell, never `NaN` or `null`, which a spreadsheet would read as text.

     The file is written with a byte-order mark, since the units carry characters outside ASCII and
     a spreadsheet opening a CSV without one guesses a legacy code page and mangles every unit. It
     is built in the page and handed over as a Blob, so it works from disk with no server.
     ------------------------------------------------------------------------------------------ */

  const csvCell = s => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

  /** A number as a CSV cell, at no more decimals than asked for, and empty where there is none. */
  const csvNum = (v, d) => (isNum(v) ? String(d === undefined ? v : Number(v.toFixed(d))) : '');

  function gridTable() {
    const met = metric();
    const unit = met.units ? ' (' + met.units + ')' : '';
    if (state.grid === 'day') {
      /* One column per calendar date, 29 February included, so every year's row lines up under
         the same header; the date is empty in a year that does not have it. A threshold day is
         1 or 0, which is all the raster marks it as. */
      const dates = [];
      for (let k = 0; k < 366; k++) {
        const t = new Date(Date.UTC(2000, 0, 1 + k));
        dates.push([t.getUTCMonth() + 1, t.getUTCDate()]);
      }
      const flag = met.day.kind === 'flag';
      const d = VARS[met.var] ? VARS[met.var].digits + 1 : met.digits + 1;
      const head = ['year'].concat(dates.map(md => MONTH_ABBR[md[0] - 1] + ' ' + pad2(md[1])
        + (flag ? '' : unit)));
      const rows = YEARS.map(y => [String(y)].concat(dates.map(md => {
        if (md[0] === 2 && md[1] === 29 && !isLeap(y)) return '';
        const i = dayIndex(y, md[0], md[1]);
        if (i < 0 || i >= DAYS.n) return '';
        return csvNum(dayValue(met, i, y, md[0], md[1]), flag ? 0 : d);
      })));
      return [head].concat(rows);
    }
    const sc = scale();
    const cols = sc.cols();
    const atYear = state.scale === 'year';
    // A season is headed by its name and its months, since a derived scheme's name alone may not
    // say which months it holds.
    const colHead = c => (state.scale === 'season' && c.label !== c.id
      ? c.label + ' ' + c.id : c.label) + unit;
    // At the year scale the one column is the year's figure, and the margin states no number.
    const head = ['year'].concat(cols.map(colHead))
      .concat(atYear ? [] : [(summarises(met) ? 'year total' : 'year mean') + unit]);
    const rows = YEARS.map(y => {
      const values = cols.map(c => {
        const span = sc.at(y, c.id);
        return span ? monthValue(met, span) : null;
      });
      const row = [String(y)].concat(values.map(v => csvNum(v)));
      if (!atYear) row.push(csvNum(summarise(met, values.filter(isNum)), met.digits));
      return row;
    });
    return [head].concat(rows);
  }

  /** The file name: the site, the metric and the scale, in characters any file system accepts. */
  function gridFileName() {
    const safe = s => String(s).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
    return [safe(M.site) || 'atlas', safe(state.metric), state.grid].join('_') + '.csv';
  }

  function downloadGrid() {
    const text = gridTable().map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = gridFileName();
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked once the browser has had the chance to start the download, not before.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function cellTooltip(mo) {
    const rows = [];
    DATA.variables.forEach(v => {
      const rec = mo[v.key];
      if (!rec || !isNum(rec.v)) return;
      let line = nf(rec.v, v.digits) + ' ' + v.units;
      const sense = senseOf(v, rec.v);
      if (sense) line += ', ' + sense;
      if (isNum(rec.a)) {
        line += senseAnomaly(v, rec) ? ' (' + senseAnomaly(v, rec) + ')'
          : ' (' + nfs(rec.a, v.digits) + ')';
      }
      rows.push({ k: v.short, v: line });
    });
    if (mo.c.hot || mo.c.frost || mo.c.wet) {
      rows.push({ k: 'Threshold days',
        v: [mo.c.hot ? mo.c.hot + ' hot' : null, mo.c.frost ? mo.c.frost + ' frost' : null,
          mo.c.wet ? mo.c.wet + ' wet' : null].filter(Boolean).join(', ') });
    }
    if (isNum(mo.x.nsd)) {
      rows.push({ k: 'Beyond 1 sd',
        v: mo.x.nsd + ' of ' + mo.x.nz + ' variables at least one standard deviation from normal' });
    }
    /* Every badge, always - the tile shows four unless asked otherwise, so this is where a
       reader finds the rest without opening the month. */
    const badges = mo.b.length
      ? '<div class="tt-badges">' + mo.b.map(b =>
        '<span class="tt-badge">' + chip(b.k, 'sm') + BADGES[b.k].label + '</span>').join('')
        + '</div>'
      : '';
    return tipRows(scale().title(mo), rows) + badges;
  }

  function stripSVG(mo, met) {
    const parts = [];
    const w = 100 / mo.n;
    for (let d = 1; d <= mo.n; d++) {
      const i = mo.i0 + d - 1;
      const at = dateAt(i);
      const value = dayValue(met, i, at.y, at.m, at.d);
      const rgb = dayColor(met, value);
      if (!rgb) continue;
      parts.push('<rect x="' + ((d - 1) * w).toFixed(2) + '" y="0" width="'
        + (w * 0.84).toFixed(2) + '" height="10" fill="' + css(rgb) + '"/>');
    }
    return '<svg class="cell-strip" viewBox="0 0 100 10" preserveAspectRatio="none" '
      + 'aria-hidden="true">' + parts.join('') + '</svg>';
  }

  function matchesFilter(mo) {
    if (!state.filters.size) return true;
    return mo.b.some(b => state.filters.has(b.k));
  }

  /* The grid at whichever resolution is selected, and the three things that describe it whichever
     that is. The raster and the tiles share the scale bar and the note deliberately: they are the
     same metric on the same colour scale, drawn at two grains, and a reader moving between them
     should not have to re-read the legend. */
  function renderGrid() {
    compactCharts();
    if (state.grid === 'day') renderRaster(); else renderTileGrid();
    document.getElementById('metric-about').textContent = metric().about;
    /* A metric with no daily counterpart draws nothing at the raster, and a table of nothing is
       not offered. Hidden rather than disabled, like the detail switches beside it. */
    const csv = document.getElementById('csv-control');
    if (csv) csv.hidden = state.grid === 'day' && metric().day.kind === 'none';
    renderScaleBar();
    renderGridNote();
    // The legend counts per scale, so it is redrawn with the grid rather than once at load.
    renderBadgeLegend();
  }

  function renderTileGrid() {
    const met = metric();
    const host = document.getElementById('calgrid');
    const parts = [];

    const sc = scale();
    const cols = sc.cols();
    parts.push('<div class="calhead corner">Year</div>');
    cols.forEach(c => parts.push('<div class="calhead">' + c.label + '</div>'));
    parts.push('<div class="calhead total">'
      + (state.scale === 'year' ? 'Months' : summarises(met) ? 'Total' : 'Mean') + '</div>');

    YEARS.forEach(y => {
      parts.push('<div class="calyear' + (y % 5 === 0 ? ' decade' : '') + '">' + y + '</div>');
      const yearValues = [];
      for (const col of cols) {
        const mo = sc.at(y, col.id);
        const value = mo ? monthValue(met, mo) : null;
        if (isNum(value)) yearValues.push(value);
        if (!mo || !isNum(value)) {
          parts.push('<div class="cell empty" aria-hidden="true"></div>');
          continue;
        }
        const rgb = metricColor(met, value, 'month');
        const sparse = isNum(mo[met.var] && mo[met.var].meas)
          && mo[met.var].meas < cov(met.var).warn;
        const shown = state.allBadges ? mo.b : mo.b.slice(0, 4);
        const cls = ['cell', inkClass(rgb)];
        if (sparse) cls.push('sparse');
        if (!matchesFilter(mo)) cls.push('dim');
        else if (state.filters.size) cls.push('hit');

        let inner = '<span class="cell-value">' + metricFormat(met, value) + '</span>';
        const sub = monthSub(met, mo);
        if (sub) inner += '<span class="cell-sub">' + sub + '</span>';
        inner += '<span class="cell-badges">'
          + shown.map(b => chip(b.k, 'sm')).join('')
          + (mo.b.length > shown.length
            ? '<span class="more">+' + (mo.b.length - shown.length) + '</span>' : '')
          + '</span>';
        if (state.strips) inner += stripSVG(mo, met);

        parts.push('<button type="button" class="' + cls.join(' ') + '" style="background:'
          + css(rgb) + '" data-y="' + y + '" data-c="' + col.id + '" '
          + 'aria-label="' + sc.title(mo) + '">' + inner + '</button>');
      }
      /* At the year scale the row is one tile, so the margin would print its number twice. The
         sparkline is the part that still says something there - the shape of the year behind the
         one figure - so the number goes and the months stay. */
      const summary = summarise(met, yearValues);
      parts.push('<div class="calsummary">'
        + (state.scale === 'year' ? '<span class="k">months</span>'
          : '<span class="v">' + metricFormat(met, summary) + '</span>'
            + '<span class="k">' + (summarises(met) ? 'total' : 'mean') + '</span>')
        + yearSparkline(met, y) + '</div>');
    });

    /* The grid is read down its columns as well as across its rows - "was this a cold February"
       needs the other Februaries - so it closes with the figure for each calendar month over the
       whole record, and the record's own figure in the corner. Without it the year column is a
       margin the grid answers on one axis only. */
    /* A calendar month's figure across years is a *mean* even where the metric sums, because the
       quantity being described is one January and not twenty-one of them stacked. The corner then
       adds those twelve means where the metric sums - giving the mean year rather than the record
       total - and averages them where it does not. */
    /* The second line of the foot row is the slope of that column across the record. It belongs
       here rather than in a chart of its own: the mean above it is the normal every tile in the
       column is compared against, and the slope is the statement that the normal is not a fixed
       climate. Read together they say how much of a departure in a late year is the year and how
       much is the baseline. */
    parts.push('<div class="calfoot-label"><span>Mean</span>'
      + '<span class="sub">per decade</span></div>');
    const columnMeans = [];
    cols.forEach(col => {
      const values = YEARS.map(y => sc.at(y, col.id)).filter(Boolean)
        .map(mo => monthValue(met, mo)).filter(isNum);
      const mean = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length : null;
      columnMeans.push(mean);
      const rgb = isNum(mean) ? metricColor(met, mean, 'month') : null;
      parts.push('<div class="calfootcell' + (rgb ? ' ' + inkClass(rgb) : '') + '"'
        + (rgb ? ' style="background:' + css(rgb) + '"' : '')
        + ' data-col="' + col.id + '">'
        + '<span class="v">' + metricFormat(met, mean) + '</span>'
        + trendSpan(met, trendFor(met, col.id)) + '</div>');
    });
    const kept = columnMeans.filter(isNum);
    const whole = kept.length
      ? (summarises(met) ? kept.reduce((a, b) => a + b, 0)
        : kept.reduce((a, b) => a + b, 0) / kept.length) : null;
    parts.push('<div class="calfootcell record" data-col="record">'
      + '<span class="v">' + metricFormat(met, whole) + '</span>'
      + '<span class="k">' + (summarises(met) ? 'mean year' : 'record') + '</span>'
      + trendSpan(met, met.trend_year) + '</div>');

    host.innerHTML = parts.join('');
    host.querySelectorAll('.cell:not(.empty)').forEach(node => {
      const y = +node.dataset.y, m = node.dataset.c;
      /* `data-c` is the column id, which is a month number only on the month scale - it is `DJF`
         on the season scale and `YEAR` on the year scale. Looked up as a month it is undefined,
         and the tooltip then threw on every hover and every keyboard focus of a tile at those two
         scales. The scale's own accessor answers for all three. */
      const span = sc.at(y, m);
      node.addEventListener('click', () => { location.hash = y + '-' + String(m).padStart(2, '0'); });
      node.addEventListener('mousemove', ev => tip.show(cellTooltip(span), ev.clientX, ev.clientY));
      node.addEventListener('mouseleave', tip.hide);
      node.addEventListener('focus', () => {
        const box = node.getBoundingClientRect();
        tip.show(cellTooltip(span), box.left + box.width / 2, box.top);
      });
      node.addEventListener('blur', tip.hide);
    });

    /* The foot cells print a slope in the room a tile leaves them, which is not enough room for the
       interval, the p-value and the years it rests on. Those travel in the tooltip, so the cell can
       stay a number without the number standing unqualified. */
    host.querySelectorAll('.calfootcell').forEach(node => {
      const col = node.dataset.col;
      const record = col === 'record';
      const t = record ? met.trend_year : trendFor(met, col);
      const what = record ? (summarises(met) ? 'Mean year' : 'Whole record')
        : cap(sc.colName(state.scale === 'month' ? +col : col));
      node.addEventListener('mousemove', ev => tip.show(
        tipRows(what, [{ k: summarises(met) && record ? 'Mean year' : 'Mean',
          v: metricFormat(met, record ? whole : columnMeans[cols.findIndex(c =>
            String(c.id) === col)]) + ' ' + met.units }])
        + '<div class="tt-note">' + trendSentence(met, t) + '</div>',
        ev.clientX, ev.clientY));
      node.addEventListener('mouseleave', tip.hide);
    });
  }

  /* ------------------------------------------------------------------------------------------
     Trend
     ------------------------------------------------------------------------------------------
     Every anomaly, standard score and rank on this page is taken against a normal drawn from the
     whole record, and that normal is not a fixed climate: if the record moves, the baseline sits
     between its early years and its late ones. The slope is what says by how much, so it is shown
     wherever the normal it qualifies is shown, and never folded into the comparison itself.

     The numbers come from the build - a Theil-Sen slope with Kendall's tau - so nothing is fitted
     here.
     ------------------------------------------------------------------------------------------ */

  const TREND_ALPHA = 0.05;

  /** The trend down one column of the grid, at whichever scale the grid is drawn. */
  function trendFor(met, colId) {
    const map = state.scale === 'season' ? met.season_trend
      : state.scale === 'year' ? met.year_trend : met.trend;
    return map ? map[String(colId)] : null;
  }

  /* A slope is a tenth the size of the values it runs through, so it is written one decimal finer
     than they are: a metric printed to whole numbers would report every slope below half a unit
     per decade as no change at all. */
  const fmtSlope = (met, slope) =>
    nfs(slope, met.digits + (Math.abs(slope) < 10 ? 1 : 0));

  /* The slope as it fits under a figure in a foot cell. A column with too few complete years says
     how few rather than going blank: "no trend shown" and "no trend" are different claims, and only
     one of them is true. */
  function trendSpan(met, t) {
    if (!t) return '';
    if (!isNum(t.slope)) return '<span class="t none">' + t.n + ' yr</span>';
    const sig = isNum(t.p) && t.p < TREND_ALPHA;
    return '<span class="t' + (sig ? ' sig' : '') + '">' + fmtSlope(met, t.slope)
      + (sig ? '*' : '') + '</span>';
  }

  /** The same slope with everything a reader needs to judge it, for a tooltip or a note. */
  function trendSentence(met, t) {
    if (!t) return 'No trend is computed for this metric.';
    if (!isNum(t.slope)) {
      return 'No slope stated: the record has ' + t.n + ' complete year'
        + (t.n === 1 ? '' : 's') + ' and ' + M.trend_min_years + ' are required.';
    }
    const sig = isNum(t.p) && t.p < TREND_ALPHA;
    return 'Trend ' + fmtSlope(met, t.slope) + ' ' + met.units + ' per decade'
      + (isNum(t.lo) ? ' (95 % interval ' + fmtSlope(met, t.lo) + ' to '
        + fmtSlope(met, t.hi) + ')' : '')
      + ', ' + t.n + ' years, ' + t.y0 + '–' + t.y1 + '. Kendall p = '
      + (isNum(t.p) ? nf(t.p, 3) : 'not defined')
      + (sig ? ', significant at ' + nf(TREND_ALPHA, 2) + '.'
        : ', not significant at ' + nf(TREND_ALPHA, 2) + '.');
  }

  /* ------------------------------------------------------------------------------------------
     The grid at its third resolution: every day of the record
     ------------------------------------------------------------------------------------------
     A calendar is a grid of boxes and every boundary between two boxes cuts whatever crosses it.
     That is why the seasonal scale exists at all - a winter runs December to February and a grid of
     years by months halves every one of them - and the same argument goes one step further down. A
     heat wave from 28 July to 4 August is a streak in neither July's tile nor August's; each holds a
     fragment, and the strip inside a tile stops at the month it belongs to.

     The raster is that argument taken to its end: one mark per day, a row to the year, the year
     running left to right, and no boundary anywhere except the turn of the year. It reads the same
     daily quantity the micro-strip inside a tile reads and colours it on the same domain, so the
     two are one picture at two grains rather than two pictures.

     What it gives up is what a tile carries: a value in writing, a badge, a margin. That is the
     trade, and it is why this is a third scale rather than a replacement for the first.
     ------------------------------------------------------------------------------------------ */

  const RASTER_ROW = 15;  // px per year
  // Day of the year each month begins on, in an ordinary year. A leap year runs a day behind from
  // March, which at this width is a third of a pixel and is not worth a second set of rules.
  const MONTH_START = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

  function renderRaster() {
    const host = document.getElementById('calgrid');
    host.innerHTML = '<div class="rasterhost"></div>';
    if (!isNum(state.cursor)) state.cursor = dayIndex(YEARS[YEARS.length - 1], 1, 1);
    mountChart(host.firstChild, drawRaster);
  }

  function drawRaster(host) {
    const met = metric();
    if (met.day.kind === 'none') {
      host.innerHTML = '<p class="rasterempty"><b>' + met.label + '</b> is defined for a month '
        + 'or season and has no daily value, so it is not drawn at the day scale. It is shown at '
        + 'the month and season scales.</p>';
      return;
    }

    const rows = YEARS.length;
    const f = frame(host, {
      height: 24 + rows * RASTER_ROW + 26,
      margin: { top: 24, right: 16, bottom: 26, left: 44 },
      ariaLabel: met.label + ', every day from ' + M.first_year + ' to ' + M.last_year
        + ', one row per year'
    });
    const x0 = f.m.left, iw = f.iw, bottom = f.m.top + rows * RASTER_ROW;
    const fx = t => x0 + t * iw;
    const rowTop = k => f.m.top + k * RASTER_ROW;

    // A track behind each row, so a day the record does not carry reads as a gap in a row rather
    // than as page showing through where no row was drawn.
    const tracks = el('g', {}, f.svg);
    YEARS.forEach((y, k) => el('rect', { x: x0, y: rowTop(k), width: iw, height: RASTER_ROW - 2,
      class: 'raster-track' }, tracks));

    /* Seven thousand marks are built as markup and parsed once. Creating them one element at a
       time is the same picture and an order of magnitude slower, which a redraw on every resize
       and every theme change would make visible. */
    /* A badge is a claim about a month, so at the day scale it can only say which days fall inside
       a month that carries it. That is worth drawing rather than dropping: it is how a reader asks
       what the days of every hot and dry month actually looked like. Membership is decided once per
       month rather than once per day. */
    const filtered = state.filters.size > 0;
    const dim = {};
    if (filtered) {
      MONTHS.forEach(mo => { dim[mo.y + '-' + mo.m] = !matchesFilter(mo); });
    }

    const parts = [];
    YEARS.forEach((y, k) => {
      const len = isLeap(y) ? 366 : 365;
      const w = iw / len;
      const start = dayIndex(y, 1, 1);
      const top = rowTop(k);
      for (let d = 0; d < len; d++) {
        const i = start + d;
        if (i < 0 || i >= DAYS.n) continue;
        const at = dateAt(i);
        const rgb = dayColor(met, dayValue(met, i, at.y, at.m, at.d));
        if (!rgb) continue;
        if (filtered && dim[at.y + '-' + at.m]) {
          parts.push('<rect x="' + fx(d / len).toFixed(2) + '" y="' + top + '" width="'
            + (w + 0.35).toFixed(2) + '" height="' + (RASTER_ROW - 2) + '" fill="' + css(rgb)
            + '" opacity="0.17"/>');
          continue;
        }
        // A third of a pixel of overlap, which is what closes the seam between two marks once the
        // renderer has snapped them to whole pixels. More than that and each day is painted over
        // by the next one, which moves every boundary in the picture a day to the left.
        parts.push('<rect x="' + fx(d / len).toFixed(2) + '" y="' + top + '" width="'
          + (w + 0.35).toFixed(2) + '" height="' + (RASTER_ROW - 2) + '" fill="' + css(rgb)
          + '"/>');
      }
    });
    const layer = el('g', { 'shape-rendering': 'crispEdges' }, f.svg);
    layer.innerHTML = parts.join('');

    // The rules are the first of each month: the boundaries this scale exists to draw across, so
    // they are shown rather than removed - a spell is only visibly continuous if the line it runs
    // over is visible too.
    const rules = el('g', {}, f.svg);
    MONTH_START.forEach((doy, i) => {
      if (i > 0) {
        const x = fx((doy - 1) / 365);
        el('line', { x1: x, x2: x, y1: f.m.top - 3, y2: bottom + 3, class: 'raster-rule' }, rules);
      }
      const next = i === 11 ? 366 : MONTH_START[i + 1];
      const mid = fx(((doy - 1) + (next - 1)) / 2 / 365);
      svgText(f.svg, mid, f.m.top - 8, MONTH_ABBR[i], 'ax-text', { 'text-anchor': 'middle' });
      svgText(f.svg, mid, bottom + 17, MONTH_ABBR[i], 'ax-text', { 'text-anchor': 'middle' });
    });

    YEARS.forEach((y, k) => svgText(f.svg, x0 - 7, rowTop(k) + RASTER_ROW - 5, String(y),
      'raster-year' + (y % 5 === 0 ? ' decade' : ''), { 'text-anchor': 'end' }));

    // -- The cursor, which is both the hover mark and the keyboard's position -------------------
    const cursor = el('rect', { class: 'raster-cursor', height: RASTER_ROW - 2, width: 0,
      x: 0, y: 0, visibility: 'hidden' }, f.svg);

    const place = i => {
      if (!isNum(i)) { cursor.setAttribute('visibility', 'hidden'); return; }
      const at = dateAt(i);
      const k = YEARS.indexOf(at.y);
      if (k < 0) { cursor.setAttribute('visibility', 'hidden'); return; }
      const len = isLeap(at.y) ? 366 : 365;
      const d = i - dayIndex(at.y, 1, 1);
      cursor.setAttribute('x', (fx(d / len) - 0.5).toFixed(2));
      cursor.setAttribute('y', rowTop(k));
      cursor.setAttribute('width', Math.max(2.5, iw / len + 1).toFixed(2));
      cursor.setAttribute('visibility', 'visible');
    };

    const at = xy => {
      const k = Math.floor((xy[1] - f.m.top) / RASTER_ROW);
      if (k < 0 || k >= rows) return null;
      const year = YEARS[k];
      const len = isLeap(year) ? 366 : 365;
      const d = Math.floor((xy[0] - x0) / iw * len);
      if (d < 0 || d >= len) return null;
      const i = dayIndex(year, 1, 1) + d;
      return (i >= 0 && i < DAYS.n) ? i : null;
    };
    // The svg is laid out at whatever width the card gives it, so client pixels are converted
    // through its own box rather than assumed to be user units.
    const local = ev => {
      const box = f.svg.getBoundingClientRect();
      const k = f.width / (box.width || f.width);
      return [(ev.clientX - box.left) * k, (ev.clientY - box.top) * k];
    };

    f.svg.addEventListener('mousemove', ev => {
      const i = at(local(ev));
      if (i === null) { tip.hide(); place(null); return; }
      place(i);
      tip.show(dayTooltip(met, i), ev.clientX, ev.clientY);
    });
    f.svg.addEventListener('mouseleave', () => { tip.hide(); place(null); });
    f.svg.addEventListener('click', ev => {
      const i = at(local(ev));
      if (i !== null) openDay(i);
    });

    /* The tile grid is walked with the arrow keys, so the raster is too - a scale that can only be
       reached with a pointer would be a part of the page some readers cannot open. Left and right
       step a day, up and down hold the date and change the year, which is the comparison the rows
       are stacked to make. */
    f.svg.setAttribute('tabindex', '0');
    f.svg.addEventListener('focus', () => {
      place(state.cursor);
      const box = f.svg.getBoundingClientRect();
      tip.show(dayTooltip(met, state.cursor), box.left + box.width / 2, box.top + 40);
    });
    f.svg.addEventListener('blur', () => { tip.hide(); place(null); });
    f.svg.addEventListener('keydown', ev => {
      const now = dateAt(state.cursor);
      let next = null;
      if (ev.key === 'ArrowLeft') next = state.cursor - 1;
      else if (ev.key === 'ArrowRight') next = state.cursor + 1;
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        const year = now.y + (ev.key === 'ArrowUp' ? -1 : 1);
        // 29 February has no counterpart in three years out of four; it steps to the 28th rather
        // than silently landing on 1 March.
        const day = (now.m === 2 && now.d === 29 && !isLeap(year)) ? 28 : now.d;
        next = dayIndex(year, now.m, day);
      } else if (ev.key === 'Home') next = dayIndex(now.y, 1, 1);
      else if (ev.key === 'End') next = dayIndex(now.y, 12, 31);
      else if (ev.key === 'Enter' || ev.key === ' ') { openDay(state.cursor); ev.preventDefault(); }
      if (next === null || next < 0 || next >= DAYS.n) return;
      ev.preventDefault();
      state.cursor = next;
      place(next);
      const box = f.svg.getBoundingClientRect();
      tip.show(dayTooltip(met, next), box.left + box.width / 2, box.top + 40);
    });
    if (document.activeElement === f.svg) place(state.cursor);
  }

  const pad2 = n => String(n).padStart(2, '0');

  function openDay(i) {
    const at = dateAt(i);
    state.cursor = i;
    location.hash = at.y + '-' + pad2(at.m) + '-' + pad2(at.d);
  }

  /** One day as the raster describes it: what it was on every variable, and what it was marked as. */
  function dayTooltip(met, i) {
    const at = dateAt(i);
    const stamp = new Date(Date.UTC(at.y, at.m - 1, at.d));
    const title = WEEKDAY_LONG[(stamp.getUTCDay() + 6) % 7] + ' ' + at.d + ' '
      + MONTH_NAME[at.m - 1] + ' ' + at.y;
    const rows = [];
    // What the colour under the cursor means, before the day's own numbers. The metric names
    // itself: a short that already reads "TA anomaly" must not be given a second one.
    const own = dayValue(met, i, at.y, at.m, at.d);
    if (isNum(own) && met.day.kind !== 'flag') {
      rows.push({ k: met.short,
        v: (met.day.kind === 'anom' ? nfs(own, met.digits) : nf(own, met.digits))
          + ' ' + met.units });
    }
    DATA.variables.forEach(v => {
      const shown = v.ship.map(s => dayStat(v.key, s, i)).filter(isNum);
      if (shown.length !== v.ship.length) return;
      rows.push({ k: v.short + ' ' + v.ship.map(s => s === 'sum' ? 'total' : s).join('/'),
        v: v.ship.map(s => nf(dayStat(v.key, s, i), v.digits)).join(' / ') + ' ' + v.units });
    });
    const marks = FLAGS.filter(fl => flagSet(DAYS.flags[i], fl.key));
    return tipRows(title, rows)
      + (marks.length ? '<div class="tt-note">' + cap(marks.map(fl => fl.short).join(', '))
        + '</div>' : '');
  }

  /** Whether a year's figure on this metric is a total rather than a mean; the registry decides. */
  const summarises = met => met.agg === 'sum';

  /** A year's figure on the active metric: summed where the quantity sums, averaged otherwise. */
  function summarise(met, values) {
    if (!values.length) return null;
    const total = values.reduce((a, b) => a + b, 0);
    return summarises(met) ? total : total / values.length;
  }

  /* The year's twelve months as one small shape beside its figure. A year mild throughout and a
     year that averaged the same from a cold spring and a hot summer carry the same number, and
     the number alone cannot separate them. */
  function yearSparkline(met, y) {
    const parts = [];
    const w = 100 / 12;
    for (let m = 1; m <= 12; m++) {
      const mo = monthAt(y, m);
      const value = mo ? monthValue(met, mo) : null;
      const rgb = isNum(value) ? metricColor(met, value, 'monthly') : null;
      if (!rgb) continue;
      parts.push('<rect x="' + ((m - 1) * w).toFixed(2) + '" y="0" width="' + (w * 0.8).toFixed(2)
        + '" height="10" rx="1" fill="' + css(rgb) + '"/>');
    }
    return '<svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">'
      + parts.join('') + '</svg>';
  }

  /* The bar is drawn as a continuous ramp with real ticks rather than three labels at fixed
     positions: the centre of a diverging scale is not the middle of its domain unless the domain
     happens to be symmetric about it, and a label placed there anyway misstates the colour under
     it. The ticks come from the same nice-number routine every axis on the page uses. */
  function renderScaleBar() {
    const met = metric();
    const host = document.getElementById('scalebar');
    host.innerHTML = '';

    /* At the raster a mark is one day, and two of the daily quantities are not a ramp at all: a
       threshold day is met or it is not, and some metrics have no daily counterpart to draw. A
       continuous bar over either would be a legend for a picture that is not there. Where there is
       no picture the bar says nothing at all, the raster itself having already said it. */
    if (state.grid === 'day' && met.day.kind === 'none') return;
    if (state.grid === 'day' && met.day.kind === 'flag') {
      host.innerHTML = '<p class="scalenote"><b>' + met.label + '</b>. The raster marks each '
        + 'day that meets the threshold.</p>'
        + legendHTML([{ color: 'var(' + met.stops[met.stops.length - 1] + ')',
          label: 'day meeting the threshold' }]);
      return;
    }

    const width = Math.max(260, host.clientWidth || 320);
    const height = 52;
    const svg = el('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height,
      role: 'img', 'aria-label': 'Colour scale for ' + met.label }, host);
    svgText(svg, 0, 11, met.label + (met.units ? ' (' + met.units + ')' : '')
      + (state.grid === 'day' ? ', per day' : ''), 'ax-title', { 'text-anchor': 'start' });

    const n = 128, y0 = 20, h = 13;
    // The bar is drawn on the domain the grid is actually coloured by, which is not always the
    // monthly one: a season tile reads a wider domain and a day in the raster a wider one still.
    const mark = gridMark();
    const [lo, hi] = activeDomain(met, mark);
    const sx = linear(lo, hi, 0, width);
    const clip = el('clipPath', { id: 'scale-clip' }, svg);
    el('rect', { x: 0, y: y0, width: width, height: h, rx: 4 }, clip);
    const band = el('g', { 'clip-path': 'url(#scale-clip)' }, svg);
    for (let i = 0; i < n; i++) {
      const v = lo + (hi - lo) * (i / (n - 1));
      el('rect', { x: (i * width / n).toFixed(2), y: y0, width: (width / n + 0.8).toFixed(2),
        height: h, fill: css(metricColor(met, v, mark)) }, band);
    }
    el('rect', { x: 0.5, y: y0 + 0.5, width: width - 1, height: h - 1, rx: 4, fill: 'none',
      stroke: 'var(--border)' }, svg);

    // The two ends of the domain are always labelled, so an intermediate tick is only kept where
    // its label clears theirs - otherwise the ramp ends in two numbers printed over each other.
    let ticks = niceTicks(lo, hi, Math.max(2, Math.floor(width / 78)))
      .filter(v => sx(v) > 44 && sx(v) < width - 44);
    // The centre of a diverging scale is the value the neutral colour means, so it is always shown.
    if (met.scale === 'div' && met.center !== null
      && !ticks.some(v => Math.abs(v - met.center) < (hi - lo) * 1e-6)) {
      ticks = ticks.concat([met.center]).sort((a, b) => a - b);
    }
    [lo, hi].forEach(v => ticks.push(v));
    ticks.forEach(v => {
      const x = Math.max(0, Math.min(width, sx(v)));
      const anchor = x < 12 ? 'start' : x > width - 12 ? 'end' : 'middle';
      el('line', { x1: x, x2: x, y1: y0 + h, y2: y0 + h + 4, class: 'ax-line' }, svg);
      svgText(svg, x, y0 + h + 16, metricFormat(met, v), 'scalebar-text', { 'text-anchor': anchor });
    });
  }

  function renderGridNote() {
    const met = metric();
    const host = document.getElementById('gridnote');
    if (state.grid === 'day') {
      host.textContent = rasterNote(met);
      return;
    }
    const spans = scale().spans();
    const noun = state.scale === 'season' ? 'seasons' : state.scale === 'year' ? 'years' : 'months';
    const shown = spans.filter(mo => isNum(monthValue(met, mo))).length;
    const filtered = state.filters.size ? spans.filter(matchesFilter).length : null;
    let note = shown + ' of ' + spans.length + ' ' + noun + ' have a value for this metric.';
    if (filtered !== null) {
      note += ' ' + filtered + ' ' + (filtered === 1 ? noun.slice(0, -1) + ' carries' : noun
        + ' carry') + ' the selected badge'
        + (state.filters.size === 1 ? '' : 's') + '; the others are dimmed.';
    }
    note += ' Hatched tiles have a measured share below ' + M.cov_warn_text + '. '
      + (state.scale === 'year'
        ? 'Each year is compared with all other years of the record, so its normal is the record '
          + 'mean. The right-hand margin shows the twelve months of each year, and the foot row '
          + 'the whole record. Select a year to open it.'
        : 'The right-hand column gives each year’s ' + (summarises(met) ? 'total' : 'mean')
          + ', and the foot row the mean of each ' + noun.slice(0, -1)
          + ' over the record. Select a tile to open it.')
      /* Generated from the scheme, because the seasons are the caller's. A season that reaches
         back over the new year is short at one end of the record and hangs off the other, and
         that has to be said whichever season it is. */
      + (state.scale === 'season' ? ' ' + M.season_note + seasonEdgeNote() : '');
    /* The trend closes the note because it qualifies everything above it: the foot row's means are
       the normals the tiles are compared against, and a slope through the record says that those
       normals are a period average rather than a climate that held still. The coverage metric is
       the one that carries no slope - fitting a trend through how well measured the well-measured
       months are would be circular - so the note simply does not raise it there. */
    if (met.trend) {
      note += ' Below each foot-row mean is the Theil-Sen slope of that column, per decade; '
        + '* marks Kendall p < ' + nf(TREND_ALPHA, 2) + '. '
        + trendSentence(met, met.trend_year).replace(/^Trend /, 'Trend over the whole record: ');
    }
    host.textContent = note;
  }

  /** The note under the raster, which has different things to say than the one under the tiles. */
  function rasterNote(met) {
    if (met.day.kind === 'none') {
      return 'Select a metric with a daily value, or view this metric at the month or season '
        + 'scale.';
    }
    let note = 'One mark per day (' + M.n_days.toLocaleString() + ' days), one row per year, '
      + 'January to December from left to right. ';
    note += 'An event that crosses a month boundary, such as a dry spell from August into '
      + 'September, appears here as one streak; at the other scales it is split between tiles. ';
    note += 'Vertical rules mark the first day of each month. Select a day to open it. '
      + 'Left and right arrow keys move by one day, up and down by one year, and Enter opens the '
      + 'day.';
    if (state.filters.size) {
      const kept = MONTHS.filter(matchesFilter);
      note += ' Badges apply to months, so the filter keeps the days of the '
        + kept.length + ' month' + (kept.length === 1 ? '' : 's') + ' with the selected badge'
        + (state.filters.size === 1 ? '' : 's') + ' and fades the others.';
    }
    if (met.day.kind === 'anom') {
      note += ' Departures are from the normal for each calendar date, pooled over a ±'
        + M.clim_window + '-day window across all years of the record.';
    }
    return note;
  }

  /* ------------------------------------------------------------------------------------------
     Badge legend, which is also the filter
     ------------------------------------------------------------------------------------------ */

  /* The legend counts at whichever scale the grid is drawn, because the same badge means a
     different number of things at each: "18 months" beside a month grid, "4 years" beside a year
     grid. A badge that cannot be earned at the active scale is greyed rather than dropped, so the
     list does not reshuffle under a reader who changed scale. */
  function renderBadgeLegend() {
    const host = document.getElementById('badgelegend');
    const sc = state.grid === 'day' ? 'month' : state.scale;
    const noun = sc === 'season' ? 'season' : sc === 'year' ? 'year' : 'month';
    const countOf = b => (sc === 'season' ? b.n_season : sc === 'year' ? b.n_year : b.n);
    const groups = [];
    DATA.badges.forEach(b => {
      let g = groups.find(x => x.name === b.group);
      if (!g) { g = { name: b.group, items: [] }; groups.push(g); }
      g.items.push(b);
    });
    host.innerHTML = groups.map(g =>
      '<div class="badgegroup"><h3>' + g.name + '</h3>' + g.items.map(b => {
        const here = b.scales.indexOf(sc) >= 0;
        const n = countOf(b);
        return '<button type="button" class="badgetoggle' + (here ? '' : ' off')
        + '" data-badge="' + b.key + '" '
        + 'aria-pressed="' + String(state.filters.has(b.key)) + '">' + chip(b.key, 'lg')
        + '<span class="bt"><span class="bl">' + b.label + '</span> '
        + '<span class="bn">' + (here ? n + ' ' + noun + (n === 1 ? '' : 's')
          : 'not evaluated at this scale') + '</span>'
        + '<div class="bd">' + b.about + '</div></span></button>';
      }).join('') + '</div>').join('');

    host.querySelectorAll('.badgetoggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.badge;
        if (state.filters.has(key)) state.filters.delete(key); else state.filters.add(key);
        btn.setAttribute('aria-pressed', String(state.filters.has(key)));
        renderGrid();
      });
    });

    document.getElementById('badge-lede').textContent =
      'A badge marks a month, season or year that meets a stated criterion, and gives the '
      + 'figures behind it. Select a badge to dim the spans that do not carry it. A badge is not '
      + 'evaluated where less than ' + M.cov_badge_text + ' of the span has values for the '
      + 'variables it uses, so a tile without badges either met no criterion or could not be '
      + 'evaluated. The span panel states which.';
  }

  /* ------------------------------------------------------------------------------------------
     Hero
     ------------------------------------------------------------------------------------------ */

  function bestMonth(varKey, field, want) {
    let best = null;
    MONTHS.forEach(mo => {
      const rec = mo[varKey];
      if (!rec || !isNum(rec[field])) return;
      if (!isNum(rec.avail) || rec.avail < cov(varKey).normal) return;
      if (!best || (want === 'max' ? rec[field] > best[varKey][field]
        : rec[field] < best[varKey][field])) best = mo;
    });
    return best;
  }

  /* `src` names the column the figure was read from and sits in the tile's bottom corner. A FULLSET
     file carries a dozen variants of the same flux - NEE_VUT_REF, NEE_CUT_REF, NEE_VUT_USTAR50 and
     the rest - so which one produced a number is not a detail a reader can infer from the title. */
  function tile(label, value, unit, sub, accent, src, cls) {
    return '<div class="tile' + (accent ? ' tile-accent-' + accent : '')
      + (cls ? ' ' + cls : '') + '">'
      + '<span class="tile-label">' + label + '</span>'
      + '<span class="tile-value">' + value + (unit ? '<span class="unit">' + unit + '</span>' : '')
      + '</span><span class="tile-sub">' + sub + '</span>'
      + (src ? '<span class="tile-src" title="' + (DERIVED_COLUMNS.has(src)
        ? 'computed from these columns of the file' : 'read from this column') + '">'
        + esc(src) + '</span>' : '')
      + '</div>';
  }

  /* The record's annual totals for a variable that sums - the figure a flux site is usually quoted
     by. Only years the product covers completely take part, which is the same rule the trends use,
     so the headline and the slope below it rest on the same set of years. */
  function annualTotals(key) {
    if (!VARS[key] || VARS[key].agg !== 'sum') return [];
    const by = {};
    MONTHS.forEach(mo => {
      const rec = mo[key];
      if (!rec) return;
      (by[mo.y] = by[mo.y] || [])
        .push(isNum(rec.v) && rec.avail >= cov(key).normal ? rec.v : null);
    });
    return Object.keys(by)
      .filter(y => by[y].length === 12 && by[y].every(isNum))
      .map(y => ({ y: +y, v: by[y].reduce((a, b) => a + b, 0) }));
  }

  /* ------------------------------------------------------------------------------------------
     Provenance
     ------------------------------------------------------------------------------------------
     A page is a statement about one file, and it outlives the folder that file sat in. So it says
     which file - by name, by size and by its SHA-256, which is what tells two files of the same
     name apart - and, for each variable, the column it was read from, the flag that split measured
     from modelled, and the factor that brought it onto the page's unit.

     Every field is optional. A page built before the build shipped any of this renders exactly as
     it did, and every string in it is the caller's, so all of it is escaped.
     ------------------------------------------------------------------------------------------ */

  /** The provenance block, or null where the page was built without one. */
  function provenance() {
    const P = M.provenance;
    return P && typeof P === 'object' ? P : null;
  }

  function fmtBytes(n) {
    if (!isNum(n) || n < 0) return null;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return nf(n / 1024, 0) + ' kB';
    return nf(n / (1024 * 1024), n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  }

  /* A factor is printed at the precision it carries rather than at a fixed number of decimals:
     1e-6 x 1800 s x 12.011 is 0.0216198, and two decimals would print it as 0.02. */
  const fmtFactor = f => (f === null || f === undefined || f === '' || !isNum(+f) ? '–'
    : +f === 1 ? '1 (as given)' : String(Number((+f).toPrecision(6))));

  /* The size and the hash, after the file name in the footer. The hash is written out in full and
     cut to its first characters by the stylesheet, so hovering or focusing it shows all of it and
     selecting it copies all of it: a shortened hash that could only be copied short would be a
     fingerprint nobody could check. */
  function fileFingerprint(P) {
    const bits = [];
    const size = fmtBytes(P.bytes);
    if (size) bits.push(size);
    if (P.sha256) {
      bits.push('SHA-256 <code class="hash" tabindex="0" title="SHA-256 ' + esc(P.sha256) + '">'
        + esc(P.sha256) + '</code>');
    }
    return bits.length ? ' (' + bits.join(', ') + ')' : '';
  }

  /** The per-variable account of what was read, as a disclosure under the footer's first line. */
  function renderProvenance(P) {
    const host = document.getElementById('footer-prov');
    if (!host) return;
    const cols = P && P.columns && typeof P.columns === 'object' ? P.columns : null;
    if (!P || !cols || !Object.keys(cols).length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    // In the page's own order where the variable is on it, then anything else the build recorded.
    const keys = DATA.variables.map(v => v.key).filter(k => cols[k])
      .concat(Object.keys(cols).filter(k => !VARS[k]));
    // The source flag and the uncorrected twin are columns only some builds read, so they get a
    // column of the table only where one of them was.
    const sourced = keys.some(k => cols[k] && cols[k].source);
    const twinned = keys.some(k => cols[k] && cols[k].raw);
    const none = '<span class="muted">none</span>';
    const rows = keys.map(k => {
      const c = cols[k] || {};
      return [esc(VARS[k] ? VARS[k].short : k),
        '<code>' + esc(c.column) + '</code>',
        c.qc ? '<code>' + esc(c.qc) + '</code>' : none]
        .concat(sourced ? [c.source ? '<code>' + esc(c.source) + '</code>' : none] : [])
        .concat(twinned ? [c.raw ? '<code>' + esc(c.raw) + '</code>' : none] : [])
        .concat([esc(fmtFactor(c.factor))]);
    });
    const facts = [];
    if (isNum(P.first_year) && isNum(P.last_year)) {
      facts.push('years ' + esc(P.first_year) + '–' + esc(P.last_year));
    }
    if (P.seasons !== undefined && P.seasons !== null) {
      facts.push('seasons <code>' + esc(P.seasons) + '</code>');
    }
    if (typeof P.hourly === 'boolean') {
      facts.push(P.hourly ? 'hourly arrays included' : 'built without the hourly arrays');
    }
    if (P.primary && typeof P.primary === 'object') {
      Object.keys(P.primary).forEach(k => {
        facts.push('primary instance of <code>' + esc(k) + '</code>: <code>'
          + esc(P.primary[k]) + '</code>');
      });
    }
    const place = provPlace(P);
    if (place) facts.push(place);
    const settings = keys.map(k => provSettings(k, cols[k] || {})).filter(Boolean);
    const ref = provReference(P.reference);
    host.hidden = false;
    host.innerHTML = '<details><summary>'
      + (settings.length || ref ? 'Columns and site settings'
        : 'Columns read from the file') + '</summary>'
      + '<p>For each variable: the column read, the quality flag that separates measured from '
      + 'gap-filled records, '
      + (sourced ? 'the source flag naming the sensor or record behind each value, ' : '')
      + (twinned ? 'the uncorrected twin read to show what a correction did, ' : '')
      + 'and the factor converting the column to the unit shown on this page.'
      + (facts.length ? ' Build settings: ' + facts.join(', ') + '.' : '') + '</p>'
      + tableHTML(['Variable', 'Column', 'Quality flag']
        .concat(sourced ? ['Source flag'] : []).concat(twinned ? ['Uncorrected twin'] : [])
        .concat(['Factor']), rows)
      + (settings.length ? '<p>Site settings per variable:</p><ul>'
        + settings.map(s => '<li>' + s + '</li>').join('') + '</ul>' : '')
      + ref
      + '</details>';
  }

  /* A legend as `0 new sensor (new); 1 old sensor (old)`: the code, the long label, and the short
     one where it differs. The codes come as strings, since the payload is JSON. */
  function provLegend(legend) {
    if (!legend || typeof legend !== 'object') return '';
    return Object.keys(legend).sort((a, b) => (+a) - (+b)).map(code => {
      const entry = Array.isArray(legend[code]) ? legend[code] : [legend[code], legend[code]];
      return esc(code) + ' ' + esc(entry[0])
        + (entry[1] !== undefined && entry[1] !== entry[0] ? ' (' + esc(entry[1]) + ')' : '');
    }).join('; ');
  }

  /** One variable's site settings as a sentence, or null where it was read with none. */
  function provSettings(k, c) {
    const bits = [];
    if (c.qc_legend) bits.push('fill flag legend: ' + provLegend(c.qc_legend));
    if (Array.isArray(c.measured_codes) && c.measured_codes.length) {
      bits.push('measured codes: ' + c.measured_codes.map(esc).join(', '));
    }
    if (c.source_legend) bits.push('source flag legend: ' + provLegend(c.source_legend));
    if (c.source_reference_code !== undefined && c.source_reference_code !== null) {
      bits.push('reference source code: ' + esc(c.source_reference_code));
    }
    if (!bits.length) return null;
    return '<b>' + esc(VARS[k] ? VARS[k].short : k) + '</b>: ' + bits.join('; ') + '.';
  }

  /* The site's position and clock, as given to the build:
     `latitude 47.5° N, longitude 8.4° E, UTC offset +1 h`. */
  function provPlace(P) {
    const bits = [];
    if (isNum(P.lat)) bits.push('latitude ' + esc(Math.abs(P.lat)) + '° ' + (P.lat < 0 ? 'S' : 'N'));
    if (isNum(P.lon)) bits.push('longitude ' + esc(Math.abs(P.lon)) + '° ' + (P.lon < 0 ? 'W' : 'E'));
    if (isNum(P.utc_offset)) {
      bits.push('UTC offset ' + (P.utc_offset < 0 ? '−' : '+') + esc(Math.abs(P.utc_offset)) + ' h');
    }
    return bits.join(', ');
  }

  /* The reference station: its file, identified as the input is, and how each variable was
     compared with it. A shift is stated per variable only where it departs from the station's. */
  function provReference(R) {
    if (!R || typeof R !== 'object' || !R.file) return '';
    const bits = [];
    if (R.station) bits.push(esc(R.station));
    bits.push('file <code>' + esc(R.file) + '</code>' + fileFingerprint(R));
    if (isNum(R.distance_km)) bits.push('distance ' + esc(R.distance_km) + ' km');
    if (isNum(R.elevation_m)) bits.push('elevation ' + esc(R.elevation_m) + ' m');
    const shift = isNum(R.shift) ? R.shift : 0;
    if (shift) bits.push('time shift ' + esc(shift) + ' min');
    const vars = R.vars && typeof R.vars === 'object' ? R.vars : {};
    const compared = Object.keys(vars).map(k => {
      const s = vars[k] || {};
      return esc(VARS[k] ? VARS[k].short : k) + ' with <code>' + esc(s.column) + '</code>'
        + (s.split ? ', night and day separately' : '')
        + (isNum(s.shift) && s.shift !== shift ? ', time shift ' + esc(s.shift) + ' min' : '');
    });
    return '<p>Reference station: ' + bits.join('; ') + '. '
      + (compared.length ? 'Columns compared: ' + compared.join('; ') + '.' : '') + '</p>';
  }

  function renderHero() {
    /* The site is the heading of the page it is a page of; the eyebrow says what is being shown of
       it, and the span is already stated by the breadcrumb on the right of the bar. */
    const years = M.last_year - M.first_year + 1;
    document.getElementById('page-eyebrow').textContent =
      'Atlas of the ' + years + '-year record';
    document.getElementById('page-title').textContent = M.site;
    document.getElementById('page-lede').textContent =
      'Monthly values from ' + M.first_year + ' to ' + M.last_year + ', coloured by the selected '
      + 'metric and marked with badges where a stated criterion is met. Select a month to see its '
      + 'daily values. All values are read from the input file; this page aggregates and compares '
      + 'them and applies no corrections.';

    const chips = [
      '<li><b>' + M.n_months + '</b> months</li>',
      '<li><b>' + M.n_days.toLocaleString() + '</b> days</li>',
      '<li><b>' + DATA.variables.length + '</b> variable' + (DATA.variables.length === 1 ? '' : 's') + '</li>',
      '<li><b>' + DATA.badges.length + '</b> badge types</li>',
      '<li>aggregated from 30-min records</li>'
    ];
    document.getElementById('page-chips').innerHTML = chips.join('');

    const warm = bestMonth('TA', 'v', 'max'), cold = bestMonth('TA', 'v', 'min');
    const wet = bestMonth('PREC', 'v', 'max'), dry = bestMonth('PREC', 'v', 'min');
    const badged = MONTHS.filter(mo => mo.b.length).length;
    const anom = bestMonth('TA', 'a', 'max');
    const tiles = [];
    if (warm) {
      tiles.push(tile('Warmest month', nf(warm.TA.v, 1), VARS.TA.units,
        MONTH_NAME[warm.m - 1] + ' ' + warm.y, 'warm'));
    }
    if (cold) {
      tiles.push(tile('Coldest month', nf(cold.TA.v, 1), VARS.TA.units,
        MONTH_NAME[cold.m - 1] + ' ' + cold.y, 'cold'));
    }
    if (anom) {
      tiles.push(tile('Largest warm anomaly', nfs(anom.TA.a, 1), VARS.TA.units,
        MONTH_NAME[anom.m - 1] + ' ' + anom.y + ', relative to the calendar-month normal', 'warm'));
    }
    if (wet) {
      tiles.push(tile('Wettest month', nf(wet.PREC.v, 0), VARS.PREC.units,
        MONTH_NAME[wet.m - 1] + ' ' + wet.y, null, VARS.PREC.column));
    }
    if (dry) {
      tiles.push(tile('Driest month', nf(dry.PREC.v, 0), VARS.PREC.units,
        MONTH_NAME[dry.m - 1] + ' ' + dry.y, null, VARS.PREC.column));
    }
    tiles.push(tile('Months with a badge', String(badged), '',
      'of ' + MONTHS.length + ', ' + nf(100 * badged / MONTHS.length, 0) + ' % of the record'));

    /* The carbon headline, on its own row and in its own colour, exactly as the month panel does
       it. The record's own extremes of uptake and release say more about a flux site than any
       meteorological figure does, and the mean annual balance is the number such a site is
       normally quoted by. The energy fluxes are left out: neither carries a single figure that
       reads as a record the way an uptake extreme does. */
    const flux = [];
    const uptake = bestMonth('NEE', 'v', 'min'), release = bestMonth('NEE', 'v', 'max');
    const productive = bestMonth('GPP', 'v', 'max');
    if (uptake) {
      flux.push(tile('Largest monthly uptake', nf(uptake.NEE.v, 0), VARS.NEE.units,
        MONTH_NAME[uptake.m - 1] + ' ' + uptake.y, null, VARS.NEE.column, 'tile-flux'));
    }
    if (release) {
      flux.push(tile('Largest monthly release', nfs(release.NEE.v, 0), VARS.NEE.units,
        MONTH_NAME[release.m - 1] + ' ' + release.y, null, VARS.NEE.column, 'tile-flux'));
    }
    const annual = annualTotals('NEE');
    if (annual.length) {
      const mean = annual.reduce((a, b) => a + b.v, 0) / annual.length;
      flux.push(tile('Mean annual carbon balance', nfs(mean, 0), VARS.NEE.units,
        annual.length + ' complete years · ' + (mean < 0 ? 'a net sink' : 'a net source'),
        null, VARS.NEE.column, 'tile-flux'));
    }
    if (productive) {
      flux.push(tile('Highest monthly GPP', nf(productive.GPP.v, 0), VARS.GPP.units,
        MONTH_NAME[productive.m - 1] + ' ' + productive.y, null, VARS.GPP.column, 'tile-flux'));
    }
    const heroFluxes = flux.length
      ? (tiles.length ? '<div class="tiles-break"><span>Carbon</span></div>' : '') + flux.join('')
      : '';
    document.getElementById('tiles').innerHTML = tiles.join('') + heroFluxes;

    /* Three paragraphs, in the order a reader checking the page needs them: what it was built from,
       how its figures were taken, and what made it and when. */
    const P = provenance();
    const file = P && P.file ? P.file : M.source;
    const nVars = DATA.variables.length;
    document.getElementById('footer-text').innerHTML = '<b>Data.</b> '
      // The description is optional, and without one the line read "XX-Syn — . Built".
      + esc(M.site) + (M.site_long ? ', ' + esc(M.site_long) : '') + ': '
      + (file ? 'the half-hourly FLUXNET-standardized file <code>' + esc(file) + '</code>' : 'a half-hourly record')
      + (P ? fileFingerprint(P) : '') + ', ' + M.first_year + ' to ' + M.last_year + ', '
      + nVars + ' variable' + (nVars === 1 ? '' : 's') + '. Values are taken from the file, '
      + 'converted to the units shown and aggregated; no corrections are applied.';
    renderProvenance(P);

    document.getElementById('footer-methods').innerHTML = '<b>Methods.</b> '
      + 'Anomalies, ranks and badges are computed against normals: the mean of the same calendar '
      + 'month or season across the record, or, for a year, the mean of all years. A normal uses '
      + 'spans at least ' + M.cov_normal_text + ' covered, gap-filled values included, and '
      + 'requires at least ' + M.min_normal_years + ' such years. The measured share is reported '
      + 'and hatched on the grid but excludes no span. Daily normals pool a ±' + M.clim_window
      + '-day window across all years. Trends are Theil-Sen slopes with Kendall’s τ test, fitted '
      + 'over complete years only.';

    /* Who made the tool and when it made this page, last. The page travels away from whatever
       produced it, and by the time someone opens it from a share or a memory stick there may be
       nothing else around it to say where the definitions behind its figures are written down.
       It names the tool's author, not the page's: whoever ran the build made the page. */
    document.getElementById('footer-credit').innerHTML =
      '<b>Created with <span class="wordmark">flux<b>atlas</b></span>'
      + (M.version ? ' ' + esc(M.version) : '') + '</b>, ' + esc(builtAt(M.generated)) + '. '
      + 'fluxatlas is by ' + esc(M.author)
      + (M.affiliation ? ', <a href="' + M.affiliation_url + '">' + esc(M.affiliation) + '</a>' : '')
      + ' · <a href="' + M.repository + '">' + esc(M.repository.replace(/^https?:\/\//, ''))
      + '</a>.';
  }

  /* `2026-09-25 17:07 +02:00` as `25 September 2026, 17:07 (UTC+02:00)`. The payload keeps the
     sortable form; this is the one a reader is given. A stamp in any other shape - a page built
     before the offset was recorded - is shown as it stands. */
  function builtAt(stamp) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})(?: ([+-]\d{2}:?\d{2}))?$/.exec(String(stamp || ''));
    if (!m) return String(stamp || '');
    const off = m[5] ? ' (UTC' + (m[5].includes(':') ? m[5] : m[5].slice(0, 3) + ':' + m[5].slice(3)) + ')' : '';
    return (+m[3]) + ' ' + MONTH_NAME[+m[2] - 1] + ' ' + m[1] + ', ' + m[4] + off;
  }

  /* The way into the per-variable pages. One card each, carrying the figure that most reader will
     have come for - the slope over the record - so the index is itself an answer rather than only
     a menu. */
  function renderVarIndex() {
    const host = document.getElementById('varindex');
    host.innerHTML = DATA.variables.map(v => {
      const met = ownMetric(v);
      const t = met && met.trend_year;
      const line = !t ? 'no trend: no metric uses this variable directly'
        : !isNum(t.slope) ? 'no slope stated: ' + t.n + ' complete years'
          : nfs(t.slope, met.digits + 1) + ' ' + met.units + ' / decade over ' + t.n + ' years'
            + (isNum(t.p) && t.p < TREND_ALPHA ? ' *' : '');
      return '<a class="varcard" href="#var-' + v.key + '">'
        + '<span class="vk">' + v.key + '</span>'
        + '<span class="vt">' + v.title + '</span>'
        + '<span class="vu">' + v.units + ' · ' + (v.agg === 'sum' ? 'summed' : 'averaged')
        + ' · <code>' + esc(v.column) + '</code></span>'
        + '<span class="vtr">' + line + '</span></a>';
    }).join('');
    document.getElementById('var-lede-index').textContent =
      'Each variable has its own page: annual values over the record, a separate trend for each '
      + 'calendar month, the mean annual cycle, and the measured share. Trends are given per '
      + 'calendar month because an annual trend averages over months that can change at '
      + 'different rates.';
  }

  function renderAbout() {
    const host = document.getElementById('g-about');
    host.innerHTML = '';

    let body = cardEl(host, {
      title: 'Grid layout', width: 'w-4',
      sub: 'Three levels: record, month, day.'
    });
    body.innerHTML = '<p class="card-sub" style="max-width:none">Each tile is one month, '
      + 'coloured by the selected metric. The strip along its lower edge shows the daily values '
      + 'of that month on the same colour scale. The symbols are badges.</p>'
      + '<p class="card-sub" style="max-width:none">The right-hand column gives the annual '
      + 'value. The foot row gives the mean of each calendar month over the record, which is the '
      + 'reference for every month in its column.</p>'
      + '<p class="card-sub" style="max-width:none">Select a tile to open the month: its days '
      + 'as a calendar, the daily values against the climatological band, and its rank among the '
      + 'same month of all other years. A single day can be opened from there. Arrow keys move '
      + 'between tiles, Enter opens a tile, and Escape returns.</p>';

    body = cardEl(host, { title: 'Threshold day definitions', width: 'w-4',
      sub: 'Each threshold day is defined by one test on one daily value and is applied in the '
        + 'same way throughout the page.' });
    body.innerHTML = tableHTML(['Threshold', 'Variable'],
      FLAGS.map(f => [cap(f.label), VARS[f.var].short]));

    body = cardEl(host, { title: 'Source columns', width: 'w-4',
      sub: 'The input file may provide several versions of the same quantity. These are the '
        + 'columns used on this page. Values are aggregated and compared as published, without '
        + 'correction.' });
    body.innerHTML = tableHTML(['Variable', 'Column', 'Period'],
      DATA.variables.map(v => [v.short, '<code>' + esc(v.column) + '</code>',
        v.first_year + '–' + v.last_year]));

    /* The composite counts departures on several axes at once, so how far those axes duplicate
       one another is not a footnote to it - it is the thing that decides whether the count means
       what it appears to mean. Measured on the record, published beside the grid. */
    const C = M.composite;
    body = cardEl(host, {
      title: 'Correlation between monthly anomalies', width: 'w-6',
      sub: 'Pearson correlation between the monthly standard scores of each pair of variables. '
        + 'All ' + C.vars.length + ' variables have a standard score in ' + C.n + ' months. '
        + 'Standard scores are taken against each calendar month’s own normal, which removes the '
        + 'seasonal cycle. Values near 1 indicate that the pair rises and falls together, values '
        + 'near -1 that one rises as the other falls, and values near 0 no linear relation. The '
        + 'correlation qualifies the count of variables far from normal at the same time: a month '
        + 'anomalous in two strongly correlated variables is anomalous in one respect, not two. '
        + 'Pairs with |r| ≥ 0.5 are highlighted.'
    });
    body.innerHTML = tableHTML([''].concat(C.vars.map(k => VARS[k].short)),
      C.vars.map((a, i) => [VARS[a].short].concat(C.correlation[i].map((v, j) => {
        if (i === j) return { v: '—', cls: '' };
        return { v: nfs(v, 2), cls: Math.abs(v) >= 0.5 ? 'num-warm' : '' };
      }))))
      + '<p class="smallnote">Vapour pressure deficit is computed from air temperature and '
      + 'relative humidity and is therefore correlated with temperature; the table gives the '
      + 'strength of that relation. VPD is included in the count as the atmospheric component of '
      + 'drought and the evaporative demand to which stomata respond. Relative humidity is not '
      + 'included, because VPD already combines it with temperature.</p>';

    renderTrendCards(host);

    body = cardEl(host, { title: 'Badge and normal criteria', width: 'w-6',
      sub: 'Coverage requirements for badges, normals, anomalies and ranks.' });
    body.innerHTML = '<p class="card-sub" style="max-width:none">Each badge uses a stated set of '
      + 'variables and is withheld where less than ' + M.cov_badge_text + ' of the span is '
      + 'covered for them, gap-filled values included. The measured share withholds no badge; it '
      + 'is reported, and spans below the warning threshold are hatched. The span panel lists '
      + 'withheld badges and the reason. A calendar-month normal, and every anomaly, standard '
      + 'score and rank derived from it, uses only the years in which that month is at least '
      + M.cov_normal_text + ' covered, and is not computed from fewer than '
      + M.min_normal_years + ' such years. A month below the coverage threshold is not ranked, '
      + 'so it cannot appear as a record.</p>';

    body = cardEl(host, { title: 'Measured share by year', width: 'w-6',
      sub: 'Annual mean of the monthly measured share, per variable. Gap-filled and '
        + 'reconstructed records are not counted as measured.' });
    const host2 = document.createElement('div');
    host2.className = 'chart';
    body.appendChild(host2);
    body.insertAdjacentHTML('beforeend', legendHTML(DATA.variables.map((v, i) => ({
      color: 'var(--series-' + (i % 4 + 1) + ')', label: v.short, line: true
    }))));
    mountChart(host2, drawCoverage);
  }

  /* ------------------------------------------------------------------------------------------
     The baseline, and the fact that it moves
     ------------------------------------------------------------------------------------------
     Two cards, because the trend has to answer two different questions. The first is "how much
     does this matter" - a rate in the units of the variable, beside the record split in half, so
     the size of the movement can be read against the single normal every anomaly here is taken
     from. The second is "does it matter evenly through the year", which it does not, and which is
     the reason the slope is shown per calendar month rather than once for the record.
     ------------------------------------------------------------------------------------------ */

  const trendVars = () => DATA.variables.filter(v => v.metric && METRICS[v.metric].trend);

  function renderTrendCards(host) {
    const ta = VARS.TA && METRICS[VARS.TA.metric];
    const bias = ta && ta.epoch && isNum(ta.epoch.bias) ? ta.epoch : null;

    const body = cardEl(host, {
      title: 'Trends over the record', width: 'w-6',
      sub: 'All anomalies, standard scores and ranks on this page are relative to the mean of the '
        + 'whole record. The table gives the trend of each variable and the means of the earlier '
        + 'and later halves of the record.'
    });
    body.innerHTML = '<p class="card-sub" style="max-width:none">The normal is the mean over '
      + M.first_year + '–' + M.last_year + '. Where a variable has a trend, this mean lies '
      + 'between the values of the early and the late years, so anomalies near either end of the '
      + 'record partly reflect the trend.</p>'
      + (bias
        ? '<p class="card-sub" style="max-width:none">For air temperature, the mean of the later '
          + 'half differs from the record normal by ' + nfs(bias.bias, 2) + ' ' + VARS.TA.units
          + '. Anomalies in the later half include this offset, so where it is positive a warm '
          + 'badge late in the record reflects a smaller departure than the same badge early in '
          + 'it.</p>'
        : '')
      + tableHTML(['Variable', 'Per decade', 'Kendall p', 'Years', 'Earlier half', 'Later half'],
        trendVars().map(v => {
          const met = METRICS[v.metric], t = met.trend_year, e = met.epoch;
          const sig = t && isNum(t.p) && t.p < TREND_ALPHA;
          const half = part => (e && e[part]
            ? nf(e[part].mean, v.digits) + ' <span class="muted">' + e[part].y0 + '–'
              + e[part].y1 + '</span>' : '–');
          return [v.short,
            { v: t && isNum(t.slope) ? fmtSlope(met, t.slope) + (sig ? '*' : '') : '–',
              cls: sig ? 'num-warm' : '' },
            t && isNum(t.p) ? nf(t.p, 3) : '–',
            t ? String(t.n) : '–',
            { v: half('early') }, { v: half('late') }];
        }))
      + '<p class="smallnote">Theil-Sen slope, which is robust to single extreme years, tested '
      + 'with Kendall’s tau; * marks p < ' + nf(TREND_ALPHA, 2) + '. Only years in which all '
      + 'twelve months are covered are used, and no slope is stated with fewer than '
      + M.trend_min_years + ' such years. The two halves divide these complete years at the '
      + 'midpoint.</p>'
      /* Every figure on this page is computed on the gap-filled product, which is the series the
         field publishes and analyses. The cost of that is that a span measured less carries more
         model than one measured more, and where the measured share itself trends through a record,
         part of a slope may be that trend. Stated rather than left to be discovered. */
      + '<p class="smallnote">All figures use the gap-filled series, whatever share of a span '
      + 'was measured. A span with a lower measured share contains more modelled values, so where '
      + 'the measured share changes through the record, part of a slope may reflect that change '
      + 'rather than a change in the variable. '
      + thinNote() + '</p>'
      + '<p class="smallnote">The baseline cannot be changed: badges are computed against the '
      + 'whole-record normal when the page is built.</p>';

    const items = trendVars();
    const monthly = items.reduce((a, v) => a + Object.keys(METRICS[v.metric].trend).length, 0);
    const clear = items.reduce((a, v) => a + Object.values(METRICS[v.metric].trend)
      .filter(t => isNum(t.p) && t.p < TREND_ALPHA).length, 0);
    chartCard(host, {
      title: 'Trends by calendar month', width: 'w-6',
      sub: 'One row per variable, one bar per calendar month. Each bar is the Theil-Sen slope of '
        + 'that month across the record, divided by its interannual standard deviation, in '
        + 'standard deviations per decade. Upward bars are increases and downward bars decreases. '
        + 'The scaling makes months and variables comparable. Filled bars have Kendall p < '
        + nf(TREND_ALPHA, 2) + '; outlined bars do not.',
      draw: drawTrendByMonth,
      foot: clear + ' of ' + monthly + ' bars are filled. Each monthly slope is fitted to one '
        + 'value per year, so most are not significant; this does not mean the slope is zero. '
        + 'Seasonal and annual trends are less noisy and are shown at the season scale of the '
        + 'grid and in the record cell of its foot row.'
    });
  }

  const TREND_ROW = 44;

  function drawTrendByMonth(host) {
    const items = trendVars();
    /* The rows are named by variable and some of those names are long. At the fixed 84px this used
       to sit at, "Gross primary productivity" ran off the left edge of the card. The margin is now
       the width the names actually need, capped at two fifths so the bars keep their room. */
    const width = Math.max(260, host.clientWidth || 640);
    const left = Math.min(textWidth(items.map(v => v.short), 'ax-text') + 14,
      Math.round(width * 0.4));
    const f = frame(host, {
      height: 22 + items.length * TREND_ROW + 34,
      margin: { top: 22, right: 28, bottom: 34, left: Math.max(46, left) },
      ariaLabel: 'Trend per calendar month, in standard deviations per decade, by variable'
    });

    /* Dividing by the calendar month's own standard deviation is what makes the twelve comparable:
       a January whose spread is four degrees and a July whose spread is two are not moving by the
       same amount when both move by half a degree. */
    const at = (v, m) => {
      const t = METRICS[v.metric].trend[String(m)];
      const c = CLIM[v.key] && CLIM[v.key][String(m)];
      return (t && isNum(t.slope) && c && c.sd) ? t.slope / c.sd : null;
    };
    let lim = 0.6;
    items.forEach(v => {
      for (let m = 1; m <= 12; m++) {
        const x = at(v, m);
        if (isNum(x)) lim = Math.max(lim, Math.abs(x));
      }
    });

    const band = f.iw / 12;
    const bx = m => f.m.left + (m - 1) * band;
    items.forEach((v, k) => {
      const top = f.m.top + k * TREND_ROW;
      const sy = linear(-lim, lim, top + TREND_ROW - 8, top + 4);
      const g = el('g', {}, f.svg);
      [-1, 0, 1].forEach(level => {
        if (Math.abs(level) > lim) return;
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(level), y2: sy(level),
          class: level === 0 ? 'ax-line' : 'gridline' }, g);
        // On the right, where nothing else is: the left column holds the variable names.
        if (k === 0 && level !== 0) {
          svgText(f.svg, f.m.left + f.iw + 5, sy(level) + 3, nfs(level, 0), 'ax-text',
            { 'text-anchor': 'start' });
        }
      });
      trimText(svgText(f.svg, f.m.left - 6, top + TREND_ROW / 2 + 4, v.short, 'ax-text',
        { 'text-anchor': 'end' }), f.m.left - 10, v.short);
      for (let m = 1; m <= 12; m++) {
        const value = at(v, m);
        if (!isNum(value)) continue;
        const t = METRICS[v.metric].trend[String(m)];
        const sig = isNum(t.p) && t.p < TREND_ALPHA;
        const y = sy(Math.max(-lim, Math.min(lim, value)));
        const zero = sy(0);
        el('rect', { x: (bx(m) + band * 0.22).toFixed(2), y: Math.min(y, zero).toFixed(2),
          width: (band * 0.56).toFixed(2), height: Math.max(1.2, Math.abs(zero - y)).toFixed(2),
          class: 'trendbar' + (sig ? ' sig' : '') }, g);
      }
    });

    const bottom = f.m.top + items.length * TREND_ROW;
    // A month too narrow for "Jan" is labelled by its initial, as the grid's narrow header is.
    const narrow = band < textWidth(['May'], 'ax-text') + 6;
    for (let m = 1; m <= 12; m++) {
      svgText(f.svg, bx(m) + band / 2, bottom + 14,
        narrow ? MONTH_ABBR[m - 1][0] : MONTH_ABBR[m - 1], 'ax-text', { 'text-anchor': 'middle' });
    }
    const caption = 'standard deviations per decade, relative to each month’s interannual spread';
    const room = f.width - f.m.left - 4;
    trimText(svgText(f.svg, f.m.left, bottom + 28,
      textWidth([caption], 'ax-title') <= room ? caption : 'sd per decade, relative to the month',
      'ax-title', { 'text-anchor': 'start' }), room, caption);

    // The bars are small, so everything a slope needs to be judged by travels in the tooltip.
    const local = ev => {
      const box = f.svg.getBoundingClientRect();
      const s = f.width / (box.width || f.width);
      return [(ev.clientX - box.left) * s, (ev.clientY - box.top) * s];
    };
    f.svg.addEventListener('mousemove', ev => {
      const [px, py] = local(ev);
      const k = Math.floor((py - f.m.top) / TREND_ROW);
      const m = Math.floor((px - f.m.left) / band) + 1;
      if (k < 0 || k >= items.length || m < 1 || m > 12) { tip.hide(); return; }
      const v = items[k], met = METRICS[v.metric], t = met.trend[String(m)];
      const sd = at(v, m);
      tip.show(tipRows(MONTH_NAME[m - 1] + ' · ' + v.short,
        isNum(sd) ? [{ k: 'Per decade', v: fmtSlope(met, t.slope) + ' ' + met.units },
          { k: 'Scaled', v: nfs(sd, 2) + ' standard deviations per decade' }] : [])
        + '<div class="tt-note">' + trendSentence(met, t) + '</div>', ev.clientX, ev.clientY);
    });
    f.svg.addEventListener('mouseleave', tip.hide);
  }

  function drawCoverage(host) {
    const f = frame(host, { aspect: 0.34, margin: { top: 10, right: 14, bottom: 30, left: 42 } });
    const sx = linear(YEARS[0], YEARS[YEARS.length - 1], f.m.left, f.m.left + f.iw);
    const sy = linear(0, 100, f.m.top + f.ih, f.m.top);
    const every = Math.max(1, Math.ceil(YEARS.length / Math.max(3, Math.floor(f.iw / 62))));
    drawAxes(f, sx, sy, {
      yTicks: [0, 25, 50, 75, 100], yDigits: 0, yLabel: 'measured (%)',
      xTicks: YEARS.filter((y, i) => i % every === 0 || i === YEARS.length - 1)
        .map(y => ({ v: y, label: String(y) }))
    });
    DATA.variables.forEach((v, i) => {
      const values = YEARS.map(y => {
        const rows = MONTHS.filter(mo => mo.y === y && isNum(mo[v.key].meas));
        if (!rows.length) return null;
        return rows.reduce((a, mo) => a + mo[v.key].meas, 0) / rows.length;
      });
      el('path', { d: pathFrom(YEARS, values, sx, sy), fill: 'none',
        stroke: 'var(--series-' + (i % 4 + 1) + ')', 'stroke-width': 2,
        'stroke-linejoin': 'round' }, f.svg);
    });
  }

