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
  const MONTHS = DATA.months;
  const SEASONS = DATA.seasons;
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
      .map(k => (VARS[k] ? VARS[k].short.toLowerCase() : k) + ' in ' + thin[k].n
        + ' of ' + thin[k].n_total + ' months, under ' + nf(thin[k].warn, 0) + ' %');
    if (!named.length) {
      return 'On this record no span falls under its warning line for measured share.';
    }
    return 'Hatched tiles are the spans that do: ' + named.join('; ')
      + '. Read a slope against how those are distributed through the record.';
  }
  /* A departure carries its sign, except where it rounds to nothing: "-0.0" states a direction the
     printed number does not support, and "+0.0" is the same error the other way. */
  const nfs = (v, d = 1) => {
    if (!isNum(v)) return '–';
    const s = v.toFixed(d);
    return +s === 0 ? Math.abs(+s).toFixed(d) : (v > 0 ? '+' : '') + s;
  };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
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
    return (state.scale === 'season' && metric.season_domain) ? metric.season_domain
      : metric.domain;
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
    const svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height, width: width, height: height,
      role: 'img', 'aria-label': spec.ariaLabel || ''
    });
    host.innerHTML = '';
    host.appendChild(svg);
    return { svg: svg, p: p, width: width, height: height, m: m,
      iw: width - m.left - m.right, ih: height - m.top - m.bottom };
  }

  function drawAxes(f, sx, sy, spec) {
    const { svg, m, iw, ih } = f;
    const g = el('g', {}, svg);
    const yTicks = spec.yTicks || niceTicks(sy.domain[0], sy.domain[1], spec.yTickCount || 4);
    yTicks.forEach(v => {
      const y = sy(v);
      if (y < m.top - 1 || y > m.top + ih + 1) return;
      el('line', { x1: m.left, x2: m.left + iw, y1: y, y2: y, class: 'gridline' }, g);
      svgText(g, m.left - 8, y + 4, nf(v, spec.yDigits === undefined ? 0 : spec.yDigits),
        'ax-text', { 'text-anchor': 'end' });
    });
    el('line', { x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih, class: 'ax-line' }, g);
    (spec.xTicks || []).forEach(t => {
      const x = sx(t.v);
      if (x < m.left - 1 || x > m.left + iw + 1) return;
      el('line', { x1: x, x2: x, y1: m.top + ih, y2: m.top + ih + 4, class: 'ax-line' }, g);
      svgText(g, x, m.top + ih + 16, t.label, 'ax-text', { 'text-anchor': 'middle' });
    });
    if (spec.yLabel) {
      const t = svgText(g, 0, 0, spec.yLabel, 'ax-title', { 'text-anchor': 'middle' });
      t.setAttribute('transform',
        'translate(' + (m.left - 33) + ',' + (m.top + ih / 2) + ') rotate(-90)');
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
    new ResizeObserver(() => {
      if (!host.isConnected || host.hidden) return;
      if (Math.abs(host.clientWidth - last) > 6) { last = host.clientWidth; draw(host); }
    }).observe(host);
    draw(host);
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

  /* The two scales differ in four things and nothing else: the list of spans, the columns of the
     grid, how a span is addressed in the URL, and what a span is called. Everything downstream
     reads these rather than asking which scale is active. */
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
    }
  };
  const scale = () => SCALES[state.scale];

  /** The season a month sits in, and the month's place within it. */
  function seasonOfMonth(mo) {
    const def = SEASON_DEFS.find(d => d.months.indexOf(mo.m) >= 0);
    if (!def) return null;
    // December belongs to the winter labelled by the following January.
    return seasonAt(mo.m === 12 ? mo.y + 1 : mo.y, def.key);
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
    cursor: null
  };
  const metric = () => METRICS[state.metric];

  /* ------------------------------------------------------------------------------------------
     Level 1: the grid
     ------------------------------------------------------------------------------------------ */

  function buildControls() {
    const host = document.getElementById('controls');
    /* Grouped rather than listed flat: sixteen metrics in one run have to be read end to end
       before a reader knows what the page can show them. */
    let html = '<div class="control"><label for="metric-pick">Colour the months by</label>'
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
      + 'Show each day inside the tile</label>'
      + '<label class="switch"><input type="checkbox" id="badge-toggle">'
      + 'Show every badge</label></div></div>'
      + '<div class="control"><label for="scale-pick">Scale</label>'
      + '<select class="picker narrow" id="scale-pick">'
      + '<option value="month">Months</option>'
      + (SEASON_DEFS.length
        ? '<option value="season">Seasons (' + SEASON_DEFS.map(d => d.key).join(', ') + ')</option>'
        : '')
      + '<option value="day">Days (every day of the record)</option></select></div>'
      + '<p class="control-note" id="metric-about"></p>';
    host.innerHTML = html;

    const pick = document.getElementById('metric-pick');
    pick.value = state.metric;
    pick.addEventListener('change', () => {
      state.metric = pick.value;
      renderGrid();
    });
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
    grid.classList.toggle('raster', which === 'day');
    grid.setAttribute('aria-label', which === 'day' ? 'Every day of the record'
      : which === 'season' ? 'Seasons of the record' : 'Months of the record');
    const detail = document.getElementById('detail-control');
    if (detail) detail.hidden = which === 'day';
    const pick = document.getElementById('scale-pick');
    if (pick && pick.value !== which) pick.value = which;
  }

  function cellTooltip(mo) {
    const rows = [];
    DATA.variables.forEach(v => {
      const rec = mo[v.key];
      if (!rec || !isNum(rec.v)) return;
      let line = nf(rec.v, v.digits) + ' ' + v.units;
      if (isNum(rec.a)) line += ' (' + nfs(rec.a, v.digits) + ')';
      rows.push({ k: v.short, v: line });
    });
    if (mo.c.hot || mo.c.frost || mo.c.wet) {
      rows.push({ k: 'Threshold days',
        v: [mo.c.hot ? mo.c.hot + ' hot' : null, mo.c.frost ? mo.c.frost + ' frost' : null,
          mo.c.wet ? mo.c.wet + ' wet' : null].filter(Boolean).join(', ') });
    }
    if (isNum(mo.x.nsd)) {
      rows.push({ k: 'Unusual axes', v: mo.x.nsd + ' of ' + mo.x.nz });
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
    renderScaleBar();
    renderGridNote();
  }

  function renderTileGrid() {
    const met = metric();
    const host = document.getElementById('calgrid');
    const parts = [];

    const sc = scale();
    const cols = sc.cols();
    parts.push('<div class="calhead corner">Year</div>');
    cols.forEach(c => parts.push('<div class="calhead">' + c.label + '</div>'));
    parts.push('<div class="calhead total">' + (summarises(met) ? 'Total' : 'Mean') + '</div>');

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
      const summary = summarise(met, yearValues);
      parts.push('<div class="calsummary"><span class="v">' + metricFormat(met, summary)
        + '</span><span class="k">' + (summarises(met) ? 'total' : 'mean') + '</span>'
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
      node.addEventListener('click', () => { location.hash = y + '-' + String(m).padStart(2, '0'); });
      node.addEventListener('mousemove', ev => tip.show(cellTooltip(monthAt(y, m)), ev.clientX, ev.clientY));
      node.addEventListener('mouseleave', tip.hide);
      node.addEventListener('focus', () => {
        const box = node.getBoundingClientRect();
        tip.show(cellTooltip(monthAt(y, m)), box.left + box.width / 2, box.top);
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
      const what = record ? (summarises(met) ? 'The mean year' : 'The record')
        : sc.colName(state.scale === 'month' ? +col : col);
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

     The numbers come from the build - a Theil-Sen slope with Kendall's tau, on the same estimator
     the per-variable dashboards draw - so nothing is fitted here.
     ------------------------------------------------------------------------------------------ */

  const TREND_ALPHA = 0.05;

  /** The trend down one column of the grid, at whichever scale the grid is drawn. */
  function trendFor(met, colId) {
    const map = state.scale === 'season' ? met.season_trend : met.trend;
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
    if (!t) return 'No trend is taken on this metric.';
    if (!isNum(t.slope)) {
      return 'No slope is stated: only ' + t.n + ' year' + (t.n === 1 ? '' : 's')
        + ' of the record are complete and well enough measured to enter one, and '
        + M.trend_min_years + ' are needed.';
    }
    const sig = isNum(t.p) && t.p < TREND_ALPHA;
    return 'Trend ' + fmtSlope(met, t.slope) + ' ' + met.units + ' per decade'
      + (isNum(t.lo) ? ' (95 % interval ' + fmtSlope(met, t.lo) + ' to '
        + fmtSlope(met, t.hi) + ')' : '')
      + ', over ' + t.n + ' years between ' + t.y0 + ' and ' + t.y1 + '. Kendall p = '
      + (isNum(t.p) ? nf(t.p, 3) : 'not defined')
      + (sig ? ', so a monotonic change is unlikely to be noise.'
        : ', which does not clear ' + nf(TREND_ALPHA, 2) + '; treat the slope as undecided.');
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
      host.innerHTML = '<p class="rasterempty"><b>' + met.label + '</b> is computed over a whole '
        + 'month or season and has no value for a single day, so there is nothing to raster here. '
        + 'The month and season scales draw it.</p>';
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
      const rgb = isNum(value) ? metricColor(met, value, 'month') : null;
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
      host.innerHTML = '<p class="scalenote"><b>' + met.label + '</b>. A day either met the '
        + 'threshold or it did not, so the raster marks the days that did.</p>'
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
    const noun = state.scale === 'season' ? 'seasons' : 'months';
    const shown = spans.filter(mo => isNum(monthValue(met, mo))).length;
    const filtered = state.filters.size ? spans.filter(matchesFilter).length : null;
    let note = shown + ' of ' + spans.length + ' ' + noun + ' carry a value on this metric.';
    if (filtered !== null) {
      note += ' ' + filtered + ' ' + (filtered === 1 ? noun.slice(0, -1) : noun)
        + ' carry the selected badge'
        + (state.filters.size === 1 ? '' : 's') + '; the rest are dimmed.';
    }
    note += ' Hatched tiles are below ' + M.cov_warn_text + ' measured. The right-hand column is each year, the foot row each ' + noun.slice(0, -1)
      + ' over the whole record. Select one to open it.'
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
      note += ' Under each foot figure is the slope of that column across the record, per decade; '
        + '* marks a Kendall p below ' + nf(TREND_ALPHA, 2) + '. '
        + trendSentence(met, met.trend_year).replace(/^Trend /, 'Over the record as a whole, ');
    }
    host.textContent = note;
  }

  /** The note under the raster, which has different things to say than the one under the tiles. */
  function rasterNote(met) {
    if (met.day.kind === 'none') {
      return 'Choose a metric with a daily counterpart, or read this one at the month or season '
        + 'scale, where it is defined.';
    }
    let note = 'One mark per day, ' + M.n_days.toLocaleString() + ' of them, a row to the year and '
      + 'the year running left to right. ';
    note += 'This is the one scale on this page that does not cut an event in half: a heat wave '
      + 'across the turn of a month, or a dry spell running from August into September, is one '
      + 'streak here and two tiles at every other scale. ';
    note += 'The faint rules are the first of each month. Select a day to open it. '
      + 'Arrow keys move a day at a time, up and down a year at a time, Enter opens the day.';
    if (state.filters.size) {
      const kept = MONTHS.filter(matchesFilter);
      note += ' A badge describes a month, so the filter keeps the days of the '
        + kept.length + ' month' + (kept.length === 1 ? '' : 's') + ' carrying the selected badge'
        + (state.filters.size === 1 ? '' : 's') + ' and fades the rest.';
    }
    if (met.day.kind === 'anom') {
      note += ' Departures are taken against the normal of that calendar date, pooled from a ±'
        + M.clim_window + ' day window across every year of the record.';
    }
    return note;
  }

  /* ------------------------------------------------------------------------------------------
     Badge legend, which is also the filter
     ------------------------------------------------------------------------------------------ */

  function renderBadgeLegend() {
    const host = document.getElementById('badgelegend');
    const groups = [];
    DATA.badges.forEach(b => {
      let g = groups.find(x => x.name === b.group);
      if (!g) { g = { name: b.group, items: [] }; groups.push(g); }
      g.items.push(b);
    });
    host.innerHTML = groups.map(g =>
      '<div class="badgegroup"><h3>' + g.name + '</h3>' + g.items.map(b =>
        '<button type="button" class="badgetoggle" data-badge="' + b.key + '" '
        + 'aria-pressed="false">' + chip(b.key, 'lg')
        + '<span class="bt"><span class="bl">' + b.label + '</span> '
        + '<span class="bn">' + b.n + ' month' + (b.n === 1 ? '' : 's') + '</span>'
        + '<div class="bd">' + b.about + '</div></span></button>').join('') + '</div>').join('');

    host.querySelectorAll('.badgetoggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.badge;
        if (state.filters.has(key)) state.filters.delete(key); else state.filters.add(key);
        btn.setAttribute('aria-pressed', String(state.filters.has(key)));
        renderGrid();
      });
    });

    document.getElementById('badge-lede').textContent =
      'A badge marks something notable about a month and states the numbers behind it. '
      + 'Select one to keep only the months that carry it. Badges are withheld where less than '
      + M.cov_badge_text + ' of the variable behind them is measured. So an unbadged '
      + 'tile means either nothing was notable or it could not be judged. The month says which.';
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
      + (src ? '<span class="tile-src" title="read from this column">' + src + '</span>' : '')
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

  function renderHero() {
    /* The site is the heading of the page it is a page of; the eyebrow says what is being shown of
       it, and the span is already stated by the breadcrumb on the right of the bar. */
    const years = M.last_year - M.first_year + 1;
    document.getElementById('page-eyebrow').textContent =
      'Atlas of the ' + years + '-year record';
    document.getElementById('page-title').textContent = M.site;
    document.getElementById('page-lede').textContent =
      'Every month from ' + M.first_year + ' to ' + M.last_year + ' on one grid, coloured by the '
      + 'selected metric and badged with what was notable. Open one to walk the month day by day. '
      + 'The values are those read from the input file: this page aggregates and compares them, '
      + 'and corrects nothing.';

    const chips = [
      '<li><b>' + M.n_months + '</b> months</li>',
      '<li><b>' + M.n_days.toLocaleString() + '</b> days</li>',
      '<li><b>' + DATA.variables.length + '</b> variable' + (DATA.variables.length === 1 ? '' : 's') + '</li>',
      '<li><b>' + DATA.badges.length + '</b> badge types</li>',
      '<li>30 min records, aggregated here</li>'
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
        MONTH_NAME[anom.m - 1] + ' ' + anom.y + ', against its calendar-month normal', 'warm'));
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
      flux.push(tile('Most productive month', nf(productive.GPP.v, 0), VARS.GPP.units,
        MONTH_NAME[productive.m - 1] + ' ' + productive.y, null, VARS.GPP.column, 'tile-flux'));
    }
    const heroFluxes = flux.length
      ? (tiles.length ? '<div class="tiles-break"><span>Carbon</span></div>' : '') + flux.join('')
      : '';
    document.getElementById('tiles').innerHTML = tiles.join('') + heroFluxes;

    document.getElementById('footer-text').innerHTML =
      M.site + ' — ' + M.site_long + '. Built ' + M.generated
      + (M.source ? ' from <code>' + M.source + '</code>' : '') + '. Normals use the months at '
      + 'least ' + M.cov_normal_text + ' measured, and need at least ' + M.min_normal_years
      + ' such years; daily normals pool a ±' + M.clim_window + ' day window across all years.';
  }

  function renderAbout() {
    const host = document.getElementById('g-about');
    host.innerHTML = '';

    let body = cardEl(host, {
      title: 'How to read the grid', width: 'w-4',
      sub: 'Three levels: the record, a month, a day.'
    });
    body.innerHTML = '<p class="card-sub" style="max-width:none">Each tile is one month. Its '
      + 'colour is the selected metric. The strip along its bottom is that month\'s days on the '
      + 'same scale, so a heat wave or a wet spell shows before anything is opened, and the chips '
      + 'mark what was notable.</p>'
      + '<p class="card-sub" style="max-width:none">Read the two margins as well. The right-hand '
      + 'column is each year; the foot row is each calendar month across the whole record, which '
      + 'is what a single month has to be judged against.</p>'
      + '<p class="card-sub" style="max-width:none">Open a tile for the month: its days as a '
      + 'calendar, its daily course against the climatological band, and its place among the same '
      + 'month of every other year. Open a day there for the day itself. Arrow keys move between '
      + 'tiles, Enter opens one, Escape goes back.</p>';

    body = cardEl(host, { title: 'Threshold days', width: 'w-4',
      sub: 'The same definitions the per-variable dashboards use, read from one registry.' });
    body.innerHTML = tableHTML(['Threshold', 'Variable'],
      FLAGS.map(f => [cap(f.label), VARS[f.var].short]));

    body = cardEl(host, { title: 'Products behind this page', width: 'w-4',
      sub: 'A value here is exactly what the product notebook exported.' });
    body.innerHTML = tableHTML(['Variable', 'Column', 'Period'],
      DATA.variables.map(v => [v.short, '<code>' + v.column + '</code>',
        v.first_year + '–' + v.last_year]));

    /* The composite counts departures on several axes at once, so how far those axes duplicate
       one another is not a footnote to it - it is the thing that decides whether the count means
       what it appears to mean. Measured on the record, published beside the grid. */
    const C = M.composite;
    body = cardEl(host, {
      title: 'The axes of the composite, and how far they overlap', width: 'w-6',
      sub: 'Correlation between the monthly departures of every pair, over the '
        + C.n + ' months where all ' + C.vars.length + ' could be judged. Departures are taken '
        + 'against each calendar month’s own normal, so the seasons are already out of this.'
    });
    body.innerHTML = tableHTML([''].concat(C.vars.map(k => VARS[k].short)),
      C.vars.map((a, i) => [VARS[a].short].concat(C.correlation[i].map((v, j) => {
        if (i === j) return { v: '—', cls: '' };
        return { v: nfs(v, 2), cls: Math.abs(v) >= 0.5 ? 'num-warm' : '' };
      }))))
      + '<p class="smallnote">Vapour pressure deficit is computed from air temperature and '
      + 'relative humidity, so it cannot be independent of temperature; the table says by how '
      + 'much. It is counted all the same, being the atmospheric limb of a drought and the one a '
      + 'forest responds to. Relative humidity is the variable left out: VPD is the meaningful '
      + 'combination of the two, and RH beside it would be the same information twice.</p>';

    renderTrendCards(host);

    body = cardEl(host, { title: 'What a badge rests on', width: 'w-6',
      sub: 'Coverage rules, stated once and applied everywhere.' });
    body.innerHTML = '<p class="card-sub" style="max-width:none">A badge is a claim about a month, '
      + 'so a month that was not measured cannot make one. Every badge names the variables it '
      + 'reads and is withheld where less than ' + M.cov_badge_text + ' of them is '
      + 'measured; the month view lists what was withheld and why. A calendar-month normal, and '
      + 'every anomaly, standard score and rank taken from it, uses only the years whose month is '
      + 'at least ' + M.cov_normal_text + ' measured, and is not computed at all below '
      + M.min_normal_years + ' such years. A sparse month is ranked against nothing, so it can '
      + 'never come out as the driest on record.</p>';

    body = cardEl(host, { title: 'Coverage across the record', width: 'w-6',
      sub: 'The measured share of each variable, by year. Filled and reconstructed records '
        + 'do not count as measured.' });
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
      title: 'The normal is not stationary', width: 'w-6',
      sub: 'Every anomaly, standard score and rank on this page is measured against a mean of the '
        + 'whole record. This is what that mean is doing.'
    });
    body.innerHTML = '<p class="card-sub" style="max-width:none">A normal drawn from '
      + M.first_year + ' to ' + M.last_year + ' is a period average, not a climate that held '
      + 'still. Where the record moves, that average sits between its early years and its late '
      + 'ones, and a month near either end is partly being compared with a climate that is not '
      + 'its own. The slope below says by how much.</p>'
      + (bias
        ? '<p class="card-sub" style="max-width:none">For air temperature the effect is '
          + nfs(bias.bias, 2) + ' ' + VARS.TA.units + ': a year in the later half of the record '
          + 'begins that far from the normal it is judged against before any weather happens, so '
          + 'a warm badge late in the record is a smaller departure than the same badge early '
          + 'in it.</p>'
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
      + '<p class="smallnote">Theil-Sen slope, which a single extreme year does not move, with '
      + 'Kendall’s tau for the test; * marks p below ' + nf(TREND_ALPHA, 2) + '. A year takes '
      + 'part only where the product covers all twelve of its months, and no slope is stated below '
      + M.trend_min_years + ' such years. The two halves are the same complete years, '
      + 'split down the middle.</p>'
      /* Every figure on this page is computed on the gap-filled product, which is the series the
         field publishes and analyses. The cost of that is that a span measured less carries more
         model than one measured more, and where the measured share itself trends through a record,
         part of a slope may be that trend. Stated rather than left to be discovered. */
      + '<p class="smallnote">Every figure here is taken from the gap-filled product, whatever '
      + 'share of a span was measured rather than modelled — that series is what the field '
      + 'publishes, and holding it to a measured threshold would describe a sparser record than '
      + 'the one this page is of. What that costs is stated instead of hidden: a span measured '
      + 'less carries more model than one measured more, so where the measured share itself trends '
      + 'through a record, part of a slope may be that trend rather than the ecosystem. '
      + thinNote() + '</p>'
      + '<p class="smallnote">The baseline is deliberately not selectable. Badges are decided in '
      + 'the build against the whole-record normal, and a page that let the tiles be re-based '
      + 'would show tiles and badges disagreeing about the same month. One baseline carries every '
      + 'claim here; the trend is published as the fact that qualifies it.</p>';

    const items = trendVars();
    const monthly = items.reduce((a, v) => a + Object.keys(METRICS[v.metric].trend).length, 0);
    const clear = items.reduce((a, v) => a + Object.values(METRICS[v.metric].trend)
      .filter(t => isNum(t.p) && t.p < TREND_ALPHA).length, 0);
    chartCard(host, {
      title: 'Where in the year the record is moving', width: 'w-6',
      sub: 'The same slope taken down each calendar month, divided by the spread of that month’s '
        + 'own normal. In standard deviations per decade, so a January and a July are comparable '
        + 'and so are a temperature and a soil water content. Filled bars clear p < '
        + nf(TREND_ALPHA, 2),
      draw: drawTrendByMonth,
      foot: clear + ' of the ' + monthly + ' calendar-month slopes here clear that threshold. One '
        + 'month of one year is a small and noisy sample, and most of these slopes are undecided '
        + 'rather than flat: the record resolves a trend over a season or a year, which is what '
        + 'the season scale of the grid and the record row beneath it show.'
    });
  }

  const TREND_ROW = 44;

  function drawTrendByMonth(host) {
    const items = trendVars();
    const f = frame(host, {
      height: 22 + items.length * TREND_ROW + 30,
      margin: { top: 22, right: 14, bottom: 30, left: 84 },
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
        if (k === 0 && level !== 0) {
          svgText(f.svg, f.m.left - 6, sy(level) + 3, nfs(level, 0), 'ax-text',
            { 'text-anchor': 'end' });
        }
      });
      svgText(f.svg, f.m.left - 6, top + TREND_ROW / 2 + 4, v.short, 'ax-text',
        { 'text-anchor': 'end' });
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
    for (let m = 1; m <= 12; m++) {
      svgText(f.svg, bx(m) + band / 2, bottom + 14, MONTH_ABBR[m - 1], 'ax-text',
        { 'text-anchor': 'middle' });
    }
    svgText(f.svg, f.m.left, bottom + 28, 'standard deviations per decade, against that '
      + 'calendar month’s own spread', 'ax-title', { 'text-anchor': 'start' });

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
          { k: 'Against its spread', v: nfs(sd, 2) + ' sd' }] : [])
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

  /* The meteorology first and the fluxes on a row of their own, in their own colour. They are
     measured differently, held to different warning lines and read for different reasons, and a
     reader after the carbon balance should not have to pick it out of the thermometers. */
  function monthTiles(mo) {
    const met = [], flux = [];
    DATA.variables.forEach(v => {
      const rec = mo[v.key];
      if (!rec || !isNum(rec.v)) return;
      const bits = [];
      if (isNum(rec.a)) {
        bits.push(nfs(rec.a, v.digits) + ' ' + v.units + ' against the normal');
      }
      if (isNum(rec.r) && isNum(rec.n)) {
        /* Most variables rank from the top and need no explanation. NEE ranks from the negative
           end, because the sign convention makes the most negative month the largest uptake - so
           where a variable ranks the unobvious way, the tile says what rank 1 means. */
        bits.push(ord(rec.r) + ' of ' + rec.n + ' such months'
          + (v.rank_note ? ' (1st = ' + v.rank_note + ')' : ''));
      }
      if (isNum(rec.meas) && rec.meas < 99.5) bits.push(nf(rec.meas, 0) + ' % measured');
      const accent = v.key === 'TA' && isNum(rec.a) ? (rec.a > 0 ? 'warm' : 'cold') : null;
      /* The interval, where the file publishes one. Its components are named rather than left to
         be assumed: a "+/-" covering the u* threshold choice is a far larger claim than one
         covering only the random term, and for NEE the two differ by an order of magnitude. */
      if (isNum(rec.u)) {
        bits.unshift('± ' + nfu(rec.u, v.digits) + ' ' + v.units
          + (v.unc_note ? ' (' + v.unc_note + ')' : ''));
      }
      const isFlux = v.family === 'flux';
      const thin = isNum(rec.meas) && rec.meas < cov(v.key).warn;
      (isFlux ? flux : met).push(tile(
        v.short + (v.agg === 'sum' ? ', total' : ', mean'), nf(rec.v, v.digits),
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
      'of ' + mo.n, counts.join(' · ') || 'none in this month'));

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
        + ' <span class="muted">on the ' + ord(hit.d) + '</span></dd>');
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
        rows.push('<dt>Largest day-night range</dt><dd>' + nf(wv, 1) + ' ' + VARS.TA.units
          + ' <span class="muted">on the ' + ord(wd) + '</span></dd>');
      }
      if (isNum(mo.x.dtr)) {
        rows.push('<dt>Mean day-night range</dt><dd>' + nf(mo.x.dtr, 1) + ' ' + VARS.TA.units
          + '</dd>');
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
      notes.push(mo.x.nrec + ' day' + (mo.x.nrec === 1 ? '' : 's') + ' in this month set a record '
        + 'for its own calendar date. A day that was largely gap-filled cannot set one.');
    }
    Object.keys(mo.ev || {}).forEach(name => {
      const ev = mo.ev[name];
      const label = { gs_start: 'The growing season began', gs_end: 'The growing season ended',
        last_frost: 'The last frost of spring fell', first_frost: 'The first frost of autumn fell'
      }[name];
      notes.push(label + ' on ' + ev.date + (isNum(ev.delta) && ev.delta !== 0
        ? ', ' + Math.abs(ev.delta) + ' days ' + (ev.delta < 0 ? 'earlier' : 'later')
          + ' than the median date of the record.' : ', the median date of the record.'));
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
        + (isNum(z) ? nfs(z, 1) + ' sd' : '<span class="muted">not judgeable</span>') + '</dd>';
    });
    let head;
    if (!isNum(mo.x.zmax)) {
      head = '<p class="card-sub" style="max-width:none">Fewer than ' + M.composite_min_axes
        + ' of the ' + axes.length + ' axes could be judged here, so this month carries no '
        + 'composite: a count out of two is not comparable with a count out of five.</p>';
    } else {
      let driver = null;
      axes.forEach(key => {
        if (isNum(mo.z[key]) && (driver === null || Math.abs(mo.z[key]) > Math.abs(mo.z[driver]))) {
          driver = key;
        }
      });
      head = '<p class="card-sub" style="max-width:none">'
        + (mo.x.nsd === 0
          ? 'Nothing in this month reached one standard deviation from its normal.'
          : '<b>' + mo.x.nsd + ' of ' + mo.x.nz + ' axes</b> stood at least one standard '
            + 'deviation from normal')
        + (driver ? ', the furthest being ' + VARS[driver].short.toLowerCase() + ' at '
          + nfs(mo.z[driver], 1) + ' sd.' : '.') + '</p>';
    }
    const C = M.composite;
    const pair = C.strongest;
    return head + '<dl class="kv">' + rows.join('') + '</dl>'
      + '<p class="smallnote">An axis below ' + M.cov_badge_text + ' measured, or '
      + 'without a normal for this calendar month, is dropped, not counted as ordinary. '
      + 'The axes are not independent'
      + (pair ? ': ' + VARS[pair.a].short.toLowerCase() + ' and ' + VARS[pair.b].short.toLowerCase()
        + ' correlate at r = ' + nf(pair.r, 2) + ' across the record' : '')
      + ', so a count of two is not always two separate things. The whole matrix is on the '
      + 'grid page.</p>';
  }

  /**
   * The season a month belongs to, with the season's own standing, so a warm July can be read
   * against the summer it sat in. On the season scale it runs the other way and lists the months.
   */
  function seasonLine(mo) {
    if (state.scale === 'season') {
      return 'The three months of this season: ' + mo.months.map(ym => {
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
      line += ', which ran '
        + (isNum(rec.v) ? nf(rec.v, d) + ' ' + VARS[key].units : 'unmeasured');
      if (isNum(rec.a)) line += ' (' + nfs(rec.a, d) + ' against its normal)';
      if (isNum(rec.r) && isNum(rec.n)) {
        // "warmest" is a statement about temperature; anything else ranks without a superlative,
        // since high is not better or worse for a carbon flux.
        line += key === 'TA'
          ? ' and stands ' + ord(rec.r) + ' warmest of ' + rec.n + ' ' + se.label.toLowerCase() + 's'
          : ' and ranks ' + ord(rec.r) + ' of ' + rec.n + ' ' + se.label.toLowerCase() + 's';
      }
    }
    if (se.b.length) {
      line += (line === head ? ', which carries ' : '. The season carries ')
        + se.b.map(b => BADGES[b.k].label.toLowerCase()).join(', ');
    }
    return line + '.';
  }

  function monthBadges(mo) {
    if (!mo.b.length) {
      return '<ul class="badgelist none"><li><span class="bt"><span class="bd">Nothing in this '
        + 'month met a badge threshold.</span></span></li></ul>';
    }
    return '<ul class="badgelist">' + mo.b.map(b => {
      const meta = BADGES[b.k];
      return '<li>' + chip(b.k, 'lg') + '<span class="bt">'
        + '<span class="bl">' + meta.label + '</span>'
        + '<div class="bd">' + b.t + '.</div></span></li>';
    }).join('') + '</ul>';
  }

  function suppressedNote(mo) {
    /* Only the badges withheld for coverage are worth reporting: a badge withheld because the
       variable is not in this build says nothing about the month. */
    const rows = mo.sup.filter(s => /measured|no .* data/.test(s.why));
    if (!rows.length) return '';
    const seen = {};
    rows.forEach(s => { seen[s.why] = (seen[s.why] || []).concat(BADGES[s.key].label); });
    return '<p class="smallnote">Withheld for want of measurement: '
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

      const f = frame(host, { aspect: 0.36, ariaLabel: 'Daily temperature departure' });
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
          { k: 'month so far', v: nfs(run[i], 1) + ' ' + VARS.TA.units, color: f.p.ink }
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
        ariaLabel: 'Soil water content and precipitation' });
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
          { k: 'soil water, 0.2 m', v: nf(swc[i], 1) + ' ' + VARS['SWC'].units,
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
        ariaLabel: 'Daily ' + v.short + ' against the normal' });
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
    const label = names || { self: 'this month', ref: 'the record' };
    return function (host) {
      const hours = values.map((v, i) => i + 0.5);
      const v = VARS[key];
      const f = frame(host, { aspect: 0.62, margin: { top: 10, right: 12, bottom: 28, left: 42 },
        ariaLabel: 'Mean diurnal course of ' + v.short });
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
      const height = 30;
      const svg = el('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height,
        role: 'img', 'aria-label': v.short + ' in every ' + scale().colName(scale().idOf(mo)) + ' of the record' });
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
          tipRows(scale().colName(scale().idOf(mo)) + ' ' + x.y,
            [{ k: v.short, v: nf(x[key].v, v.digits) + ' ' + v.units }]),
          ev.clientX, ev.clientY));
        dot.addEventListener('mouseleave', tip.hide);
        if (!here) {
          dot.addEventListener('click',
            () => { location.hash = x.y + '-' + scale().slug(mo); });
        }
      });
      svgText(svg, 4, height - 1, nf(ext[0], v.digits), 'scalebar-text', { 'text-anchor': 'start' });
      svgText(svg, width - 4, height - 1, nf(ext[1], v.digits), 'scalebar-text',
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
        ariaLabel: 'Daily mean temperature in every ' + scale().colName(scale().idOf(mo)) + ' of the record' });
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
        return tipRows(d + ' ' + MONTH_ABBR[mo.m - 1], [
          { k: mo.y, v: nf(here ? here.values[i] : null, 1) + ' ' + VARS.TA.units,
            color: f.p.series[1] },
          { k: 'normal for the date', v: nf(norm.mid[i], 1) + ' ' + VARS.TA.units,
            color: f.p.muted },
          { k: 'coldest to warmest', v: others.length
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
      const rank = isNum(rec.r) && isNum(rec.n)
        ? '<b>' + ord(rec.r) + '</b> highest of ' + rec.n
        : 'not ranked';
      row.innerHTML = '<span class="sname"><b>' + v.short + '</b>'
        + nf(rec.v, v.digits) + ' ' + v.units + '</span>'
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
      const f = frame(host, { aspect: 0.36, ariaLabel: 'Daily temperature' });
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
          { k: 'normal', v: nf(nmean[i], 1) + ' ' + VARS.TA.units, color: f.p.muted }
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
          { k: 'total', v: nf(sums[i], 1) + ' ' + VARS.PREC.units, color: f.p.series[0] },
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
        { k: 'this month', v: nf(run[d - 1], 1) + ' ' + VARS.PREC.units, color: f.p.series[0] },
        { k: 'normal by this date', v: nf(runNorm[d - 1], 1) + ' ' + VARS.PREC.units,
          color: f.p.muted }
      ]), d => selectDay(d));
    };
  }

  /** The climatology of the slot a span belongs to: a calendar month, or a season. */
  function climFor(key, mo) {
    return state.scale === 'season'
      ? (DATA.season_climatology[key] || {})[mo.s]
      : (CLIM[key] || {})[String(mo.m)];
  }

  function drawAcrossYears(mo) {
    const met = metric();
    return function (host) {
      const rows = scale().spans().filter(x => scale().idOf(x) === scale().idOf(mo));
      const years = rows.map(x => x.y);
      const values = rows.map(x => monthValue(met, x));
      const f = frame(host, { aspect: 0.34, ariaLabel: met.label + ' in every ' + scale().colName(scale().idOf(mo)) });
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
        return tipRows(scale().colName(scale().idOf(mo)) + ' ' + y, [
          { k: met.short, v: nf(values[i], met.digits) + ' ' + met.units,
            color: y === mo.y ? f.p.series[1] : f.p.series[0] }
        ]);
      }, y => { if (y !== mo.y) location.hash = y + '-' + scale().slug(mo); });
    };
  }

  function dayTicks(mo, width) {
    const every = width < 420 ? 5 : width < 700 ? 2 : 1;
    const out = [];
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

  /* A season is three months, so its calendar is three calendars: a ninety-day sheet with one
     unbroken run of weeks would put the 1st of March in the middle of a row and read as nothing. */
  function dayCalendar(mo) {
    if (state.scale === 'season') {
      return mo.months.map(ym => {
        const child = monthAt(ym[0], ym[1]);
        if (!child) return '';
        // Each child keeps the month it came from, so a day opens in that month rather than
        // as an ambiguous nth day of a season.
        return '<p class="facet-title">' + MONTH_NAME[ym[1] - 1] + ' ' + ym[0] + '</p>'
          + dayCalendarOf(child).replace(/data-day="/g,
            'data-ym="' + ym[0] + '-' + ym[1] + '" data-day="');
      }).join('');
    }
    return dayCalendarOf(mo);
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
    return ' ' + wrapping.label + ' runs ' + first + ' to ' + last + ' and is labelled by the year '
      + 'of its ' + last + ', so the first one in the record is short of its ' + first
      + ' and the last ' + first + ' belongs to one the record does not reach.';
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
      let s = 'Mean temperature <b>' + nf(ta.v, 1) + ' ' + VARS.TA.units + '</b>';
      if (isNum(ta.a)) {
        s += ', ' + nfs(ta.a, 1) + ' ' + VARS.TA.units + ' against the '
          + scale().colName(scale().idOf(mo)) + ' normal';
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
        if (isNum(rec.a)) {
          s += ', ' + nfs(rec.a, d) + ' against the '
            + scale().colName(scale().idOf(mo)) + ' normal';
        }
        if (isNum(rec.r) && isNum(rec.n)) s += ' (ranks ' + ord(rec.r) + ' of ' + rec.n + ')';
        bits.push(s);
      });
    }
    if (!bits.length) return 'No variable in this month carries a monthly value.';
    return cap(bits.join('; ')) + '.';
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
    const yearStep = state.scale === 'season' ? SEASON_DEFS.length : 12;
    document.getElementById('month-prev').disabled = idx <= 0;
    document.getElementById('month-next').disabled = idx >= list.length - 1;
    document.getElementById('year-prev').disabled = idx - yearStep < 0;
    document.getElementById('year-next').disabled = idx + yearStep >= list.length;

    host.innerHTML = '<p class="monthlede" id="month-lede"></p>'
      + '<div class="tiles" id="month-tiles"></div>'
      + '<p class="seasonline" id="month-season"></p>'
      + '<h2 class="section">What was notable</h2><div id="month-badges"></div>'
      + '<div class="grid" id="month-highlights"></div>'
      + '<h2 class="section">Day by day</h2><div class="grid" id="month-charts"></div>'
      + '<h2 class="section">The average day</h2><div class="grid" id="month-diurnal"></div>'
      + '<h2 class="section">This month against the record</h2>'
      + '<div class="grid" id="month-context"></div>'
      + '<h2 class="section">The days</h2><div class="grid" id="month-days"></div>'
      + '<div id="day-panel"></div>'
      + '<h2 class="section">Every day of this month</h2><div class="grid" id="month-table"></div>';

    document.getElementById('month-lede').innerHTML = monthLede(mo);
    document.getElementById('month-tiles').innerHTML = monthTiles(mo);
    document.getElementById('month-season').innerHTML = seasonLine(mo);
    document.getElementById('month-badges').innerHTML = monthBadges(mo) + suppressedNote(mo);

    const hl = document.getElementById('month-highlights');
    hl.innerHTML = '';
    cardEl(hl, {
      title: 'The month in single days', width: 'w-4',
      sub: 'What the monthly mean hides.'
    }).innerHTML = monthHighlights(mo);
    cardEl(hl, {
      title: 'How unusual it was', width: 'w-4',
      sub: 'Departure from the calendar-month normal on each independent axis.'
    }).innerHTML = monthComposite(mo);

    // Named for the section rather than `charts`, which is the module's chart registry.
    const dayByDay = document.getElementById('month-charts');
    if (VARS.TA) {
      chartCard(dayByDay, {
        title: 'Daily temperature against the normal', width: 'w-6',
        sub: 'Daily range and daily mean, over the ±' + M.clim_window
          + ' day climatological band for the same date.',
        legend: [
          { color: 'var(--band-outer)', label: 'normal 10th–90th percentile' },
          { color: 'var(--band-inner)', label: 'daily minimum to maximum' },
          { color: 'var(--series-2)', label: 'daily mean', line: true },
          { color: 'var(--text-muted)', label: 'normal daily mean', line: true }
        ],
        draw: drawMonthTemperature(mo)
      });
      chartCard(dayByDay, {
        title: 'How far each day sat from its normal', width: 'w-6',
        sub: 'Daily mean minus the normal for the same date. The dashed line is the running mean '
          + 'of those departures, which is where the monthly anomaly comes from.',
        legend: [
          { color: 'var(--pole-warm)', label: 'warmer than the date' },
          { color: 'var(--pole-cold)', label: 'colder than the date' },
          { color: 'var(--text-primary)', label: 'month to date', line: true }
        ],
        foot: 'One monthly anomaly arises from a month that was uniformly mild and from one that '
          + 'held a cold first week and a hot last. This separates them.',
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
        title: 'Precipitation accumulated through the month', width: 'w-6',
        sub: 'The running total against the running total of the daily normals.',
        legend: [
          { color: 'var(--series-1)', label: 'this month', line: true },
          { color: 'var(--text-muted)', label: 'normal', line: true }
        ],
        draw: drawMonthCumulative(mo)
      });
    }
    if (VARS['SWC'] && VARS.PREC) {
      chartCard(dayByDay, {
        title: 'Soil water and the rain that drives it', width: 'w-6',
        sub: 'Soil water content against its ±' + M.clim_window + ' day normal band, over '
          + 'the daily precipitation on its own axis.',
        legend: [
          { color: 'var(--series-3)', label: 'soil water, 0.2 m', line: true },
          { color: 'var(--band-outer)', label: 'normal 10th–90th percentile' },
          { color: 'var(--series-1)', label: 'precipitation, right axis' }
        ],
        foot: 'A decline in soil water is drying or a probe that has stopped responding, and the '
          + 'rise after a rain day is what separates the two.',
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
        sub: 'Each daily mean over its own ±' + M.clim_window + ' day normal band for the same '
          + 'dates. Selecting a day opens it.'
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
    if (!HOURLY) {
      cardEl(diurnal, { title: 'The average day', width: 'w-12' }).innerHTML =
        '<p class="card-sub" style="max-width:none">This page was built without the hourly '
        + 'arrays, so no diurnal composite can be drawn. Rebuild without <code>--no-hourly</code>.'
        + '</p>';
    } else {
      const body = cardEl(diurnal, {
        title: 'The mean day of ' + MONTH_NAME[state.m - 1] + ' ' + state.y, width: 'w-12',
        sub: 'Every day of the month averaged onto one 24-hour axis, against the same composite '
          + 'over every ' + MONTH_NAME[state.m - 1] + ' of the record.',
        foot: 'A monthly mean cannot show whether a warm month was warm at night or by day, and '
          + 'the two have different causes: cloud and humidity hold the night up, radiation lifts '
          + 'the afternoon.'
      });
      const wrap = document.createElement('div');
      wrap.className = 'dayfacets';
      body.appendChild(wrap);
      let drawn = 0;
      diurnalVars().forEach(key => {
        const values = composite(key, mo.i0, mo.n);
        if (!values) return;
        drawn += 1;
        const v = VARS[key];
        const box = document.createElement('div');
        box.innerHTML = '<p class="facet-title">' + v.short
          + ' <span class="unit">(' + v.units + (key === 'PREC' ? ' per hour' : '')
          + ')</span></p><div class="chart"></div>';
        wrap.appendChild(box);
        const kind = key === 'PREC' ? 'bars' : (key === 'SW_IN' ? 'area' : 'line');
        mountChart(box.querySelector('.chart'),
          drawComposite(key, values,
            state.scale === 'month' ? climComposite(key, mo.m) : null, kind));
      });
      if (!drawn) {
        wrap.innerHTML = '<p class="card-sub">No hourly record survives for this month.</p>';
      } else {
        body.insertAdjacentHTML('beforeend', legendHTML([
          { color: 'var(--text-muted)', label: 'every '
            + scale().colName(scale().idOf(mo)) + ' of ' + M.first_year + '–' + M.last_year,
          line: true }
        ]));
      }
    }

    // -- The month against every other year of the same month --------------------------------
    const context = document.getElementById('month-context');
    const ranks = cardEl(context, {
      title: 'Where this month sits among its own years', width: 'w-6',
      sub: 'Every ' + MONTH_NAME[state.m - 1] + ' of the record on one line per variable, this '
        + 'one filled. The dashed tick is the calendar-month normal.',
      foot: 'Whether a departure of a degree is remarkable for this month or ordinary is a '
        + 'question about the spread of the other years, which an anomaly alone does not carry. '
        + 'Selecting another year opens it.'
    });
    ranks.appendChild(rankStrips(mo));

    if (VARS.TA) {
      chartCard(context, {
        title: 'The shape of every ' + MONTH_NAME[state.m - 1] + ' in the record', width: 'w-6',
        sub: 'Daily mean temperature through the month, one line per year, this one drawn over '
          + 'them.',
        legend: [
          { color: 'var(--series-2)', label: MONTH_NAME[state.m - 1] + ' ' + state.y, line: true },
          { color: 'var(--text-secondary)', label: 'the other years', line: true },
          { color: 'var(--text-muted)', label: 'normal for the date', line: true }
        ],
        foot: 'A rank places the month as one number among twenty-one. This is what says whether '
          + 'a warm month was warm throughout or held one spell that carried it.',
        draw: drawMonthShape(mo)
      });
    }

    chartCard(context, {
      title: 'Every ' + MONTH_NAME[state.m - 1] + ' in the record', width: 'w-12',
      sub: metric().label + '. This month is highlighted; selecting another opens it.',
      legend: [
        { color: 'var(--series-2)', label: MONTH_NAME[state.m - 1] + ' ' + state.y },
        { color: 'var(--series-1)', label: 'the other years' },
        { color: 'var(--text-muted)', label: 'normal', line: true }
      ],
      draw: drawAcrossYears(mo)
    });

    const daysHost = document.getElementById('month-days');
    const body = cardEl(daysHost, {
      title: 'The days of ' + MONTH_NAME[state.m - 1] + ' ' + state.y, width: 'w-8',
      sub: 'Coloured by ' + metric().label.toLowerCase() + '. Chips show the thresholds a day '
        + 'set, the bar along the bottom its precipitation. Select a day to open it.'
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
      sub: 'The numbers the charts and the calendar above are drawn from.'
    });
    tbody.innerHTML = dayTable(mo);

    if (state.d) renderDay();
  }

  /* ------------------------------------------------------------------------------------------
     Level 3: one day
     ------------------------------------------------------------------------------------------ */

  function selectDay(d) {
    if (d === null) return;
    location.hash = state.y + '-' + String(state.m).padStart(2, '0') + '-'
      + String(d).padStart(2, '0');
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

    host.innerHTML = '<h2 class="section">The day</h2><div class="grid daypanel" id="day-grid"></div>';
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
      if (isNum(meas) && meas < 99.5) {
        kv += '<dt>' + v.short + ' measured</dt><dd>' + nf(meas, 0) + ' %</dd>';
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
          + ' ' + dateName + ' in the record.</b> Largely gap-filled days are left out of that '
          + 'comparison.</p>'
        : '')
      + '<p class="smallnote">' + (set.length
        ? 'This day also counts as: ' + set.map(f => f.label).join(', ') + '.'
        : 'This day met none of the thresholds on this page.')
      + ' Departures in brackets are against the ±' + M.clim_window
      + ' day normal for the same date.</p>';

    if (!HOURLY) {
      const nb = cardEl(grid, { title: 'Diurnal course', width: 'w-8' });
      nb.innerHTML = '<p class="card-sub" style="max-width:none">This page was built without the '
        + 'hourly arrays, so the day is available as statistics only. Rebuild without '
        + '<code>--no-hourly</code> for the diurnal charts.</p>';
      return;
    }

    const monthName = MONTH_NAME[state.m - 1];
    const facets = cardEl(grid, {
      title: 'Through the day', width: 'w-8',
      sub: 'Hourly means, and hourly totals for precipitation, from the 30-minute products. The '
        + 'dashed line on each panel is the mean day of every ' + monthName + ' in the record, so '
        + 'the shape of this day can be read against the shape of an ordinary one.'
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
      wrap.innerHTML = '<p class="card-sub">No hourly record survives for this day.</p>';
    } else {
      facets.insertAdjacentHTML('beforeend', legendHTML([
        { color: 'var(--text-muted)', label: 'the mean ' + monthName + ' day, '
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
    const crumbs = document.getElementById('crumbs');
    /* The site rides with the span here, since the topbar itself now carries the product name and
       the hero scrolls out of sight. */
    const site = '<span class="site">' + M.site + '</span><span class="sep">·</span>';
    if (which === 'grid') {
      crumbs.innerHTML = site + '<b>' + M.first_year + '–' + M.last_year + '</b>';
    } else {
      crumbs.innerHTML = site + '<span>' + M.first_year + '–' + M.last_year + '</span>'
        + '<span class="sep">›</span><b>' + scale().title(state.span) + '</b>'
        + (state.d ? '<span class="sep">›</span><b>' + state.d + '</b>' : '');
    }
  }

  /* A span is addressed by year and either a month number or a season key: #2019-07, #2019-JJA,
     #2019-07-25. The scale follows from which of the two the URL carries, so a link into a season
     switches the grid behind it as well. */
  function route() {
    const hash = location.hash.replace('#', '');
    const m = /^(\d{4})-(\d{2}|[A-Z]{3})(?:-(\d{2}))?$/.exec(hash);
    const wanted = m ? (/^\d+$/.test(m[2]) ? 'month' : 'season') : null;
    const span = m ? SCALES[wanted].at(+m[1], /^\d+$/.test(m[2]) ? +m[2] : m[2]) : null;
    if (!span) {
      state.y = state.m = state.d = state.span = null;
      showView('grid');
      tip.hide();
      window.scrollTo({ top: 0 });
      return;
    }
    const same = state.span === span;
    if (state.scale !== wanted) {
      state.scale = wanted;
      // A reader who opened this day out of the raster gets the raster back when they leave the
      // month, so the grid only follows the span scale where it was already showing spans.
      if (state.grid !== 'day') setGrid(wanted);
      renderGrid();
    }
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
  }

  function setupNav() {
    document.getElementById('month-back').addEventListener('click', () => {
      location.hash = 'grid';
    });
    const step = delta => {
      const list = scale().spans();
      const target = list[list.indexOf(state.span) + delta];
      if (target) location.hash = target.y + '-' + scale().slug(target);
    };
    document.getElementById('month-prev').addEventListener('click', () => step(-1));
    document.getElementById('month-next').addEventListener('click', () => step(1));
    const yearStep = () => (state.scale === 'season' ? SEASON_DEFS.length : 12);
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
    function repaint() {
      sync();
      if (document.getElementById('view-grid').hidden) { renderMonth(); } else { renderGrid(); }
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
  buildControls();
  // The grid's classes, its label and the picker are set from one place, so the opening state
  // cannot differ from the state any later switch produces.
  setGrid(state.grid);
  renderBadgeLegend();
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
