  /* ------------------------------------------------------------------------------------------
     Formatting
     ------------------------------------------------------------------------------------------ */

  const isNum = v => v !== null && v !== undefined && !Number.isNaN(v);
  const nf = (v, d = 1) => isNum(v) ? v.toFixed(d) : '–';

  /* An interval must never print as "0" - that reads as certainty, not as a small uncertainty. A
     sensible heat interval of 0.4 W m-2 rounds away at the variable's own precision, so decimals
     are added until it does not. */
  const nfu = (v, d = 1) => {
    if (!isNum(v)) return '–';
    let k = d;
    while (v !== 0 && Number(v.toFixed(k)) === 0 && k < d + 3) k += 1;
    return v.toFixed(k);
  };

  /* How much of a span has to be measured before its statistics stand, for one variable. The
     thresholds differ by how the quantity is measured - meteorology runs continuously, while u*
     filtering rejects most nights of an eddy covariance record by design - so they travel per
     variable and the meta values are only the fallback for a payload built before they did. */
  const cov = key => (VARS[key] && VARS[key].cov) || {
    badge: M.min_badge_coverage, normal: M.normal_min_coverage, warn: M.sparse_coverage
  };

  /* The decimals a monthly figure is printed to. Taken from the metric that reads the variable
     straight off the product, so a sentence about a month states it to exactly the precision its
     tile does; `digits` on the variable is the daily one and is finer. */
  const monthDigits = key => {
    const met = VARS[key] && VARS[key].metric && METRICS[VARS[key].metric];
    return met && isNum(met.digits) ? met.digits : (VARS[key] ? VARS[key].digits : 1);
  };

  /* The variable a one-line summary is told through: air temperature where the build has it, since
     that is the axis most of the page's structure is built on, and otherwise whichever variable
     came first. An atlas of fluxes alone carries no temperature record, and reading one anyway is
     what used to throw here. */
  const leadKey = () => (VARS.TA ? 'TA' : (DATA.variables[0] || {}).key);

  /* Which variables lean hardest on the gap-filling, as one sentence. The warning line differs by
     variable - half of every eddy covariance record is rejected by u* filtering, so a flux is held
     to a lower one than a thermometer - and a reader is told which spans fell under it rather than
     left to infer it from the hatching. */
  function thinNote() {
    const thin = M.thin || {};
    const named = Object.keys(thin).filter(k => thin[k].n > 0)
      .sort((a, b) => thin[b].n - thin[a].n)
      .map(k => (VARS[k] ? VARS[k].short : k) + ', ' + thin[k].n
        + ' of ' + thin[k].n_total + ' months below ' + nf(thin[k].warn, 0) + ' %');
    if (!named.length) {
      return 'No span in this record falls below its warning threshold for measured share.';
    }
    return 'Months below the warning threshold for measured share, hatched on the grid: '
      + named.join('; ') + '. Compare a slope with how these months are distributed through '
      + 'the record.';
  }
  /* A departure carries its sign, except where it rounds to nothing: "-0.0" states a direction the
     printed number does not support, and "+0.0" is the same error the other way. */
  const nfs = (v, d = 1) => {
    if (!isNum(v)) return '–';
    const s = v.toFixed(d);
    return +s === 0 ? Math.abs(+s).toFixed(d) : (v > 0 ? '+' : '') + s;
  };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* Text that is the caller's rather than ours, made safe to concatenate into markup. The site's
     name and description, the input's file name and every column name arrive from whoever built
     the page, and a `<` in any of them used to reach `innerHTML` as markup: a description reading
     "Plot <b>north</b>" came out in bold, and one with an unclosed tag took the rest of the footer
     with it. Everything the registry supplies is ours and is left alone; everything the caller
     supplies goes through this, including the attribute values it lands in. */
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
      "'": '&#39;' }[c]));
  const ord = n => {
    if (!isNum(n)) return '–';
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* The grid's month header sticks directly beneath the top bar, so the offset it sticks at has to
     be the bar's measured height rather than a number written once. A guessed offset that is too
     small hides the header behind the bar and one that is too large leaves a band of tiles
     scrolling in the gap - and the bar's height moves with the font, the zoom and the viewport. */
  function measureTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    document.documentElement.style.setProperty(
      '--topbar-h', Math.round(bar.getBoundingClientRect().height) + 'px');
  }

  function palette() {
    return {
      series: [token('--series-1'), token('--series-2'), token('--series-3'), token('--series-4')],
      cold: token('--pole-cold'), warm: token('--pole-warm'), mid: token('--neutral-mid'),
      bandOuter: token('--band-outer'), bandInner: token('--band-inner'),
      ink: token('--text-primary'), ink2: token('--text-secondary'), muted: token('--text-muted'),
      axis: token('--axis'), grid: token('--grid'), surface: token('--surface')
    };
  }

  /* ------------------------------------------------------------------------------------------
     Colour
     ------------------------------------------------------------------------------------------ */

  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  function rampRGB(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const pos = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    return mix(stops[i], stops[i + 1], pos - i);
  }
  const css = c => 'rgb(' + c.map(v => Math.round(v)).join(',') + ')';

  /* Relative luminance, so a tile's ink is chosen against the tile rather than against the page.
     Both ends of a sequential ramp end up on a tile, and one ink cannot serve both. */
  function luminance(rgb) {
    const c = rgb.map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /**
   * The domain a metric is drawn on at the moment: the wider daily one where the mark is a day,
   * the seasonal one where a tile covers three months, the monthly one otherwise.
   *
   * One function rather than the same condition repeated at each call site, because the scale bar
   * has to be drawn on exactly the domain the marks beside it are coloured by. A legend on one
   * domain over a grid on another misstates every colour it claims to explain.
   */
  function activeDomain(metric, which) {
    if (which === 'day') return metric.day_domain;
    /* The margin's sparkline is twelve months whatever the grid beside it is drawn at, so it asks
       for the monthly domain by name. Colouring months on the season or year domain put every one
       of them at the low end of a ramp built for spans three and twelve times as long. */
    if (which === 'monthly') return metric.domain;
    if (state.scale === 'season' && metric.season_domain) return metric.season_domain;
    if (state.scale === 'year' && metric.year_domain) return metric.year_domain;
    return metric.domain;
  }

  /** Whether the grid's marks are days or spans, which is what selects the domain they read. */
  const gridMark = () => (state.grid === 'day' ? 'day' : 'month');

  /**
   * The colour of one value on one metric's scale, as [rgb, inkClass].
   * `which` selects the monthly domain or the wider one the daily strips need.
   */
  function metricColor(metric, value, which) {
    if (!isNum(value)) return null;
    const domain = activeDomain(metric, which);
    if (metric.scale === 'div') {
      const center = metric.center === null ? 0 : metric.center;
      const absmax = Math.max(domain[1] - center, center - domain[0]) || 1;
      const t = (value - center) / absmax;
      const mid = hex2rgb(token('--neutral-mid'));
      const pole = hex2rgb(token(metric.poles[t >= 0 ? 1 : 0]));
      return rampRGB([mid, pole], Math.min(1, Math.abs(t)));
    }
    const stops = metric.stops.map(s => hex2rgb(token(s)));
    const t = (value - domain[0]) / ((domain[1] - domain[0]) || 1);
    return rampRGB(stops, t);
  }

  const inkClass = rgb => luminance(rgb) < 0.45 ? 'on-dark' : 'on-light';

