  /* ------------------------------------------------------------------------------------------
     Level 2: one month
     ------------------------------------------------------------------------------------------ */

  /* A variable's short name inside a sentence: the initial capital lowered, an acronym kept
     ("net CO₂ exchange", "incoming PPFD"). */
  const shortInText = v => v.short.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());

  /* The measured share of a span, and how the rest of it was filled in the words of the flag it
     was read from. A code means different things in different columns - 2 is medium-quality fill
     beside a flux and reanalysis beside consolidated meteorology - so the words are the
     variable's own (`v.fill.levels`), and the flag and its convention sit in the title. This
     qualifies the figure above it; it gates nothing. */
  function fillPhrase(v, rec) {
    /* A partitioning product is modelled in every half-hour, so its shares are those of the net
       flux it was partitioned from, and they are worded as such. */
    if (v.partitioned && !v.fill) return 'modelled by partitioning of NEE';
    const nee = partitionedFrom(v);
    let text = nf(rec.meas, 0) + (nee ? ' % from measured ' + nee : ' % measured');
    if (!v.fill || !rec.f) return text;
    // A legend the build was given carries short labels, which fit a tile where its long ones
    // do not; the long ones are in the coverage card's legend.
    const words = v.fill.short || v.fill.levels;
    rec.f.forEach((p, i) => {
      if (p > 0 && words[i]) {
        text += ', ' + nf(p, 0) + ' % ' + (nee ? 'from its ' : '') + esc(words[i]);
      }
    });
    return '<span title="' + v.fill.flag + ' follows ' + v.fill.note + '">' + text + '</span>';
  }

  /* The meteorology first and the fluxes on a row of their own, in their own colour. They are
     measured differently, held to different warning lines and read for different reasons, and a
     reader after the carbon balance should not have to pick it out of the thermometers. */
  function monthTiles(mo) {
    const met = [], flux = [];
    DATA.variables.forEach(v => {
      const rec = mo[v.key];
      if (!rec || !isNum(rec.v)) return;
      /* The month's own precision, not the day's. A monthly carbon total is a three-figure number
         and `v.digits` is set for a daily one, so printing it here gave "-100.31 g C m⁻²" - over
         precise for the figure, and long enough to push the unit onto its own line. */
      const d = monthDigits(v.key);
      const bits = [];
      if (isNum(rec.a)) {
        bits.push(anomalyPhrase(v, rec, d));
      }
      if (isNum(rec.r) && isNum(rec.n)) {
        /* Most variables rank from the top and need no explanation. NEE ranks from the negative
           end, because the sign convention makes the most negative month the largest uptake - so
           where a variable ranks the unobvious way, the tile says what rank 1 means. */
        bits.push(ord(rec.r) + ' of ' + rec.n
          + (state.scale === 'year' ? ' years' : ' such ' + spanNoun() + 's')
          + (v.rank_note ? ' (1st = ' + v.rank_note + ')' : ''));
      }
      if (isNum(rec.meas) && rec.meas < 99.5) bits.push(fillPhrase(v, rec));
      const source = sourcePhrase(v, rec);
      if (source) bits.push(source);
      const accent = v.key === 'TA' && isNum(rec.a) ? (rec.a > 0 ? 'warm' : 'cold') : null;
      /* The interval, where the file publishes one. Its components are named rather than left to
         be assumed: a "+/-" covering the u* threshold choice is a far larger claim than one
         covering only the random term, and for NEE the two differ by an order of magnitude. */
      if (isNum(rec.u)) {
        bits.unshift('± ' + nfu(rec.u, d) + ' ' + v.units
          + (v.unc_note ? ' (' + v.unc_note + ')' : ''));
      }
      // The direction first, before the interval and the ranking, because it is what the
      // figure above it means rather than a qualification of it.
      const sense = senseOf(v, rec.v);
      if (sense) bits.unshift(sense);
      const isFlux = v.family === 'flux';
      const thin = isNum(rec.meas) && rec.meas < cov(v.key).warn;
      /* The label is a link into the variable's own page. A reader who has just seen that this
         July was the second warmest of twenty-one is one click from what the Julys have done. */
      (isFlux ? flux : met).push(tile(
        '<a href="#var-' + v.key + '">' + v.short + (v.agg === 'sum' ? ', total' : ', mean')
        + '</a>', nf(rec.v, d),
        v.units, bits.join(' · ') || 'complete', accent, v.column,
        (isFlux ? 'tile-flux' : '') + (thin ? ' tile-thin' : '')));
    });

    /* The tile counts the days that met at least one threshold, not the thresholds met. A day can
       be a summer day, a hot day, a tropical night and the warmest of its date at once, so summing
       the tests reported 56 "threshold days" in a month of 31. */
    let marked = 0;
    for (let d = 1; d <= mo.n; d++) if (DAYS.flags[mo.i0 + d - 1]) marked += 1;
    const counts = FLAGS.filter(f => mo.c[f.key]).map(f => mo.c[f.key] + ' ' + f.short);
    met.push(tile('Days meeting a threshold', String(marked),
      'of ' + mo.n, counts.join(' · ') || 'none in this ' + spanNoun()));

    if (!flux.length) return met.join('');
    return met.join('')
      + '<div class="tiles-break"><span>Fluxes</span></div>'
      + flux.join('');
  }

  /**
   * The extremes of a month and the statistics that belong to the month rather than to one of its
   * variables. A monthly mean says what the month was like on average, which is exactly what a
   * reader looking for the hot Tuesday does not want.
   */
  function monthHighlights(mo) {
    const rows = [];
    const best = (key, stat, how) => {
      let bd = null, bv = null;
      for (let d = 1; d <= mo.n; d++) {
        const v = dayStat(key, stat, mo.i0 + d - 1);
        if (!isNum(v)) continue;
        if (bv === null || (how === 'max' ? v > bv : v < bv)) { bv = v; bd = d; }
      }
      return bd === null ? null : { d: bd, v: bv };
    };
    const line = (label, hit, key, digits) => {
      if (!hit) return;
      rows.push('<dt>' + label + '</dt><dd>' + nf(hit.v, digits) + ' ' + VARS[key].units
        + ' <span class="muted">on ' + hitDate(mo, hit.d) + '</span></dd>');
    };
    if (VARS.TA) {
      line('Warmest day', best('TA', 'max', 'max'), 'TA', 1);
      line('Coldest night', best('TA', 'min', 'min'), 'TA', 1);
      let wd = null, wv = null;
      for (let d = 1; d <= mo.n; d++) {
        const lo = dayStat('TA', 'min', mo.i0 + d - 1), hi = dayStat('TA', 'max', mo.i0 + d - 1);
        if (!isNum(lo) || !isNum(hi)) continue;
        if (wv === null || hi - lo > wv) { wv = hi - lo; wd = d; }
      }
      if (wd) {
        rows.push('<dt>Largest diurnal temperature range</dt><dd>' + nf(wv, 1) + ' '
          + VARS.TA.units + ' <span class="muted">on ' + hitDate(mo, wd) + '</span></dd>');
      }
      if (isNum(mo.x.dtr)) {
        rows.push('<dt>Mean diurnal temperature range</dt><dd>' + nf(mo.x.dtr, 1) + ' '
          + VARS.TA.units + '</dd>');
      }
      if (isNum(mo.x.gdd)) {
        rows.push('<dt>Degree days above 5 ' + VARS.TA.units + '</dt><dd>' + nf(mo.x.gdd, 0)
          + ' K d</dd>');
      }
    }
    if (VARS.PREC) line('Wettest day', best('PREC', 'sum', 'max'), 'PREC', 1);
    if (VARS.SW_IN) line('Brightest day', best('SW_IN', 'mean', 'max'), 'SW_IN', 0);

    let html = '<dl class="kv">' + rows.join('') + '</dl>';
    const notes = [];
    if (mo.x.nrec) {
      notes.push(mo.x.nrec + ' day' + (mo.x.nrec === 1 ? '' : 's') + ' in this ' + spanNoun()
        + ' set a record for the calendar date. Largely gap-filled days are not eligible.');
    }
    Object.keys(mo.ev || {}).forEach(name => {
      const ev = mo.ev[name];
      const label = { gs_start: 'The growing season began', gs_end: 'The growing season ended',
        last_frost: 'The last spring frost occurred', first_frost: 'The first autumn frost occurred'
      }[name];
      notes.push(label + ' on ' + ev.date + (isNum(ev.delta) && ev.delta !== 0
        ? ', ' + Math.abs(ev.delta) + ' days ' + (ev.delta < 0 ? 'earlier' : 'later')
          + ' than the record median.' : ', the record median.'));
    });
    if (notes.length) html += '<p class="smallnote">' + notes.join(' ') + '</p>';
    return html;
  }

  /**
   * The composite, with the axes it was taken over shown rather than summarised away.
   * A reader who is told a month scored 3 of 4 will want to know which three.
   */
  function monthComposite(mo) {
    const axes = M.composite_vars;
    const rows = axes.map(key => {
      const z = mo.z[key];
      const strong = isNum(z) && Math.abs(z) >= 1;
      return '<dt>' + VARS[key].short + '</dt><dd' + (strong ? ' class="strong"' : '') + '>'
        + (isNum(z) ? nfs(z, 1) + '<span class="unit"> sd</span>'
          : '<span class="muted">not assessed</span>') + '</dd>';
    });
    let head;
    if (!isNum(mo.x.zmax)) {
      head = '<p class="card-sub" style="max-width:none">Fewer than ' + M.composite_min_axes
        + ' of the ' + axes.length + ' variables could be assessed for this ' + spanNoun()
        + ', so no count is given. A count out of two is not comparable with a count out of '
        + 'five.</p>';
    } else {
      let driver = null;
      axes.forEach(key => {
        if (isNum(mo.z[key]) && (driver === null || Math.abs(mo.z[key]) > Math.abs(mo.z[driver]))) {
          driver = key;
        }
      });
      head = '<p class="card-sub" style="max-width:none">'
        + (mo.x.nsd === 0
          ? 'No variable in this ' + spanNoun() + ' departed from its normal by one standard '
            + 'deviation or more.'
          : '<b>' + mo.x.nsd + ' of ' + mo.x.nz + ' variables</b> departed from their normal by '
            + 'at least one standard deviation.')
        + (driver ? ' The largest departure was in ' + shortInText(VARS[driver]) + ', at '
          + nfs(mo.z[driver], 1) + ' standard deviations.' : '') + '</p>';
    }
    const C = M.composite;
    const pair = C.strongest;
    return head + '<dl class="kv">' + rows.join('') + '</dl>'
      + '<p class="smallnote">Each figure is the variable’s departure from its normal '
      + 'for this ' + spanNoun() + ', in standard deviations of that variable across the record. '
      + 'A variable covered to less than ' + M.cov_badge_text + ' here, or without a '
      + 'normal, is excluded, not counted as ordinary. The variables are correlated'
      + (pair ? ' (' + shortInText(VARS[pair.a]) + ' and ' + shortInText(VARS[pair.b])
        + ': r = ' + nf(pair.r, 2) + ' across the record)' : '')
      + ', so a count of two is not necessarily two independent departures. The full correlation '
      + 'matrix is on the grid page.</p>';
  }

  /**
   * The season a month belongs to, with the season's own standing, so a warm July can be read
   * against the summer it sat in. On the season scale it runs the other way and lists the months.
   */
  function seasonLine(mo) {
    if (state.scale === 'year') {
      return 'The months of this year: ' + MONTH_ABBR.map((label, i) => {
        const child = monthAt(mo.y, i + 1);
        return child
          ? '<a href="#' + mo.y + '-' + String(i + 1).padStart(2, '0') + '">' + label + '</a>'
          : label;
      }).join(', ') + '.';
    }
    if (state.scale === 'season') {
      // Counted from the scheme rather than written as three: a season is however many months the
      // caller defined it as, and `DJFMAM` is six.
      return 'The ' + NUMBER_WORD[mo.months.length] + ' months of this season: '
        + mo.months.map(ym => {
          const child = monthAt(ym[0], ym[1]);
          return child
            ? '<a href="#' + ym[0] + '-' + String(ym[1]).padStart(2, '0') + '">'
              + MONTH_NAME[ym[1] - 1] + ' ' + ym[0] + '</a>'
            : MONTH_NAME[ym[1] - 1] + ' ' + ym[0] + ' (outside the record)';
        }).join(', ') + '.';
    }
    const se = seasonOfMonth(mo);
    if (!se) return '';
    const head = 'Part of <a href="#' + se.y + '-' + se.s + '">' + se.title.toLowerCase() + '</a>';

    const key = leadKey();
    const rec = key ? se[key] : null;
    let line = head;
    if (rec) {
      const d = monthDigits(key);
      const V = VARS[key];
      line += ': ' + shortInText(V) + ' '
        + (isNum(rec.v) ? nf(rec.v, d) + ' ' + V.units : 'no value');
      const sense = senseOf(V, rec.v);
      if (sense) line += ', ' + sense;
      if (isNum(rec.a)) {
        line += ' (' + (senseAnomaly(V, rec) || nfs(rec.a, d) + ' ' + V.units + ' from normal')
          + ')';
      }
      if (isNum(rec.r) && isNum(rec.n)) {
        // "warmest" is a statement about temperature; anything else ranks without a superlative,
        // since high is not better or worse for a carbon flux.
        const peers = /^[A-Z][a-z]/.test(se.label) ? se.label.toLowerCase() + 's'
          : se.label + ' seasons';
        line += key === 'TA'
          ? ', ' + ord(rec.r) + ' warmest of ' + rec.n + ' ' + peers
          : ', ranked ' + ord(rec.r) + ' of ' + rec.n + ' ' + peers
            + (V.rank_note ? ' (1st = ' + V.rank_note + ')' : '');
      }
    }
    if (se.b.length) {
      line += '. Season badges: ' + se.b.map(b => BADGES[b.k].label.toLowerCase()).join(', ');
    }
    return line + '.';
  }

  function monthBadges(mo) {
    if (!mo.b.length) {
      return '<ul class="badgelist none"><li><span class="bt"><span class="bd">No badge threshold '
        + 'was met in this ' + spanNoun() + '.</span></span></li></ul>';
    }
    return '<ul class="badgelist">' + mo.b.map(b => {
      const meta = BADGES[b.k];
      return '<li>' + chip(b.k, 'lg') + '<span class="bt">'
        + '<span class="bl">' + meta.label + '</span>'
        + '<div class="bd">' + b.t + '.</div></span></li>';
    }).join('') + '</ul>';
  }

  function suppressedNote(mo) {
    /* Every badge withheld for a reason that describes this span - no data, too little coverage,
       no normal, no spread - is listed. One withheld because its variable is not in the build
       (cause `absent`) says nothing about the span and is left out. */
    const rows = mo.sup.filter(s => s.c !== 'absent');
    if (!rows.length) return '';
    const seen = {};
    rows.forEach(s => { seen[s.why] = (seen[s.why] || []).concat(BADGES[s.key].label); });
    return '<p class="smallnote">Badges not evaluated: '
      + Object.keys(seen).map(why => seen[why].join(', ') + ' (' + why + ')').join('; ') + '.</p>';
  }

  /* ------------------------------------------------------------------------------------------
     Month-view building blocks
     ------------------------------------------------------------------------------------------
     Every chart in the month view reads the month the same way - a day axis of 1..n, one daily
     statistic, and the ±CLIM_WINDOW normal for the same calendar dates - so the three accessors
     below are what they all start from. Restating the loop in each chart is what let an earlier
     pass draw one series against the normal of another.
     ------------------------------------------------------------------------------------------ */

  function monthDays(mo) {
    const out = [];
    for (let d = 1; d <= mo.n; d++) out.push(d);
    return out;
  }

  function monthSeries(mo, key, stat) {
    const out = [];
    for (let d = 1; d <= mo.n; d++) out.push(dayStat(key, stat, mo.i0 + d - 1));
    return out;
  }

  /** The normal course of one statistic over the dates of one month: the band and its centre. */
  function monthNormal(mo, key, stat) {
    const n = NORM[key] && NORM[key][stat];
    const lo = [], hi = [], mid = [];
    for (let d = 1; d <= mo.n; d++) {
      const doy = doyAt(mo.i0 + d - 1);
      lo.push(n ? n.p10[doy] : null);
      hi.push(n ? n.p90[doy] : null);
      mid.push(n ? n.mean[doy] : null);
    }
    return { lo: lo, hi: hi, mid: mid, exists: !!n };
  }

  /** A second value axis on the right, for the one chart that carries two units at once. */
  function drawRightAxis(f, sy, spec) {
    const g = el('g', {}, f.svg);
    const x = f.m.left + f.iw;
    el('line', { x1: x, x2: x, y1: f.m.top, y2: f.m.top + f.ih, class: 'ax-line' }, g);
    (spec.ticks || niceTicks(sy.domain[0], sy.domain[1], 3)).forEach(v => {
      const y = sy(v);
      if (y < f.m.top - 1 || y > f.m.top + f.ih + 1) return;
      el('line', { x1: x, x2: x + 4, y1: y, y2: y, class: 'ax-line' }, g);
      svgText(g, x + 7, y + 4, nf(v, spec.digits === undefined ? 0 : spec.digits), 'ax-text',
        { 'text-anchor': 'start' });
    });
    if (spec.label) {
      const t = svgText(g, 0, 0, spec.label, 'ax-title', { 'text-anchor': 'middle' });
      t.setAttribute('transform',
        'translate(' + (x + 34) + ',' + (f.m.top + f.ih / 2) + ') rotate(-90)');
    }
    return g;
  }

  /* ------------------------------------------------------------------------------------------
     Departure from the normal, day by day
     ------------------------------------------------------------------------------------------
     A monthly anomaly is one number for thirty days, and the same number arises from a month that
     was uniformly mild and from one that held a cold first week and a hot last. This is the chart
     that separates them.
     ------------------------------------------------------------------------------------------ */

  function drawMonthAnomaly(mo) {
    return function (host) {
      const days = monthDays(mo);
      const value = monthSeries(mo, 'TA', 'mean');
      const norm = monthNormal(mo, 'TA', 'mean');
      const dev = value.map((v, i) => isNum(v) && isNum(norm.mid[i]) ? v - norm.mid[i] : null);
      // The running mean of the departure, which is where the monthly anomaly comes from.
      const run = [];
      let acc = 0, seen = 0;
      dev.forEach(v => {
        if (isNum(v)) { acc += v; seen += 1; }
        run.push(seen ? acc / seen : null);
      });

      const f = frame(host, { aspect: 0.36,
        ariaLabel: 'Daily air temperature departure from normal' });
      const ext = extent([dev]);
      const span = Math.max(Math.abs(ext[0]), Math.abs(ext[1]), 1) * 1.12;
      const sx = linear(0.5, mo.n + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(-span, span, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: VARS.TA.units, xTicks: dayTicks(mo, f.iw) });

      const bw = Math.max(2, f.iw / mo.n - 2.5);
      days.forEach((d, i) => {
        if (!isNum(dev[i])) return;
        const a = sy(0), b = sy(dev[i]);
        el('rect', { x: sx(d) - bw / 2, y: Math.min(a, b), width: bw,
          height: Math.max(1.2, Math.abs(b - a)), rx: Math.min(3, bw / 2),
          fill: dev[i] >= 0 ? f.p.warm : f.p.cold }, f.svg);
      });
      el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(0), y2: sy(0),
        stroke: f.p.axis, 'stroke-width': 1 }, f.svg);
      el('path', { d: pathFrom(days, run, sx, sy), fill: 'none', stroke: f.p.ink,
        'stroke-width': 1.8, 'stroke-dasharray': '5 3' }, f.svg);

      hover(f, sx, days, d => {
        const i = d - 1;
        return tipRows(labelAt(mo.i0 + d - 1) + ' ' + dateAt(mo.i0 + d - 1).y, [
          { k: 'daily mean', v: nf(value[i], 1) + ' ' + VARS.TA.units },
          { k: 'normal for the date', v: nf(norm.mid[i], 1) + ' ' + VARS.TA.units,
            color: f.p.muted },
          { k: 'departure', v: nfs(dev[i], 1) + ' ' + VARS.TA.units,
            color: isNum(dev[i]) && dev[i] >= 0 ? f.p.warm : f.p.cold },
          { k: 'mean departure to date', v: nfs(run[i], 1) + ' ' + VARS.TA.units, color: f.p.ink }
        ]);
      }, d => selectDay(d));
    };
  }

  /* ------------------------------------------------------------------------------------------
     Soil water against the rain that drives it
     ------------------------------------------------------------------------------------------
     The two are only interpretable together: a soil water series alone cannot show whether a
     decline is drying or a sensor that stopped responding, and the rise after a rain day is what
     separates the two. The rain is given the lower part of the panel on its own axis so it reads
     as the driver rather than as a second series of the same kind.
     ------------------------------------------------------------------------------------------ */

  function drawMonthSoil(mo) {
    return function (host) {
      const days = monthDays(mo);
      const swc = monthSeries(mo, 'SWC', 'mean');
      const norm = monthNormal(mo, 'SWC', 'mean');
      const rain = monthSeries(mo, 'PREC', 'sum');

      const f = frame(host, { aspect: 0.36, margin: { top: 12, right: 52, bottom: 30, left: 46 },
        ariaLabel: 'Daily soil water content and precipitation' });
      const ext = extent([swc, norm.lo, norm.hi]);
      const pad = (ext[1] - ext[0]) * 0.12 || 1;
      const sx = linear(0.5, mo.n + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0] - pad, ext[1] + pad, f.m.top + f.ih, f.m.top);
      // The rain axis is stretched so the bars occupy the lower two fifths and do not overdraw the
      // soil water line, which is the series being explained.
      const rmax = extent([rain])[1];
      const sy2 = linear(0, (rmax > 0 ? rmax : 1) * 2.5, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: VARS['SWC'].units,
        xTicks: dayTicks(mo, f.iw) });
      drawRightAxis(f, sy2, { ticks: niceTicks(0, rmax > 0 ? rmax : 1, 2), digits: 0,
        label: VARS.PREC.units });

      const bw = Math.max(2, f.iw / mo.n - 2.5);
      days.forEach((d, i) => {
        if (!isNum(rain[i]) || rain[i] <= 0) return;
        el('rect', { x: sx(d) - bw / 2, y: sy2(rain[i]), width: bw,
          height: Math.max(1, sy2(0) - sy2(rain[i])), rx: Math.min(2.5, bw / 2),
          fill: f.p.series[0], opacity: 0.42 }, f.svg);
      });
      if (norm.exists) {
        el('path', { d: areaFrom(days, norm.lo, norm.hi, sx, sy), fill: f.p.bandOuter }, f.svg);
        el('path', { d: pathFrom(days, norm.mid, sx, sy), fill: 'none', stroke: f.p.muted,
          'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, f.svg);
      }
      el('path', { d: pathFrom(days, swc, sx, sy), fill: 'none', stroke: f.p.series[2],
        'stroke-width': 2.4, 'stroke-linejoin': 'round' }, f.svg);

      hover(f, sx, days, d => {
        const i = d - 1;
        return tipRows(labelAt(mo.i0 + d - 1) + ' ' + dateAt(mo.i0 + d - 1).y, [
          { k: 'soil water content', v: nf(swc[i], 1) + ' ' + VARS['SWC'].units,
            color: f.p.series[2] },
          { k: 'normal for the date', v: nf(norm.mid[i], 1) + ' ' + VARS['SWC'].units,
            color: f.p.muted },
          { k: 'precipitation', v: nf(rain[i], 1) + ' ' + VARS.PREC.units, color: f.p.series[0] }
        ]);
      }, d => selectDay(d));
    };
  }

  /* ------------------------------------------------------------------------------------------
     One compact panel per remaining variable, each against its own normal band
     ------------------------------------------------------------------------------------------
     Radiation, evaporative demand and humidity carry no chart of their own otherwise, and a
     monthly mean is the statistic least able to describe them: a month can reach its normal
     radiation from steady weather or from a bright fortnight and a dull one.
     ------------------------------------------------------------------------------------------ */

  function drawDailyBand(mo, key, stat, kind) {
    return function (host) {
      const days = monthDays(mo);
      const value = monthSeries(mo, key, stat);
      const norm = monthNormal(mo, key, stat);
      const v = VARS[key];
      const f = frame(host, { aspect: 0.52, margin: { top: 10, right: 12, bottom: 26, left: 44 },
        ariaLabel: 'Daily ' + shortInText(v) + ' and normal' });
      const ext = extent([value, norm.lo, norm.hi]);
      const pad = (ext[1] - ext[0]) * 0.08 || 1;
      const floor = v.agg === 'sum' || key === 'SW_IN' || key === 'VPD' ? 0 : ext[0] - pad;
      const sx = linear(0.5, mo.n + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(Math.min(floor, ext[0]), ext[1] + pad, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: v.digits > 1 ? 1 : 0, yTickCount: 3,
        xTicks: dayTicks(mo, Math.min(400, f.iw)) });
      if (norm.exists) {
        el('path', { d: areaFrom(days, norm.lo, norm.hi, sx, sy), fill: f.p.bandOuter }, f.svg);
        el('path', { d: pathFrom(days, norm.mid, sx, sy), fill: 'none', stroke: f.p.muted,
          'stroke-width': 1.4, 'stroke-dasharray': '4 3' }, f.svg);
      }
      if (kind === 'area') {
        el('path', { d: areaFrom(days, days.map(() => sy.domain[0]), value, sx, sy),
          fill: f.p.series[3], opacity: 0.35 }, f.svg);
      }
      el('path', { d: pathFrom(days, value, sx, sy), fill: 'none',
        stroke: kind === 'area' ? f.p.series[3] : f.p.series[1], 'stroke-width': 2,
        'stroke-linejoin': 'round' }, f.svg);
      hover(f, sx, days, d => {
        const i = d - 1;
        return tipRows(labelAt(mo.i0 + d - 1) + ' ' + dateAt(mo.i0 + d - 1).y, [
          { k: v.short, v: nf(value[i], v.digits) + ' ' + v.units,
            color: kind === 'area' ? f.p.series[3] : f.p.series[1] },
          { k: 'normal for the date', v: nf(norm.mid[i], v.digits) + ' ' + v.units,
            color: f.p.muted }
        ]);
      }, d => selectDay(d));
    };
  }

  /* ------------------------------------------------------------------------------------------
     The average day of the month
     ------------------------------------------------------------------------------------------
     Composited from the hourly arrays: every day of the month averaged onto one 24-hour axis, and
     beside it the same composite over every occurrence of that calendar month in the record. A
     monthly mean cannot show that a warm month was warm at night rather than by day, and the two
     have different causes - the first is cloud and humidity, the second radiation.
     ------------------------------------------------------------------------------------------ */

  const DIURNAL_CACHE = {};

  /* The order the diurnal panels read in: what drives the day, then what it did to the air, then
     what fell out of it. `Object.keys` would give the order the registry happens to declare. */
  const DIURNAL_ORDER = ['SW_IN', 'TA', 'PREC'];
  const diurnalVars = () => (HOURLY ? DIURNAL_ORDER.filter(k => HOURLY.vars[k])
    .concat(Object.keys(HOURLY.vars).filter(k => DIURNAL_ORDER.indexOf(k) < 0)) : []);

  /** The mean hour-of-day profile of one variable over `count` days from day index `from`. */
  function composite(key, from, count) {
    const h = HOURLY && HOURLY.vars[key];
    if (!h) return null;
    const sum = new Array(24).fill(0), n = new Array(24).fill(0);
    for (let k = 0; k < count; k++) {
      const base = (from + k) * 24;
      for (let hh = 0; hh < 24; hh++) {
        const raw = h.values[base + hh];
        if (raw === null || raw === undefined) continue;
        sum[hh] += raw / h.scale;
        n[hh] += 1;
      }
    }
    return n.some(x => x > 0) ? sum.map((s, i) => (n[i] ? s / n[i] : null)) : null;
  }

  /** The same profile over every occurrence of one calendar month in the record. */
  function climComposite(key, month) {
    const id = key + '|' + month;
    if (id in DIURNAL_CACHE) return DIURNAL_CACHE[id];
    const h = HOURLY && HOURLY.vars[key];
    let out = null;
    if (h) {
      const sum = new Array(24).fill(0), n = new Array(24).fill(0);
      MONTHS.filter(x => x.m === month).forEach(x => {
        for (let k = 0; k < x.n; k++) {
          const base = (x.i0 + k) * 24;
          for (let hh = 0; hh < 24; hh++) {
            const raw = h.values[base + hh];
            if (raw === null || raw === undefined) continue;
            sum[hh] += raw / h.scale;
            n[hh] += 1;
          }
        }
      });
      out = n.some(v => v > 0) ? sum.map((s, i) => (n[i] ? s / n[i] : null)) : null;
    }
    DIURNAL_CACHE[id] = out;
    return out;
  }

  function drawComposite(key, values, normal, kind, names) {
    const label = names || { self: 'this ' + spanNoun(), ref: 'the record' };
    return function (host) {
      const hours = values.map((v, i) => i + 0.5);
      const v = VARS[key];
      const f = frame(host, { aspect: 0.62, margin: { top: 10, right: 12, bottom: 28, left: 42 },
        ariaLabel: 'Mean diurnal cycle of ' + shortInText(v) });
      const ext = extent([values, normal]);
      const lo = (kind === 'bars' || kind === 'area') ? 0 : ext[0] - (ext[1] - ext[0]) * 0.1;
      const sy = linear(lo, ext[1] + (ext[1] - ext[0]) * 0.1 || 1, f.m.top + f.ih, f.m.top);
      const sx = linear(0, 24, f.m.left, f.m.left + f.iw);
      drawAxes(f, sx, sy, { yDigits: v.digits > 1 ? 2 : v.digits, yTickCount: 3,
        xTicks: [0, 6, 12, 18, 24].map(h => ({ v: h, label: h + 'h' })) });
      if (normal) {
        el('path', { d: pathFrom(hours, normal, sx, sy), fill: 'none', stroke: f.p.muted,
          'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, f.svg);
      }
      if (kind === 'bars') {
        const bw = Math.max(2, f.iw / 24 - 2);
        values.forEach((x, i) => {
          if (!isNum(x) || x <= 0) return;
          el('rect', { x: sx(i + 0.5) - bw / 2, y: sy(x), width: bw,
            height: Math.max(1, sy(0) - sy(x)), rx: Math.min(2, bw / 2),
            fill: f.p.series[0] }, f.svg);
        });
      } else if (kind === 'area') {
        el('path', { d: areaFrom(hours, values.map(() => 0), values, sx, sy),
          fill: f.p.series[3], opacity: 0.4 }, f.svg);
        el('path', { d: pathFrom(hours, values, sx, sy), fill: 'none', stroke: f.p.series[3],
          'stroke-width': 2.2 }, f.svg);
      } else {
        el('path', { d: pathFrom(hours, values, sx, sy), fill: 'none', stroke: f.p.series[1],
          'stroke-width': 2.4, 'stroke-linejoin': 'round' }, f.svg);
      }
      hover(f, sx, hours, h => {
        const k = Math.floor(h);
        const rows = [{ k: label.self, v: nf(values[k], v.digits) + ' ' + v.units,
          color: kind === 'bars' ? f.p.series[0] : kind === 'area' ? f.p.series[3] : f.p.series[1] }];
        if (normal) {
          rows.push({ k: label.ref, v: nf(normal[k], v.digits) + ' ' + v.units,
            color: f.p.muted });
        }
        return tipRows(String(k).padStart(2, '0') + ':00–' + String(k + 1).padStart(2, '0') + ':00',
          rows);
      });
    };
  }

  /* ------------------------------------------------------------------------------------------
     Where this month sits among the same month of every other year
     ------------------------------------------------------------------------------------------
     One line per variable carrying every year that is measured well enough to be ranked, with
     this one filled. It answers the question an anomaly cannot - whether a departure of one
     degree is remarkable for this calendar month or ordinary - because the spread of the other
     years is drawn rather than summarised.
     ------------------------------------------------------------------------------------------ */

  function drawRankStrip(mo, key) {
    return function (host) {
      const v = VARS[key];
      const rows = scale().spans().filter(x => scale().idOf(x) === scale().idOf(mo)
        && x[key] && isNum(x[key].v));
      const width = Math.max(140, host.clientWidth || 220);
      const height = 32;             // the scale labels' descenders sit inside it
      const d = monthDigits(key);    // a span's precision, as its tile states it
      const svg = el('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height,
        role: 'img', 'aria-label': v.short + ' in every ' + peerOf(mo) + ' of the record' });
      host.innerHTML = '';
      host.appendChild(svg);
      const p = palette();
      const ext = extent([rows.map(x => x[key].v)]);
      const pad = (ext[1] - ext[0]) * 0.06 || 1;
      const sx = linear(ext[0] - pad, ext[1] + pad, 9, width - 9);
      const yc = 15;

      el('line', { x1: 6, x2: width - 6, y1: yc, y2: yc, stroke: p.grid, 'stroke-width': 2,
        'stroke-linecap': 'round' }, svg);
      const nm = climFor(key, mo);
      if (nm) {
        el('line', { x1: sx(nm.mean), x2: sx(nm.mean), y1: yc - 8, y2: yc + 8, stroke: p.muted,
          'stroke-width': 1.4, 'stroke-dasharray': '3 2' }, svg);
      }
      rows.forEach(x => {
        const here = x.y === mo.y;
        const dot = el('circle', { cx: sx(x[key].v), cy: yc, r: here ? 5.5 : 3.4,
          fill: here ? p.series[1] : p.ink2, opacity: here ? 1 : 0.32,
          stroke: here ? p.surface : 'none', 'stroke-width': here ? 1.6 : 0,
          style: here ? '' : 'cursor:pointer' }, svg);
        dot.addEventListener('mousemove', ev => tip.show(
          tipRows(peerOf(mo) + ' ' + x.y,
            [{ k: v.short, v: nf(x[key].v, d) + ' ' + v.units }]),
          ev.clientX, ev.clientY));
        dot.addEventListener('mouseleave', tip.hide);
        if (!here) {
          dot.addEventListener('click',
            () => { location.hash = x.y + '-' + scale().slug(mo); });
        }
      });
      svgText(svg, 4, height - 3, nf(ext[0], d), 'scalebar-text', { 'text-anchor': 'start' });
      svgText(svg, width - 4, height - 3, nf(ext[1], d), 'scalebar-text',
        { 'text-anchor': 'end' });
    };
  }

  /* ------------------------------------------------------------------------------------------
     The same month of every year, as daily curves
     ------------------------------------------------------------------------------------------
     The rank strips place the month as one number among twenty-one, and the bar chart places its
     aggregate. Neither shows its *shape*, which is what says whether a warm month was warm
     throughout or held one heat wave that carried it - and whether the run it held is one the
     other years also produce.
     ------------------------------------------------------------------------------------------ */

  function drawMonthShape(mo) {
    return function (host) {
      const rows = scale().spans().filter(x => scale().idOf(x) === scale().idOf(mo));
      const days = monthDays(mo);
      const norm = monthNormal(mo, 'TA', 'mean');
      const series = rows.map(x => {
        const out = [];
        for (let d = 1; d <= mo.n; d++) {
          // A February of 28 days has no 29th; the curve simply ends where its month does.
          out.push(d <= x.n ? dayStat('TA', 'mean', x.i0 + d - 1) : null);
        }
        return { y: x.y, values: out };
      });

      const f = frame(host, { aspect: 0.36,
        ariaLabel: 'Daily mean air temperature in every ' + peerOf(mo) + ' of the record' });
      const ext = extent(series.map(s => s.values));
      const sx = linear(0.5, mo.n + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0] - 1, ext[1] + 1, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: VARS.TA.units, xTicks: dayTicks(mo, f.iw) });
      series.filter(s => s.y !== mo.y).forEach(s => {
        el('path', { d: pathFrom(days, s.values, sx, sy), fill: 'none', stroke: f.p.ink2,
          'stroke-width': 1.1, opacity: 0.26, 'stroke-linejoin': 'round' }, f.svg);
      });
      el('path', { d: pathFrom(days, norm.mid, sx, sy), fill: 'none', stroke: f.p.muted,
        'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, f.svg);
      const here = series.find(s => s.y === mo.y);
      if (here) {
        el('path', { d: pathFrom(days, here.values, sx, sy), fill: 'none', stroke: f.p.series[1],
          'stroke-width': 2.6, 'stroke-linejoin': 'round' }, f.svg);
      }

      hover(f, sx, days, d => {
        const i = d - 1;
        const others = series.filter(s => s.y !== mo.y).map(s => s.values[i]).filter(isNum)
          .sort((a, b) => a - b);
        const rank = here && isNum(here.values[i])
          ? series.map(s => s.values[i]).filter(isNum).filter(v => v > here.values[i]).length + 1
          : null;
        // The date this position on the axis is, derived from the span's own first day: `mo.m`
        // exists only on the month scale, and read here it titled every tooltip "1 undefined".
        return tipRows(labelAt(mo.i0 + d - 1), [
          { k: mo.y, v: nf(here ? here.values[i] : null, 1) + ' ' + VARS.TA.units,
            color: f.p.series[1] },
          { k: 'normal for the date', v: nf(norm.mid[i], 1) + ' ' + VARS.TA.units,
            color: f.p.muted },
          { k: 'other years, range', v: others.length
            ? nf(others[0], 1) + ' – ' + nf(others[others.length - 1], 1) : '–' },
          { k: isNum(rank) ? ord(rank) + ' warmest of ' + (others.length + 1) : '', rule: true }
        ]);
      }, d => selectDay(d));
    };
  }

  function rankStrips(mo) {
    const host = document.createElement('div');
    host.className = 'strips';
    DATA.variables.forEach(v => {
      const rec = mo[v.key];
      if (!rec || !isNum(rec.v)) return;
      const row = document.createElement('div');
      row.className = 'strip';
      /* "highest" states a direction the rank does not have. NEE is ranked from the negative end,
         because the sign convention makes the most negative span the largest uptake, so its 1st is
         the record sink rather than the largest number. The tiles and the variable page say which
         end rank 1 is where it is not obvious; so does this. */
      const rank = isNum(rec.r) && isNum(rec.n)
        ? '<b>' + ord(rec.r) + '</b> of ' + rec.n
          + (v.rank_note ? ' (1st = ' + v.rank_note + ')' : '')
        : 'not ranked';
      row.innerHTML = '<span class="sname"><b>' + v.short + '</b>'
        + nf(rec.v, monthDigits(v.key)) + ' ' + v.units + '</span>'
        + '<div class="striphost"></div>'
        + '<span class="srank">' + rank + '</span>';
      host.appendChild(row);
      mountChart(row.querySelector('.striphost'), drawRankStrip(mo, v.key));
    });
    return host;
  }

  function drawMonthTemperature(mo) {
    return function (host) {
      const days = [], tmin = [], tmax = [], tmean = [], nlo = [], nhi = [], nmean = [];
      for (let d = 1; d <= mo.n; d++) {
        const i = mo.i0 + d - 1, doy = doyAt(i);
        days.push(d);
        tmin.push(dayStat('TA', 'min', i));
        tmax.push(dayStat('TA', 'max', i));
        tmean.push(dayStat('TA', 'mean', i));
        nlo.push(NORM.TA.mean.p10[doy]);
        nhi.push(NORM.TA.mean.p90[doy]);
        nmean.push(NORM.TA.mean.mean[doy]);
      }
      const f = frame(host, { aspect: 0.36, ariaLabel: 'Daily air temperature' });
      const ext = extent([tmin, tmax, nlo, nhi]);
      const sx = linear(0.5, mo.n + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(ext[0] - 1, ext[1] + 1, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: VARS.TA.units, xTicks: dayTicks(mo, f.iw) });
      el('path', { d: areaFrom(days, nlo, nhi, sx, sy), fill: f.p.bandOuter }, f.svg);
      el('path', { d: areaFrom(days, tmin, tmax, sx, sy), fill: f.p.bandInner, opacity: 0.85 },
        f.svg);
      el('path', { d: pathFrom(days, nmean, sx, sy), fill: 'none', stroke: f.p.muted,
        'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, f.svg);
      el('path', { d: pathFrom(days, tmean, sx, sy), fill: 'none', stroke: f.p.series[1],
        'stroke-width': 2, 'stroke-linejoin': 'round' }, f.svg);
      hover(f, sx, days, d => {
        const i = d - 1;
        return tipRows(labelAt(mo.i0 + d - 1) + ' ' + dateAt(mo.i0 + d - 1).y, [
          { k: 'minimum', v: nf(tmin[i], 1) + ' ' + VARS.TA.units },
          { k: 'mean', v: nf(tmean[i], 1) + ' ' + VARS.TA.units, color: f.p.series[1] },
          { k: 'maximum', v: nf(tmax[i], 1) + ' ' + VARS.TA.units },
          { k: 'normal of daily mean', v: nf(nmean[i], 1) + ' ' + VARS.TA.units, color: f.p.muted }
        ]);
      }, d => selectDay(d));
    };
  }

  function drawMonthPrecip(mo) {
    return function (host) {
      const days = [], sums = [], norm = [];
      for (let d = 1; d <= mo.n; d++) {
        const i = mo.i0 + d - 1, doy = doyAt(i);
        days.push(d);
        sums.push(dayStat('PREC', 'sum', i));
        norm.push(NORM.PREC.sum ? NORM.PREC.sum.mean[doy] : null);
      }
      const f = frame(host, { aspect: 0.36, ariaLabel: 'Daily precipitation' });
      const ext = extent([sums, norm]);
      const sx = linear(0.5, mo.n + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(0, ext[1] * 1.08 || 1, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: VARS.PREC.units, xTicks: dayTicks(mo, f.iw) });
      const bw = Math.max(2, f.iw / mo.n - 2);
      days.forEach((d, i) => {
        if (!isNum(sums[i]) || sums[i] <= 0) return;
        el('rect', { x: sx(d) - bw / 2, y: sy(sums[i]), width: bw,
          height: Math.max(1, sy(0) - sy(sums[i])), rx: Math.min(3, bw / 2),
          fill: f.p.series[0] }, f.svg);
      });
      el('path', { d: pathFrom(days, norm, sx, sy), fill: 'none', stroke: f.p.muted,
        'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, f.svg);
      hover(f, sx, days, d => {
        const i = d - 1;
        return tipRows(labelAt(mo.i0 + d - 1) + ' ' + dateAt(mo.i0 + d - 1).y, [
          { k: 'daily total', v: nf(sums[i], 1) + ' ' + VARS.PREC.units, color: f.p.series[0] },
          { k: 'normal for the date', v: nf(norm[i], 1) + ' ' + VARS.PREC.units, color: f.p.muted }
        ]);
      }, d => selectDay(d));
    };
  }

  function drawMonthCumulative(mo) {
    return function (host) {
      const days = [], run = [], runNorm = [];
      let a = 0, b = 0, seen = false;
      for (let d = 1; d <= mo.n; d++) {
        const i = mo.i0 + d - 1, doy = doyAt(i);
        const v = dayStat('PREC', 'sum', i);
        const n = NORM.PREC.sum ? NORM.PREC.sum.mean[doy] : null;
        days.push(d);
        if (isNum(v)) { a += v; seen = true; }
        run.push(seen ? a : null);
        if (isNum(n)) b += n;
        runNorm.push(b);
      }
      const f = frame(host, { aspect: 0.36, ariaLabel: 'Cumulative precipitation' });
      const sx = linear(1, mo.n, f.m.left, f.m.left + f.iw);
      const sy = linear(0, extent([run, runNorm])[1] * 1.08 || 1, f.m.top + f.ih, f.m.top);
      drawAxes(f, sx, sy, { yDigits: 0, yLabel: VARS.PREC.units, xTicks: dayTicks(mo, f.iw) });
      el('path', { d: pathFrom(days, runNorm, sx, sy), fill: 'none', stroke: f.p.muted,
        'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, f.svg);
      el('path', { d: pathFrom(days, run, sx, sy), fill: 'none', stroke: f.p.series[0],
        'stroke-width': 2.2, 'stroke-linejoin': 'round' }, f.svg);
      hover(f, sx, days, d => tipRows('to ' + labelAt(mo.i0 + d - 1), [
        { k: 'this ' + spanNoun(), v: nf(run[d - 1], 1) + ' ' + VARS.PREC.units,
          color: f.p.series[0] },
        { k: 'normal by this date', v: nf(runNorm[d - 1], 1) + ' ' + VARS.PREC.units,
          color: f.p.muted }
      ]), d => selectDay(d));
    };
  }

  /** The climatology of the slot a span belongs to: a calendar month, a season, or the record.
   *
   * The year's peer group is the record itself, so it has one climatology rather than one per
   * slot. Falling through to the month branch read `CLIM[key][undefined]`, which is why the year
   * panel drew no dashed normal where its own cards said one would be.
   */
  function climFor(key, mo) {
    if (state.scale === 'season') return (DATA.season_climatology[key] || {})[mo.s];
    if (state.scale === 'year') return (DATA.year_climatology || {})[key];
    return (CLIM[key] || {})[String(mo.m)];
  }

  function drawAcrossYears(mo) {
    const met = metric();
    return function (host) {
      const rows = scale().spans().filter(x => scale().idOf(x) === scale().idOf(mo));
      const years = rows.map(x => x.y);
      const values = rows.map(x => monthValue(met, x));
      const f = frame(host, { aspect: 0.34, ariaLabel: met.label + ' in every ' + peerOf(mo) });
      const ext = extent([values]);
      const lo = Math.min(0, ext[0]), hi = ext[1];
      const sx = linear(years[0] - 0.5, years[years.length - 1] + 0.5, f.m.left, f.m.left + f.iw);
      const sy = linear(lo, hi * 1.06 || 1, f.m.top + f.ih, f.m.top);
      const every = Math.max(1, Math.ceil(years.length / Math.max(3, Math.floor(f.iw / 54))));
      drawAxes(f, sx, sy, { yDigits: met.digits > 1 ? 1 : 0, yLabel: met.units,
        xTicks: years.filter((y, i) => i % every === 0 || i === years.length - 1)
          .map(y => ({ v: y, label: String(y) })) });
      const bw = Math.max(3, f.iw / years.length - 4);
      years.forEach((y, i) => {
        if (!isNum(values[i])) return;
        const top = Math.min(sy(values[i]), sy(0)), bottom = Math.max(sy(values[i]), sy(0));
        el('rect', { x: sx(y) - bw / 2, y: top, width: bw, height: Math.max(1, bottom - top),
          rx: Math.min(3, bw / 2), fill: y === mo.y ? f.p.series[1] : f.p.series[0],
          opacity: y === mo.y ? 1 : 0.55 }, f.svg);
      });
      const nm = climFor(met.var, mo);
      if (nm && met.field === 'value') {
        el('line', { x1: f.m.left, x2: f.m.left + f.iw, y1: sy(nm.mean), y2: sy(nm.mean),
          stroke: f.p.muted, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, f.svg);
      }
      hover(f, sx, years, y => {
        const i = years.indexOf(y);
        return tipRows(peerOf(mo) + ' ' + y, [
          { k: met.short, v: nf(values[i], met.digits) + ' ' + met.units,
            color: y === mo.y ? f.p.series[1] : f.p.series[0] }
        ]);
      }, y => { if (y !== mo.y) location.hash = y + '-' + scale().slug(mo); });
    };
  }

  /**
   * The x axis of a day-by-day chart, at whatever length the span is.
   *
   * A month is labelled by its days. A season or a year cannot be: a tick per day over 365 of them
   * draws a grey band where an axis should be, and at any spacing that fits, a day number tells a
   * reader nothing anyway. Past two months the axis is labelled by the months inside the span
   * instead, which is the scale a reader is actually locating themselves on.
   *
   * The count is taken from the width in both cases, so a card in a narrow column thins its labels
   * rather than overprinting them.
   */
  function dayTicks(mo, width) {
    const target = Math.max(4, Math.floor(width / 70));
    const out = [];
    if (mo.n > 62) {
      for (let d = 1; d <= mo.n; d++) {
        const at = dateAt(mo.i0 + d - 1);
        if (at.d === 1) out.push({ v: d, label: MONTH_ABBR[at.m - 1] });
      }
      const step = Math.max(1, Math.ceil(out.length / target));
      return out.filter((t, i) => i % step === 0);
    }
    const every = Math.max(1, Math.ceil(mo.n / target));
    for (let d = 1; d <= mo.n; d++) {
      if (d === 1 || d % every === 0) out.push({ v: d, label: String(d) });
    }
    return out;
  }

  /** A crosshair over a discrete x axis, with a click that hands the value back. */
  function hover(f, sx, values, tipFor, onClick) {
    const line = el('line', { class: 'crosshair', y1: f.m.top, y2: f.m.top + f.ih,
      opacity: 0 }, f.svg);
    const hit = el('rect', { class: 'hit', x: f.m.left, y: f.m.top, width: f.iw, height: f.ih },
      f.svg);
    const nearest = ev => {
      const box = f.svg.getBoundingClientRect();
      const px = (ev.clientX - box.left) * (f.width / box.width);
      let best = values[0], bestD = Infinity;
      values.forEach(v => {
        const d = Math.abs(sx(v) - px);
        if (d < bestD) { bestD = d; best = v; }
      });
      return best;
    };
    hit.addEventListener('mousemove', ev => {
      const v = nearest(ev);
      line.setAttribute('x1', sx(v));
      line.setAttribute('x2', sx(v));
      line.setAttribute('opacity', 1);
      tip.show(tipFor(v), ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', () => { line.setAttribute('opacity', 0); tip.hide(); });
    if (onClick) hit.addEventListener('click', ev => onClick(nearest(ev)));
  }

  /* Anything longer than a month is drawn as one calendar per month: a ninety-day sheet with one
     unbroken run of weeks would put the 1st of March in the middle of a row and read as nothing,
     and a year drawn that way numbered its cells 1 to 366 under Mon-Sun headers.

     A season carries the calendar months it is made of, because it may begin in the previous year;
     a year is simply its own twelve. */
  function dayCalendar(mo) {
    const facets = state.scale === 'season' ? mo.months
      : state.scale === 'year' ? MONTH_NAME.map((name, i) => [mo.y, i + 1])
        : null;
    if (!facets) return dayCalendarOf(mo);
    return facets.map(ym => {
      const child = monthAt(ym[0], ym[1]);
      if (!child) return '';
      // Each child keeps the month it came from, so a day opens in that month rather than
      // as an ambiguous nth day of a season or a year.
      return '<p class="facet-title">' + MONTH_NAME[ym[1] - 1] + ' ' + ym[0] + '</p>'
        + dayCalendarOf(child).replace(/data-day="/g,
          'data-ym="' + ym[0] + '-' + ym[1] + '" data-day="');
    }).join('');
  }

  function dayCalendarOf(mo) {
    const met = metric();
    const first = (new Date(Date.UTC(mo.y, mo.m - 1, 1)).getUTCDay() + 6) % 7;
    const parts = WEEKDAY.map(w => '<div class="dayhead">' + w + '</div>');
    for (let i = 0; i < first; i++) parts.push('<div class="daycell blank"></div>');

    let maxRain = 0;
    for (let d = 1; d <= mo.n; d++) {
      const v = dayStat('PREC', 'sum', mo.i0 + d - 1);
      if (isNum(v) && v > maxRain) maxRain = v;
    }

    for (let d = 1; d <= mo.n; d++) {
      const i = mo.i0 + d - 1;
      const at = dateAt(i);
      const value = dayValue(met, i, at.y, at.m, at.d);
      const rgb = dayColor(met, value);
      const cls = ['daycell'];
      let style = '';
      if (rgb) { cls.push(inkClass(rgb)); style = ' style="background:' + css(rgb) + '"'; }
      const meas = DAYS.meas[met.var] ? DAYS.meas[met.var][i] : null;
      if (isNum(meas) && meas < cov(met.var).warn) cls.push('sparse');

      const flags = DAY_MARKS.filter(m => flagSet(DAYS.flags[i], m[0]))
        .slice(0, 3).map(m => markChip(m[1], 'sm')).join('');
      const rain = dayStat('PREC', 'sum', i);
      const sub = met.var === 'TA'
        ? nf(dayStat('TA', 'min', i), 0) + ' / ' + nf(dayStat('TA', 'max', i), 0)
        : (isNum(rain) && rain > 0 ? nf(rain, 1) + ' ' + VARS.PREC.units : '');

      parts.push('<button type="button" class="' + cls.join(' ') + '"' + style
        + ' data-day="' + d + '" aria-label="' + d + ' ' + MONTH_NAME[mo.m - 1] + ' ' + mo.y + '">'
        + '<span class="dnum">' + d + '</span>'
        + '<span class="dval">' + (met.day.kind === 'flag' ? nf(value, 0) : metricFormat(met, value))
        + '</span>'
        + (sub ? '<span class="dsub">' + sub + '</span>' : '')
        + '<span class="dflags">' + flags + '</span>'
        + (isNum(rain) && maxRain > 0 && rain > 0
          ? '<span class="drain" style="width:' + (100 * rain / maxRain).toFixed(0) + '%"></span>'
          : '')
        + '</button>');
    }
    return '<div class="daygrid">' + parts.join('') + '</div>';
  }

  function dayTable(mo) {
    const columns = ['Day'];
    DATA.variables.forEach(v => v.ship.forEach(s => {
      columns.push(v.short + ' ' + (s === 'sum' ? 'total' : s));
    }));
    const rows = [];
    for (let d = 1; d <= mo.n; d++) {
      const i = mo.i0 + d - 1;
      const row = [labelAt(mo.i0 + d - 1)];
      DATA.variables.forEach(v => v.ship.forEach(s => {
        row.push(nf(dayStat(v.key, s, i), v.digits));
      }));
      rows.push(row);
    }
    return tableHTML(columns, rows);
  }

  /* The two consequences of a season that crosses the new year, stated for whichever season does.
     It is labelled by the year of its later months, so the record's first one is short at the
     front and its last December-or-equivalent belongs to a season the record does not reach. */
  function seasonEdgeNote() {
    const wrapping = SEASON_DEFS.find(d => d.months.some((m, i) => i && m < d.months[i - 1]));
    if (!wrapping) return '';
    const first = MONTH_NAME[wrapping.months[0] - 1];
    const last = MONTH_NAME[wrapping.months[wrapping.months.length - 1] - 1];
    return ' ' + wrapping.label + ' runs from ' + first + ' to ' + last + ' and takes the year of '
      + 'its ' + last + '. The first one in the record therefore lacks its ' + first
      + ', and the last ' + first + ' of the record belongs to a season outside it.';
  }

  /* Which season each calendar month falls in, read from the scheme the atlas was built with
     rather than assumed to be the four meteorological ones. A build with `seasons=none` has no
     entry for any month, and the chip is simply left off. */
  const SEASON = (function () {
    const out = {};
    SEASON_DEFS.forEach(d => d.months.forEach(m => { out[m] = d.label; }));
    return out;
  })();

  /**
   * One sentence stating what the month was, assembled from the statistics the tiles carry.
   * Nothing is asserted that the numbers do not support: a clause is omitted where its value or
   * its normal is missing, rather than falling back to a form of words that would read as a
   * measurement.
   */
  function monthLede(mo) {
    const bits = [];
    const ta = mo.TA, pr = mo.PREC;
    if (ta && isNum(ta.v)) {
      let s = 'Mean air temperature <b>' + nf(ta.v, 1) + ' ' + VARS.TA.units + '</b>';
      if (isNum(ta.a)) {
        s += ', ' + nfs(ta.a, 1) + ' ' + VARS.TA.units + ' relative to the '
          + peerOf(mo) + ' normal';
      }
      if (isNum(ta.r) && isNum(ta.n)) s += ' (' + ord(ta.r) + ' warmest of ' + ta.n + ')';
      bits.push(s);
    }
    if (pr && isNum(pr.v)) {
      let s = 'precipitation <b>' + nf(pr.v, 0) + ' ' + VARS.PREC.units + '</b>';
      if (isNum(pr.p)) s += ', ' + nf(pr.p, 0) + ' % of normal';
      if (mo.c.wet) s += ' on ' + mo.c.wet + ' wet day' + (mo.c.wet === 1 ? '' : 's');
      bits.push(s);
    }
    const plural = (n, what) => n + ' ' + what + ' day' + (n === 1 ? '' : 's');
    const counts = [
      mo.c.hot ? plural(mo.c.hot, 'hot') : null,
      mo.c.frost ? plural(mo.c.frost, 'frost') : null,
      mo.c.ice ? plural(mo.c.ice, 'ice') : null
    ].filter(Boolean);
    if (counts.length) bits.push(counts.join(', '));

    /* A build carrying neither temperature nor precipitation - the fluxes on their own - is
       summarised through whatever it does carry, rather than not at all. */
    if (!bits.length) {
      DATA.variables.slice(0, 3).forEach(V => {
        const rec = mo[V.key];
        if (!rec || !isNum(rec.v)) return;
        const d = monthDigits(V.key);
        let s = V.short + ' <b>' + nf(rec.v, d) + ' ' + V.units + '</b>';
        const sense = senseOf(V, rec.v);
        if (sense) s += ' (' + sense + ')';
        if (isNum(rec.a)) {
          s += ', ' + (senseAnomaly(V, rec) || nfs(rec.a, d) + ' ' + V.units
            + ' relative to the ' + peerOf(mo) + ' normal');
        }
        if (isNum(rec.r) && isNum(rec.n)) {
          s += ' (ranked ' + ord(rec.r) + ' of ' + rec.n
            + (V.rank_note ? ', 1st = ' + V.rank_note : '') + ')';
        }
        bits.push(s);
      });
    }
    if (!bits.length) return 'No variable has a value for this ' + spanNoun() + '.';
    return cap(bits.join('; ')) + '.';
  }

