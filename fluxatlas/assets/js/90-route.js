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
    const asVar = /^var-([A-Za-z0-9_.@-]+)$/.exec(hash);
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

  /* A theme or design change repaints every mark, including the charts of whichever view is not
     on screen and the ones the view being rebuilt does not own - the coverage chart sits on the
     grid view and is not touched by renderGrid. The grid is repainted whichever view is showing,
     since its tiles carry their colours inline and Back returns to it; then the view on screen. A
     variable page is not a span, and repainting it as one - which this did whenever the grid was
     hidden - threw on the null span and left the page in the old colours. */
  function repaintAll() {
    renderGrid();
    if (!document.getElementById('view-month').hidden && state.span) renderMonth();
    if (!document.getElementById('view-var').hidden && state.variable) renderVariable();
    redrawAll();
    renderScaleBar();
  }

  /* The design is an attribute on <html>, resolved from the remembered choice before anything is
     drawn, as the theme is. Classic is the absence of the attribute. A remembered name the menu
     does not offer - a design since removed - falls back to Classic rather than to no styles. */
  function setupDesign() {
    const root = document.documentElement;
    const select = document.getElementById('design-select');
    if (!select) return;
    const offered = [...select.options].map(o => o.value);
    const apply = name => {
      if (name === 'classic') root.removeAttribute('data-design');
      else root.setAttribute('data-design', name);
      select.value = name;
    };
    const stored = (() => {
      try { return localStorage.getItem('fluxatlas-design'); } catch (e) { return null; }
    })();
    apply(offered.includes(stored) ? stored : 'classic');
    select.addEventListener('change', () => {
      apply(select.value);
      try { localStorage.setItem('fluxatlas-design', select.value); } catch (e) { /* private */ }
      // A design moves the type as well as the colours, so the bar's height can change with it.
      measureTopbar();
      repaintAll();
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
    function repaint() {
      sync();
      repaintAll();
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

