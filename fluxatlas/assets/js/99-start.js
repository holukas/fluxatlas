  /* ------------------------------------------------------------------------------------------
     Go
     ------------------------------------------------------------------------------------------ */

  /* The theme is settled before anything is drawn. Every mark takes its colour from a token read
     at render time, so a grid drawn while the page is still on `auto` and then switched to the
     stored theme keeps the colours of the wrong token set until something happens to redraw it.
     Nothing in setupTheme paints; it only resolves which set is in force. */
  setupDesign();
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
