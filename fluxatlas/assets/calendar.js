/* ==============================================================================================
   fluxatlas - rendering engine
   ----------------------------------------------------------------------------------------------
   Three views over one payload: the grid of every month, one month with its days, and one day with
   its diurnal course. No external libraries - the page has to open from disk, so everything it
   needs travels inside it.

   The conventions are the dashboards' own, for the same reasons.
   - Colours come from CSS custom properties, never from literals here, so the light and the dark
     token sets are the only place a colour is decided and the toggle recolours every mark.
   - Every chart is re-rendered from its data on resize and on a theme change rather than scaled,
     so text stays one size at every viewport width.
   - A tooltip enhances a mark, it never gates a value: the month view carries the same numbers as
     a table.

   One addition of its own: the colour domains are computed in Python and shipped, so the scale bar,
   the tiles and the micro-strips inside them all read one scale, and hiding part of the grid with a
   badge filter does not repaint the months that remain.
   ============================================================================================== */

(function () {
  'use strict';

  const DATA = JSON.parse(document.getElementById('payload').textContent);
  const M = DATA.meta;
  const VARS = {};
  DATA.variables.forEach(v => { VARS[v.key] = v; });
  const METRICS = {};
  DATA.metrics.forEach(m => { METRICS[m.key] = m; });
  const BADGES = {};
  DATA.badges.forEach(b => { BADGES[b.key] = b; });
  const FLAGS = DATA.flags;
  /* The columns that are formulae over the file's own columns rather than columns of it - net
     radiation from its four components, where the file publishes no sum. Said where a figure's
     source is named, since "read from" a formula is not what happened. */
  const DERIVED_COLUMNS = new Set(DATA.variables.filter(v => v.derived).map(v => v.column));
  const sourceOf = v => (v.derived
    ? "Computed from the file's own columns: <code>"
      + esc(v.column.replace(/^computed:\s*/, '')) + '</code>'
    : 'Read from <code>' + esc(v.column) + '</code>');
  const MONTHS = DATA.months;
  const SEASONS = DATA.seasons;
  const YEAR_ROWS = DATA.years;
  const SEASON_DEFS = DATA.season_defs;
  const DAYS = DATA.days;
  const NORM = DATA.normals;
  const CLIM = DATA.climatology;
  const HOURLY = DATA.hourly;

  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
    'Sunday'];
  // A season is as many months as the caller defined it as, and the page writes small numbers out.
  const NUMBER_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve'];

  /* Which day tests are worth a mark on a day cell, in the order a cell fills its three slots.
     The frequent ones (a summer day, a wet day) are left out: a mark that is on half the cells of
     a July separates nothing, and a wet day already has its own bar along the bottom. Records come
     first because they are the rarest thing a day can be. */
  const DAY_MARKS = [
    ['recwarm', { icon: 'star', tone: 'warm', label: 'warmest for its date' }],
    ['reccold', { icon: 'star', tone: 'cold', label: 'coldest for its date' }],
    ['recwet', { icon: 'star', tone: 'wet', label: 'wettest for its date' }],
    ['verywet', { icon: 'cloud-rain', tone: 'wet', label: 'above 30 mm' }],
    ['hot', { icon: 'flame', tone: 'warm', label: 'hot day' }],
    ['ice', { icon: 'icicles', tone: 'cold', label: 'ice day' }],
    ['tropical', { icon: 'moon', tone: 'warm', label: 'tropical night' }],
    ['heavy', { icon: 'cloud-rain', tone: 'wet', label: 'above 10 mm' }],
    ['coldprec', { icon: 'snow-cloud', tone: 'cold', label: 'precipitation below 1 °C' }],
    ['frost', { icon: 'snowflake', tone: 'cold', label: 'frost day' }],
    ['freezethaw', { icon: 'thermo-swing', tone: 'cold', label: 'crossed freezing' }],
    ['clear', { icon: 'sun', tone: 'sun', label: 'in the brightest tenth for its date' }],
    ['saturated', { icon: 'fog', tone: 'dull', label: 'mean humidity above 95 %' }]
  ];

  /* ------------------------------------------------------------------------------------------
     Icons
     ------------------------------------------------------------------------------------------
     Drawn rather than fetched, and named by the badge registry in Python, which asserts that every
     badge's icon exists here - a badge whose icon is missing would render as an empty box.
     Keep the four-space indentation of the keys: the build reads them from this file.
     ------------------------------------------------------------------------------------------ */

  const ICONS = {
    'flame': '<path d="M12 3c3.2 4 5 5.8 5 8.9A5 5 0 0 1 7 12c0-1.7.6-3 1.6-4.2C9.6 9.3 11.2 6.2 12 3z"/>',
    'flames': '<path d="M9.5 3c2.4 3 3.8 4.4 3.8 6.7a3.8 3.8 0 0 1-7.6 0c0-1.3.5-2.3 1.2-3.2.8 1.1 2 .4 2.6-3.5z"/><path d="M17 10.5c1.4 1.9 2.3 2.6 2.3 4a2.3 2.3 0 0 1-4.6 0c0-.8.3-1.4.7-1.9.5.7 1.2.2 1.6-2.1z"/>',
    'snowflake': '<path d="M12 2v20M4.2 7l15.6 10M19.8 7L4.2 17M12 6l-2.4-2.4M12 6l2.4-2.4M12 18l-2.4 2.4M12 18l2.4 2.4"/>',
    'icicles': '<path d="M3 5h18M7 5v5l1.4 4.5L9.8 10V5M14 5v7l1.4 5 1.4-5V5"/>',
    'moon': '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    'droplets': '<path d="M8.4 2.5s3.9 4.2 3.9 6.5a3.9 3.9 0 1 1-7.8 0c0-2.3 3.9-6.5 3.9-6.5z"/><path d="M16.2 11.2s3.2 3.5 3.2 5.4a3.2 3.2 0 1 1-6.4 0c0-1.9 3.2-5.4 3.2-5.4z"/>',
    'droplet-off': '<path d="M12 3.2s5.2 5.6 5.2 8.8a5.2 5.2 0 0 1-10.4 0C6.8 8.8 12 3.2 12 3.2z"/><path d="M3.5 3.5l17 17"/>',
    'cloud-rain': '<path d="M17.5 16H9a6 6 0 1 1 5.7-7.8h2.8a4 4 0 1 1 0 7.8z"/><path d="M8.5 19v2.5M12 19v3M15.5 19v2.5"/>',
    'calendar-dry': '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18M8.5 15.5h7"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>',
    'cloud': '<path d="M17.5 19H9a6.5 6.5 0 1 1 6.2-8.5h2.3a4.25 4.25 0 1 1 0 8.5z"/>',
    'gauge': '<path d="M3.6 18.5a10 10 0 1 1 16.8 0"/><path d="M12 14.5l4.2-4.7"/><circle cx="12" cy="15.5" r="1.6"/>',
    'soil': '<path d="M3.5 11h17v9.5h-17z"/><path d="M12 11V6.5"/><path d="M12 8.5c-2.2 0-3.4-1.2-3.4-3 1.9 0 3.4 1.2 3.4 3zM12 8.5c2.2 0 3.4-1.2 3.4-3-1.9 0-3.4 1.2-3.4 3z"/>',
    'award': '<circle cx="12" cy="8.5" r="5.6"/><path d="M15.4 13.4 17 22l-5-2.9L7 22l1.6-8.6"/>',
    'arrow-up': '<path d="M12 20V4M5 11l7-7 7 7"/>',
    'arrow-down': '<path d="M12 4v16M19 13l-7 7-7-7"/>',
    'alert': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 17.4h.01"/>',
    'sprout': '<path d="M7 20.5h10"/><path d="M12 20.5c0-5 0-7 0-9"/><path d="M12 11.5c-2.6 0-4.2-1.4-4.8-4.2 2.8-.3 4.6.9 4.8 4.2zM12 11.5c2.6 0 4.2-1.9 4.8-5.2-2.8.3-4.6 1.9-4.8 5.2z"/>',
    'leaf-fall': '<path d="M11.5 19.5A6.5 6.5 0 0 1 10.4 6.6C15.7 5.5 17.1 5 19 2.7c.9 1.9 1.8 3.9 1.8 7.4 0 5.1-4.4 9.4-9.3 9.4z"/><path d="M2.5 21.5c0-2.8 1.7-5 4.7-5.6 2.2-.4 4.5-1.9 5.4-2.9"/>',
    'star': '<path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9z"/>',
    'snow-cloud': '<path d="M17.5 15.5H9a6 6 0 1 1 5.7-7.8h2.8a4 4 0 1 1 0 7.8z"/><path d="M8.5 18.5v2.4M7.3 19.1l2.4 1.2M9.7 19.1l-2.4 1.2M15.5 18.5v2.4M14.3 19.1l2.4 1.2M16.7 19.1l-2.4 1.2"/>',
    'thermo-swing': '<path d="M12 3.2v17.6"/><path d="m7.5 7.7 4.5-4.5 4.5 4.5"/><path d="m7.5 16.3 4.5 4.5 4.5-4.5"/>',
    'fog': '<path d="M3 7.5h18M6 11.5h13M3.5 15.5h14M8 19.5h11"/>',
    'gauge-low': '<path d="M3.6 18.5a10 10 0 1 1 16.8 0"/><path d="M12 14.5 7.9 9.7"/><circle cx="12" cy="15.5" r="1.6"/>',
    'evaporation': '<path d="M2.8 20.5h18.4"/><path d="M7 17V8.5M7 8.5 5.2 10.6M7 8.5l1.8 2.1M12 17V4.6M12 4.6l-1.8 2.1M12 4.6l1.8 2.1M17 17V9.8M17 9.8l-1.8 2.1M17 9.8l1.8 2.1"/>',
    'droplet-low': '<path d="M12 3.1s5.3 5.7 5.3 8.9a5.3 5.3 0 0 1-10.6 0C6.7 8.8 12 3.1 12 3.1z"/><path d="M7.1 14.6h9.8"/>',
    'drought': '<circle cx="12" cy="6.4" r="3.1"/><path d="M12 1.3v1.3M7.6 6.4H6.3M17.7 6.4h-1.3M8.9 3.3 8 2.4M15.1 3.3l.9-.9"/><path d="M2.6 14.5h18.8"/><path d="M8.2 14.5v6.9M8.2 17.4l-2.3 1.5M15.8 14.5v6.9M15.8 18.1l2.3 1.3"/>'
  };

  function glyph(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (ICONS[name] || '') + '</svg>';
  }

  /** A badge as a solid chip: the family in the background, the badge in the symbol. */
  function chip(key, size) {
    const b = BADGES[key];
    if (!b) return '';
    return '<span class="chip chip-' + b.tone + (size ? ' ' + size : '') + '" role="img" '
      + 'aria-label="' + b.label + '">' + glyph(b.icon) + '</span>';
  }

  /** The same chip for a day mark, which has no badge entry of its own. */
  function markChip(mark, size) {
    return '<span class="chip chip-' + mark.tone + (size ? ' ' + size : '') + '" role="img" '
      + 'aria-label="' + mark.label + '">' + glyph(mark.icon) + '</span>';
  }

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

  /* ------------------------------------------------------------------------------------------
     Scales, ticks, SVG
     ------------------------------------------------------------------------------------------ */

  function linear(d0, d1, r0, r1) {
    const span = (d1 - d0) || 1;
    const f = v => r0 + (v - d0) / span * (r1 - r0);
    f.domain = [d0, d1];
    f.range = [r0, r1];
    return f;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(10));
    }
    return out;
  }

  function extent(arrays) {
    let lo = Infinity, hi = -Infinity;
    // A series may legitimately be absent (a normal that does not exist at this scale), and an
    // absent series is not an empty one: it simply does not take part in the extent.
    arrays.filter(Boolean).forEach(a => a.forEach(v => {
      if (!isNum(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }));
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    return [lo, hi];
  }

  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function svgText(parent, x, y, str, cls, extra) {
    const t = el('text', Object.assign({ x: x, y: y, class: cls || 'ax-text' }, extra || {}), parent);
    t.textContent = str;
    return t;
  }

  /* The width a set of labels needs, measured rather than estimated from character counts: the
     same eleven characters are a different width in "Sensible heat" and "Wm-2 mean". Measured off
     a hidden node so nothing has to be drawn twice to find out. */
  function textWidth(strings, cls) {
    const probe = el('svg', { width: 0, height: 0 });
    probe.setAttribute('style', 'position:absolute;visibility:hidden;pointer-events:none');
    document.body.appendChild(probe);
    let widest = 0;
    strings.forEach(s => {
      widest = Math.max(widest, svgText(probe, 0, 0, s, cls).getComputedTextLength());
    });
    probe.remove();
    return Math.ceil(widest);
  }

  /* Trim a label that still does not fit, and keep the whole of it in the tooltip. A name running
     off the edge of the card reads as a broken chart; a trimmed one reads as a trimmed one. */
  function trimText(node, limit, full) {
    if (!node.getComputedTextLength || node.getComputedTextLength() <= limit) return node;
    let text = full;
    while (text.length > 1 && node.getComputedTextLength() > limit) {
      text = text.slice(0, -1);
      node.textContent = text.replace(/[\s.]+$/, '') + '…';
    }
    el('title', {}, node).textContent = full;
    return node;
  }

  function pathFrom(xs, ys, sx, sy) {
    let d = '', pen = false;
    for (let i = 0; i < xs.length; i++) {
      if (!isNum(ys[i])) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + sx(xs[i]).toFixed(2) + ' ' + sy(ys[i]).toFixed(2);
      pen = true;
    }
    return d;
  }

  function areaFrom(xs, lo, hi, sx, sy) {
    const up = [], down = [];
    for (let i = 0; i < xs.length; i++) {
      if (!isNum(lo[i]) || !isNum(hi[i])) continue;
      up.push(sx(xs[i]).toFixed(2) + ' ' + sy(hi[i]).toFixed(2));
      down.unshift(sx(xs[i]).toFixed(2) + ' ' + sy(lo[i]).toFixed(2));
    }
    return up.length ? 'M' + up.join('L') + 'L' + down.join('L') + 'Z' : '';
  }

  /* ------------------------------------------------------------------------------------------
     Tooltip
     ------------------------------------------------------------------------------------------ */

  const tipNode = document.getElementById('tooltip');
  const tip = {
    show(html, x, y) {
      tipNode.innerHTML = html;
      tipNode.classList.add('on');
      const box = tipNode.getBoundingClientRect();
      const left = Math.max(8 + box.width / 2, Math.min(window.innerWidth - 8 - box.width / 2, x));
      const top = y - 12 < box.height + 8 ? y + box.height + 24 : y - 12;
      tipNode.style.left = left + 'px';
      tipNode.style.top = top + 'px';
    },
    hide() { tipNode.classList.remove('on'); }
  };

  function tipRows(title, rows) {
    let html = '<div class="tt-title">' + title + '</div>';
    rows.forEach(r => {
      if (r.rule) { html += '<div class="tt-row"><span class="k">' + r.k + '</span></div>'; return; }
      html += '<div class="tt-row">'
        + (r.color ? '<span class="sw" style="background:' + r.color + '"></span>' : '')
        + '<span class="k">' + r.k + '</span><span class="v">' + r.v + '</span></div>';
    });
    return html;
  }

  /* ------------------------------------------------------------------------------------------
     Chart frame
     ------------------------------------------------------------------------------------------ */

  function frame(host, spec) {
    const p = palette();
    const width = Math.max(260, host.clientWidth || 640);
    const height = spec.height
      || Math.round(Math.max(170, Math.min(400, width * (spec.aspect || 0.42))));
    const m = Object.assign({ top: 12, right: 14, bottom: 30, left: 46 }, spec.margin || {});
    // Room `drawAxes` found missing on an earlier pass for the y labels and their title.
    m.left += host.axisPad || 0;
    const svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height, width: width, height: height,
      role: 'img', 'aria-label': spec.ariaLabel || ''
    });
    host.innerHTML = '';
    host.appendChild(svg);
    return { svg: svg, p: p, width: width, height: height, m: m,
      iw: width - m.left - m.right, ih: height - m.top - m.bottom };
  }

  /** The fewest decimals, up to `most`, that state every tick exactly: 1500 rather than 1500.00. */
  function tickDigits(ticks, most) {
    for (let d = 0; d < most; d++) {
      const k = Math.pow(10, d);
      if (ticks.every(v => Math.abs(Math.round(v * k) - v * k) < 1e-6 * k)) return d;
    }
    return most;
  }

  function drawAxes(f, sx, sy, spec) {
    const { svg, m, iw, ih } = f;
    const g = el('g', {}, svg);
    const yTicks = spec.yTicks || niceTicks(sy.domain[0], sy.domain[1], spec.yTickCount || 4);
    const digits = tickDigits(yTicks, spec.yDigits === undefined ? 0 : spec.yDigits);
    let widest = 0;
    yTicks.forEach(v => {
      const y = sy(v);
      if (y < m.top - 1 || y > m.top + ih + 1) return;
      el('line', { x1: m.left, x2: m.left + iw, y1: y, y2: y, class: 'gridline' }, g);
      const t = svgText(g, m.left - 8, y + 4, nf(v, digits), 'ax-text', { 'text-anchor': 'end' });
      widest = Math.max(widest, t.getComputedTextLength ? t.getComputedTextLength() : 0);
    });
    el('line', { x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih, class: 'ax-line' }, g);
    let lastRight = -Infinity;
    (spec.xTicks || []).forEach(t => {
      const x = sx(t.v);
      if (x < m.left - 1 || x > m.left + iw + 1) return;
      el('line', { x1: x, x2: x, y1: m.top + ih, y2: m.top + ih + 4, class: 'ax-line' }, g);
      const label = svgText(g, x, m.top + ih + 16, t.label, 'ax-text', { 'text-anchor': 'middle' });
      /* A label centred on a tick at either end of the axis would reach into the y labels or past
         the edge of the chart; it is anchored at its tick instead. */
      const w = label.getComputedTextLength ? label.getComputedTextLength() : 0;
      let x0 = x - w / 2;
      if (x0 < m.left - 4) { label.setAttribute('text-anchor', 'start'); x0 = x; }
      else if (x + w / 2 > f.width - 2) { label.setAttribute('text-anchor', 'end'); x0 = x - w; }
      // On a narrow chart the labels thin out rather than run into each other; the ticks stay.
      if (x0 < lastRight + 4) { label.remove(); return; }
      lastRight = x0 + w;
    });
    if (spec.yLabel) {
      /* The title stands beside the widest tick label, not at a fixed offset that a label such as
         "-1500" reaches past. Where the margin has no room for both, the chart is drawn again with
         the room added (`frame` reads `axisPad`), once, by `mountChart`. */
      // Turned on its side, the title reaches about 13 px left of its baseline and 3 px right.
      const ascent = 13, descent = 3, gap = 5;
      const x = Math.min(m.left - 32, m.left - 8 - widest - gap - descent);
      if (x < ascent + 1 && svg.parentNode) {
        const host = svg.parentNode;
        host.axisPad = (host.axisPad || 0) + Math.ceil(ascent + 1 - x);
        host.axisRedraw = true;
      }
      const t = svgText(g, 0, 0, spec.yLabel, 'ax-title', { 'text-anchor': 'middle' });
      t.setAttribute('transform', 'translate(' + Math.max(ascent + 1, x) + ','
        + (m.top + ih / 2) + ') rotate(-90)');
    }
    return g;
  }

  /* Charts redraw from their data on a resize and on a theme change rather than being scaled, so
     text stays one size at every width. A chart whose host has left the document - the month view
     is rebuilt whole - drops out of the registry instead of being redrawn into nothing. */
  let charts = [];

  function mountChart(host, draw) {
    charts.push({ host: host, draw: draw });
    let last = 0;
    const drawn = () => {
      draw(host);
      // The axis asked for more room for its labels: draw once more with it.
      if (host.axisRedraw) { host.axisRedraw = false; draw(host); host.axisRedraw = false; }
    };
    new ResizeObserver(() => {
      if (!host.isConnected || host.hidden) return;
      if (Math.abs(host.clientWidth - last) > 6) { last = host.clientWidth; drawn(); }
    }).observe(host);
    drawn();
  }

  function compactCharts() { charts = charts.filter(c => c.host.isConnected); }
  function redrawAll() {
    compactCharts();
    charts.forEach(c => c.draw(c.host));
  }

  /* ------------------------------------------------------------------------------------------
     Cards
     ------------------------------------------------------------------------------------------ */

  function cardEl(parent, def) {
    const node = document.createElement('section');
    node.className = 'card ' + (def.width || 'w-6');
    node.innerHTML = '<div class="card-head"><div><h3 class="card-title">' + def.title + '</h3>'
      + (def.sub ? '<p class="card-sub">' + def.sub + '</p>' : '') + '</div></div>'
      + '<div class="card-body"></div>'
      + (def.foot ? '<p class="card-foot">' + def.foot + '</p>' : '');
    parent.appendChild(node);
    return node.querySelector('.card-body');
  }

  function legendHTML(items) {
    return '<div class="legend">' + items.map(i =>
      '<span class="legend-item"><span class="legend-swatch ' + (i.line ? 'line' : '')
      + '" style="background:' + i.color + '"></span>' + i.label + '</span>').join('') + '</div>';
  }

  function chartCard(parent, def) {
    const body = cardEl(parent, def);
    const host = document.createElement('div');
    host.className = 'chart';
    body.appendChild(host);
    if (def.legend) body.insertAdjacentHTML('beforeend', legendHTML(def.legend));
    mountChart(host, def.draw);
    return body;
  }

  function tableHTML(columns, rows) {
    let html = '<div class="tablewrap"><table><thead><tr>';
    columns.forEach(c => { html += '<th>' + c + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => {
        if (cell && typeof cell === 'object') {
          html += '<td class="' + (cell.cls || '') + '">' + cell.v + '</td>';
        } else {
          html += '<td>' + (cell === null || cell === undefined ? '–' : cell) + '</td>';
        }
      });
      html += '</tr>';
    });
    return html + '</tbody></table></div>';
  }

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
    const rows = keys.map(k => {
      const c = cols[k] || {};
      return [esc(VARS[k] ? VARS[k].short : k),
        '<code>' + esc(c.column) + '</code>',
        c.qc ? '<code>' + esc(c.qc) + '</code>' : '<span class="muted">none</span>',
        esc(fmtFactor(c.factor))];
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
    host.hidden = false;
    host.innerHTML = '<details><summary>Columns read from the file</summary>'
      + '<p>For each variable: the column read, the quality flag that separates measured from '
      + 'gap-filled records, and the factor converting the column to the unit shown on this page.'
      + (facts.length ? ' Build settings: ' + facts.join(', ') + '.' : '') + '</p>'
      + tableHTML(['Variable', 'Column', 'Quality flag', 'Factor'], rows)
      + '</details>';
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
    rec.f.forEach((p, i) => {
      if (p > 0 && v.fill.levels[i]) {
        text += ', ' + nf(p, 0) + ' % ' + (nee ? 'from its ' : '') + v.fill.levels[i];
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
          rows.push({ k: nee ? nee + ' ' + label : cap(label), v: nf(fills[i][j] || 0, 0) + ' %',
            color: fillSwatch(j) });
        });
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
      draw: drawCumulative(v.key, focus, onPanel)
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

  function renderVariable() {
    const key = state.variable;
    const v = VARS[key];
    const met = ownMetric(v);
    const host = document.getElementById('var-body');
    compactCharts();
    document.getElementById('var-title').textContent = v.title;

    const list = DATA.variables.map(x => x.key);
    const idx = list.indexOf(key);
    document.getElementById('var-prev').disabled = idx <= 0;
    document.getElementById('var-next').disabled = idx >= list.length - 1;

    host.innerHTML = '<p class="monthlede" id="var-lede"></p>'
      + '<div class="grid" id="var-summary"></div>'
      + '<h2 class="section">Annual values and annual cycle</h2>'
      + '<div class="grid" id="var-record"></div>'
      // Each of these is filled by one part of the page below, and stays empty - no heading, no
      // space - where the build carries nothing for it, so a page without them reads as before.
      + '<div id="var-season"></div><div id="var-thresholds"></div>'
      + '<h2 class="section">Monthly trends and extremes</h2>'
      + '<div class="grid" id="var-months"></div>'
      + (hasDaily(v) ? '<h2 class="section">Daily series</h2>'
        + '<div class="grid" id="var-daily"></div>' : '')
      + '<div id="var-extremes"></div><div id="var-diurnal"></div>'
      + '<h2 class="section">Coverage</h2><div class="grid" id="var-cov"></div>'
      + '<div id="var-hourly"></div>';

    document.getElementById('var-lede').innerHTML = v.about
      + ' ' + sourceOf(v) + ', ' + v.first_year + '–' + v.last_year + '.';

    cardEl(document.getElementById('var-summary'), {
      title: 'Summary, ' + M.first_year + '–' + M.last_year, width: 'w-12',
      sub: 'The figures shown on the grid. Each span is stated as its '
        + (v.agg === 'sum' ? 'total' : 'mean') + '.'
    }).innerHTML = varSummary(key);

    const rec = document.getElementById('var-record');
    const band = yearBand(key);
    chartCard(rec, {
      title: 'Annual values', width: 'w-7',
      sub: 'One point per year' + (met && met.trend_year && met.trend_year.fit
        ? ', with the published Theil-Sen trend line' : '')
        + '. Select a year to open it.',
      legend: [{ color: 'var(--series-1)', label: 'annual value', line: true }]
        .concat(band ? [{ color: 'var(--band-outer)', label: band.label }] : [])
        .concat([{ color: 'var(--text-primary)', label: 'Theil-Sen trend', line: true }]),
      foot: [band ? band.note : '', met && met.trend_year ? trendSentence(met, met.trend_year) : '']
        .filter(Boolean).join(' '),
      draw: drawVarYears(key)
    });
    chartCard(rec, {
      title: 'Mean annual cycle', width: 'w-5',
      sub: 'Normal of each calendar month, ±1 standard deviation, and the full range over the '
        + 'record.',
      legend: [{ color: 'var(--series-1)', label: 'normal', line: true },
        { color: 'var(--band-outer)', label: 'range across the record' }],
      draw: drawVarCycle(key)
    });
    // A total is read as it builds up through the year as well as by what it came to.
    if (hasCumulative(v)) cumulativeCard(rec, v, YEARS[YEARS.length - 1], false);

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

    if (hasDaily(v)) {
      const daily = document.getElementById('var-daily');
      chartCard(daily, {
        title: 'Daily values by day of year', width: 'w-6',
        sub: 'One faint line per year on a day-of-year axis, over the ±' + M.clim_window
          + ' day normal band for each date.',
        legend: [
          { color: 'var(--band-outer)', label: 'normal 10th–90th percentile' },
          { color: 'var(--series-1)', label: 'one year', line: true },
          { color: 'var(--text-primary)', label: 'normal for the date', line: true }
        ],
        foot: 'Plotted by day of year, so the spread between years at each date is visible.',
        draw: drawVarDailyCycle(key)
      });
      chartCard(daily, {
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
        draw: drawVarDailyDeparture(key)
      });
    }

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
    chartCard(document.getElementById('var-cov'), {
      title: nee ? 'Coverage and share partitioned from measured net exchange, by year'
        : v.partitioned ? 'Coverage by year'
          : 'Coverage and measured share by year',
      width: 'w-12',
      sub: covSub,
      legend: covLegend,
      foot: 'Every statistic on this page is gated on availability; the measured share only '
        + 'raises a warning. Where the measured share itself trends through the record, part of '
        + 'a slope above may follow that trend rather than a change in the ecosystem.',
      draw: drawVarCoverage(key)
    });

    renderVarSeason(key);
    renderVarThresholds(key);
    renderVarExtremes(key);
    renderVarDiurnal(key);
    renderVarHourly(key);
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
    if (d === 0) return ', ' + (name === 'start' || name === 'end' ? 'the usual date' : 'as usual');
    return ', ' + Math.abs(d) + ' ' + unit + (Math.abs(d) === 1 ? '' : 's') + ' '
      + (d < 0 ? words[0] : words[1]) + ' than usual';
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

      // The record medians, which are the dates the season badges call usual. Each label reads
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
      const width = Math.max(260, host.clientWidth || 640);
      const left = textWidth(rows.map(r => r.label), 'ax-text') + 12;
      const m = { top: 6, right: 14, bottom: 62, left: left };
      const cw = (width - m.left - m.right) / 24;
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
      [0, 3, 6, 9, 12, 15, 18, 21, 24].forEach(h => {
        const x = m.left + h * cw;
        el('line', { x1: x, x2: x, y1: base, y2: base + 4, class: 'ax-line' }, f.svg);
        if (h % 6 === 0) {
          svgText(f.svg, x, base + 16, String(h).padStart(2, '0') + ':00', 'ax-text',
            { 'text-anchor': 'middle' });
        }
      });

      // The key: the ramp from one end of the scale to the other, with its ends and its centre.
      const c = spec.colour;
      const kw = Math.min(260, 24 * cw), kx = m.left, ky = base + 28, steps = 48;
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
      const hit = el('rect', { class: 'hit', x: m.left, y: m.top, width: 24 * cw,
        height: rh * rows.length }, f.svg);
      hit.addEventListener('mousemove', ev => {
        const box = f.svg.getBoundingClientRect();
        const k = f.width / box.width;
        const r = clampIndex(((ev.clientY - box.top) * k - m.top) / rh, rows.length);
        const h = clampIndex(((ev.clientX - box.left) * k - m.left) / cw, 24);
        mark.setAttribute('x', m.left + h * cw);
        mark.setAttribute('y', m.top + r * rh);
        mark.setAttribute('opacity', 1);
        tip.show(spec.tip(r, h), ev.clientX, ev.clientY);
      });
      hit.addEventListener('mouseleave', () => { mark.setAttribute('opacity', 0); tip.hide(); });
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
      draw: drawVarSurface(key)
    });

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

  /* ------------------------------------------------------------------------------------------
     Routing
     ------------------------------------------------------------------------------------------ */

  function showView(which) {
    document.getElementById('view-grid').hidden = which !== 'grid';
    document.getElementById('view-month').hidden = which !== 'month';
    document.getElementById('view-var').hidden = which !== 'var';
    const crumbs = document.getElementById('crumbs');
    /* The site rides with the span here, since the topbar itself now carries the product name and
       the hero scrolls out of sight. */
    const site = '<span class="site">' + esc(M.site) + '</span><span class="sep">·</span>';
    if (which === 'grid') {
      crumbs.innerHTML = site + '<b>' + M.first_year + '–' + M.last_year + '</b>';
    } else if (which === 'var') {
      crumbs.innerHTML = site + '<span>' + M.first_year + '–' + M.last_year + '</span>'
        + '<span class="sep">›</span><b>' + VARS[state.variable].short + '</b>';
    } else {
      crumbs.innerHTML = site + '<span>' + M.first_year + '–' + M.last_year + '</span>'
        + '<span class="sep">›</span><b>' + scale().title(state.span) + '</b>'
        + (state.d ? '<span class="sep">›</span><b>' + state.d + '</b>' : '');
    }
  }

  /* A span is addressed by year and by what it is within that year: #2019-07 is a month, #2019-JJA
     a season, #2019-YEAR the year itself, #2019-07-25 a day. The scale follows from which of the
     three the URL carries, so a link into a season switches the grid behind it as well.

     The season key is whatever the scheme named it, which is two to six letters for a derived
     scheme (`JF`, `DJFMAM`) and a capitalised abbreviation for a scheme of single months (`Mar`).
     Matching only three upper-case letters, as this did, sent every one of those back to the grid. */
  function route() {
    // The echo of the page's own rewrite of the address: everything it names is already drawn.
    if (echo !== null && location.hash.replace(/^#/, '') === echo) {
      echo = null;
      return;
    }
    echo = null;
    const addr = readAddress();
    const hash = addr.route;
    // The choices first, so whichever view is drawn below is drawn once and in them. The grid
    // is redrawn behind a span or a variable page as well, since that is where Back returns to.
    let regrid = applyAddress(addr);

    /* One variable across the whole record is a page rather than a span, so it is addressed by
       name: #var-TA. It carries no year, which is what distinguishes it from every other route. */
    const asVar = /^var-([A-Za-z0-9_.]+)$/.exec(hash);
    if (asVar && VARS[asVar[1]]) {
      if (regrid) renderGrid();
      state.variable = asVar[1];
      state.y = state.m = state.d = state.span = null;
      showView('var');
      tip.hide();
      renderVariable();
      window.scrollTo({ top: 0 });
      syncAddress();
      return;
    }

    const m = /^(\d{4})-(\d{2}|[A-Za-z]{2,6})(?:-(\d{2}))?$/.exec(hash);
    const wanted = routeScale(hash);
    const span = m ? SCALES[wanted].at(+m[1], /^\d+$/.test(m[2]) ? +m[2] : m[2]) : null;
    if (!span) {
      if (regrid) renderGrid();
      state.y = state.m = state.d = state.span = null;
      showView('grid');
      tip.hide();
      window.scrollTo({ top: 0 });
      syncAddress();
      return;
    }
    // A redrawn grid, or a metric that moved, is a different panel even for the same span.
    const same = state.span === span && !regrid;
    if (state.scale !== wanted) {
      state.scale = wanted;
      // A reader who opened this day out of the raster gets the raster back when they leave the
      // month, so the grid only follows the span scale where it was already showing spans.
      if (state.grid !== 'day') setGrid(wanted);
      regrid = true;
    }
    if (regrid) renderGrid();
    state.y = +m[1];
    state.m = span.m || null;
    state.span = span;
    state.d = (m[3] && wanted === 'month') ? +m[3] : null;
    // The raster's cursor follows whatever day the reader opened, from wherever they opened it, so
    // going back leaves them where they were rather than at the start of the record.
    if (state.d) state.cursor = span.i0 + state.d - 1;
    showView('month');
    tip.hide();
    if (same && state.d) {
      renderDay();
      const panel = document.getElementById('day-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      renderMonth();
      window.scrollTo({ top: 0 });
    }
    syncAddress();
  }

  function setupNav() {
    document.getElementById('month-back').addEventListener('click', () => {
      location.hash = 'grid';
    });
    document.getElementById('var-back').addEventListener('click', () => {
      location.hash = 'grid';
    });
    const varStep = delta => {
      const list = DATA.variables.map(v => v.key);
      const target = list[list.indexOf(state.variable) + delta];
      if (target) location.hash = 'var-' + target;
    };
    document.getElementById('var-prev').addEventListener('click', () => varStep(-1));
    document.getElementById('var-next').addEventListener('click', () => varStep(1));
    const step = delta => {
      const list = scale().spans();
      const target = list[list.indexOf(state.span) + delta];
      if (target) location.hash = target.y + '-' + scale().slug(target);
    };
    document.getElementById('month-prev').addEventListener('click', () => step(-1));
    document.getElementById('month-next').addEventListener('click', () => step(1));
    const yearStep = () => (state.scale === 'season' ? SEASON_DEFS.length
      : state.scale === 'year' ? 1 : 12);
    document.getElementById('year-prev').addEventListener('click', () => step(-yearStep()));
    document.getElementById('year-next').addEventListener('click', () => step(yearStep()));

    /* Arrow keys walk the grid, Enter opens a month, Escape goes back. A tile is a button, so the
       browser already gives it focus; the arrows only have to move that focus. */
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && state.y) { location.hash = 'grid'; return; }
      if (state.y && !document.getElementById('view-month').hidden) {
        if (ev.key === 'ArrowLeft') { step(-1); }
        if (ev.key === 'ArrowRight') { step(1); }
        return;
      }
      const active = document.activeElement;
      if (!active || !active.classList.contains('cell')) return;
      const cols = scale().cols();
      let ty = +active.dataset.y;
      let ci = cols.findIndex(c => String(c.id) === active.dataset.c);
      if (ev.key === 'ArrowLeft') ci -= 1;
      else if (ev.key === 'ArrowRight') ci += 1;
      else if (ev.key === 'ArrowUp') ty -= 1;
      else if (ev.key === 'ArrowDown') ty += 1;
      else return;
      if (ci < 0) { ci = cols.length - 1; ty -= 1; }
      if (ci >= cols.length) { ci = 0; ty += 1; }
      const next = document.querySelector('.cell[data-y="' + ty + '"][data-c="'
        + cols[ci].id + '"]');
      if (next) { next.focus(); ev.preventDefault(); }
    });
  }

  function setupTheme() {
    const root = document.documentElement;
    const btn = document.getElementById('theme-toggle');
    const label = btn.querySelector('.theme-label');
    const stored = (() => {
      try { return localStorage.getItem('fluxatlas-theme'); } catch (e) { return null; }
    })();
    if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);
    const isDark = () => root.getAttribute('data-theme') === 'dark'
      || (root.getAttribute('data-theme') === 'auto'
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
    function sync() {
      label.textContent = isDark() ? 'Light mode' : 'Dark mode';
      btn.setAttribute('aria-label', 'Switch to ' + (isDark() ? 'light' : 'dark') + ' mode');
    }
    /* A theme change repaints every mark, including the charts of whichever view is not on screen
       and the ones the view being rebuilt does not own - the coverage chart sits on the grid view
       and is not touched by renderGrid. */
    /* The grid is repainted whichever view is showing, since its tiles carry their colours inline
       and Back returns to it; then the view on screen. A variable page is not a span, and
       repainting it as one - which this did whenever the grid was hidden - threw on the null span
       and left the page in the old colours. */
    function repaint() {
      sync();
      renderGrid();
      if (!document.getElementById('view-month').hidden && state.span) renderMonth();
      if (!document.getElementById('view-var').hidden && state.variable) renderVariable();
      redrawAll();
    }
    btn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('fluxatlas-theme', next); } catch (e) { /* private mode */ }
      repaint();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (root.getAttribute('data-theme') === 'auto') repaint();
    });
    sync();
  }

  /* ------------------------------------------------------------------------------------------
     Go
     ------------------------------------------------------------------------------------------ */

  /* The theme is settled before anything is drawn. Every mark takes its colour from a token read
     at render time, so a grid drawn while the page is still on `auto` and then switched to the
     stored theme keeps the colours of the wrong token set until something happens to redraw it.
     Nothing in setupTheme paints; it only resolves which set is in force. */
  setupTheme();
  measureTopbar();
  renderHero();
  /* A metric and a scale stated in the address are in force before anything is drawn, so a
     reloaded or shared link draws its grid once, in the choices it names. */
  (function () {
    const addr = readAddress();
    if (!addr.has) return;
    if (METRICS[addr.params.metric]) state.metric = addr.params.metric;
    const implied = routeScale(addr.route) || 'month';
    state.grid = gridOffered(addr.params.scale) ? addr.params.scale : implied;
    state.scale = state.grid !== 'day' ? state.grid : (routeScale(addr.route) || state.scale);
  })();
  buildControls();
  // The grid's classes, its label and the picker are set from one place, so the opening state
  // cannot differ from the state any later switch produces.
  setGrid(state.grid);
  renderBadgeLegend();
  renderVarIndex();
  renderAbout();
  renderGrid();
  setupNav();
  route();
  window.addEventListener('hashchange', route);

  /* The bar's height moves with the viewport - the breadcrumb wraps, the brand line reflows - and
     the sticky month header offsets by it, so it is remeasured with everything else. */
  new ResizeObserver(measureTopbar).observe(document.querySelector('.topbar'));

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      measureTopbar();
      redrawAll();
      renderScaleBar();
    }, 140);
  });
})();
