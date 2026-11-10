  /* ------------------------------------------------------------------------------------------
     Level 3: one day
     ------------------------------------------------------------------------------------------ */

  /* A day is opened as a day of its own month whatever span it was selected from, because that is
     the only route the day panel has. The charts hand back a day index within the span, so the
     calendar date is derived from the span's first day exactly as `dateAt` derives one everywhere
     else. Built from `state.m` - which is null off the month scale - this produced `#2016-null-01`
     and dropped the reader back on the grid. */
  function selectDay(d) {
    if (!isNum(d) || !state.span) return;
    const at = dateAt(state.span.i0 + d - 1);
    location.hash = at.y + '-' + String(at.m).padStart(2, '0') + '-'
      + String(at.d).padStart(2, '0');
  }

  function hourlyFor(varKey, i) {
    if (!HOURLY || !HOURLY.vars[varKey]) return null;
    const h = HOURLY.vars[varKey];
    const start = i * 24;
    const out = [];
    for (let k = 0; k < 24; k++) {
      const raw = h.values[start + k];
      out.push(raw === null || raw === undefined ? null : raw / h.scale);
    }
    return out.some(isNum) ? out : null;
  }

  function renderDay() {
    const mo = monthAt(state.y, state.m);
    const d = state.d;
    const i = mo.i0 + d - 1;
    const host = document.getElementById('day-panel');
    const weekday = WEEKDAY_LONG[(new Date(Date.UTC(state.y, state.m - 1, d)).getUTCDay() + 6) % 7];

    host.innerHTML = '<h2 class="section">Selected day</h2>'
      + '<div class="grid daypanel" id="day-grid"></div>';
    const grid = document.getElementById('day-grid');

    const body = cardEl(grid, {
      title: weekday + ', ' + d + ' ' + MONTH_NAME[state.m - 1] + ' ' + state.y, width: 'w-4',
      sub: 'Day ' + doy365(state.y, state.m, d) + ' of the year.'
    });
    let kv = '<dl class="kv">';
    DATA.variables.forEach(v => {
      v.ship.forEach(s => {
        const value = dayStat(v.key, s, i);
        if (!isNum(value)) return;
        const label = v.short + ' ' + (s === 'sum' ? 'total' : s);
        let line = nf(value, v.digits) + ' ' + v.units;
        const n = dayNormal(v.key, s, state.y, state.m, d);
        if (isNum(n)) line += ' (' + nfs(value - n, v.digits) + ')';
        kv += '<dt>' + label + '</dt><dd>' + line + '</dd>';
      });
      const meas = DAYS.meas[v.key] ? DAYS.meas[v.key][i] : null;
      const nee = partitionedFrom(v);
      if (isNum(meas) && meas < 99.5 && !(v.partitioned && !v.fill)) {
        kv += '<dt>' + v.short + (nee ? ' from measured ' + nee : ' measured') + '</dt><dd>'
          + nf(meas, 0) + ' %</dd>';
      }
    });
    kv += '</dl>';
    /* A record is stated first and in words, because it is the one thing about a day that a
       reader cannot work out from the numbers above it. */
    const records = [
      ['recwarm', 'the warmest'], ['reccold', 'the coldest'], ['recwet', 'the wettest']
    ].filter(x => flagSet(DAYS.flags[i], x[0]));
    const dateName = d + ' ' + MONTH_NAME[state.m - 1];
    const set = FLAGS.filter(f => flagSet(DAYS.flags[i], f.key)
      && !f.key.startsWith('rec'));
    body.innerHTML = kv
      + (records.length
        ? '<p class="smallnote"><b>This is ' + records.map(x => x[1]).join(' and ')
          + ' ' + dateName + ' in the record.</b> Largely gap-filled days are excluded from this '
          + 'comparison.</p>'
        : '')
      + '<p class="smallnote">' + (set.length
        ? 'Thresholds met: ' + set.map(f => f.label).join(', ') + '.'
        : 'This day met none of the thresholds on this page.')
      + ' Values in brackets are departures from the ±' + M.clim_window
      + ' day normal for the same date.</p>';

    if (!HOURLY) {
      const nb = cardEl(grid, { title: 'Hourly values', width: 'w-8' });
      nb.innerHTML = '<p class="card-sub" style="max-width:none">This page was built without the '
        + 'hourly arrays, so only daily statistics are shown. Rebuild without '
        + '<code>--no-hourly</code> for hourly charts.</p>';
      return;
    }

    const monthName = MONTH_NAME[state.m - 1];
    const facets = cardEl(grid, {
      title: 'Hourly values', width: 'w-8',
      sub: 'Hourly means (hourly totals for precipitation) from the half-hourly records. The '
        + 'dashed line on each panel is the mean diurnal cycle of every ' + monthName
        + ' in the record.'
    });
    const wrap = document.createElement('div');
    wrap.className = 'dayfacets';
    facets.appendChild(wrap);
    let drawn = 0;
    diurnalVars().forEach(key => {
      const values = hourlyFor(key, i);
      if (!values) return;
      drawn++;
      const box = document.createElement('div');
      box.innerHTML = '<p class="facet-title">' + VARS[key].short
        + ' <span class="unit">(' + VARS[key].units + (key === 'PREC' ? ' per hour' : '')
        + ')</span></p><div class="chart"></div>';
      wrap.appendChild(box);
      const kind = key === 'PREC' ? 'bars' : (key === 'SW_IN' ? 'area' : 'line');
      mountChart(box.querySelector('.chart'), drawComposite(key, values,
        climComposite(key, state.m), kind, { self: 'this day', ref: 'mean ' + monthName }));
    });
    if (!drawn) {
      wrap.innerHTML = '<p class="card-sub">No hourly values are available for this day.</p>';
    } else {
      facets.insertAdjacentHTML('beforeend', legendHTML([
        { color: 'var(--text-muted)', label: 'mean ' + monthName + ' diurnal cycle, '
          + M.first_year + '–' + M.last_year, line: true }
      ]));
    }
  }

