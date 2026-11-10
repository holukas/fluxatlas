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

