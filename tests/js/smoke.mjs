/* Execute the built page and walk every view of it.
 *
 * `node --check` proves the renderer parses. It cannot prove it runs, and the two look identical
 * to a reader: the renderer is one IIFE, so anything thrown inside it leaves the markup on screen
 * with nothing drawn and no error anywhere a reader would look. Two bugs of exactly that shape
 * have shipped - `seasonLine` reading `se.TA.v` on a selection without air temperature, and
 * `MONTH_NAME[state.m - 1]` on a panel whose scale carries no month - and the Python suite could
 * not see either, because pytest cannot run JavaScript.
 *
 * So: load the page in a real DOM, visit every route it has, and fail on anything thrown or on the
 * word `undefined` reaching rendered text. The second half is the point. A card that reads a field
 * only one scale carries usually does not throw; it interpolates `undefined` into a sentence and
 * renders it, which is how "Every undefined in the record" appeared on two panels and stayed.
 *
 * **Walking the views is not enough, and eight bugs proved it.** A version of this driver that
 * visited every route and read the text of each passed while every hover and every keyboard focus
 * of a tile threw at two of the three span scales, every day-by-day chart sent a reader back to
 * the grid from those same two, and a year's day calendar carried `1 undefined 2016` in all 366 of
 * its `aria-label`s. None of it was visible, for three reasons this driver now closes:
 *
 *   - a page is *used*, not only rendered. A handler that throws draws nothing and reports nothing,
 *     so the tiles are hovered and focused, the charts are put under the cursor, and days are
 *     opened both from a chart and from the calendar.
 *   - a click is only correct if it lands somewhere. Selecting a day builds a URL, and a URL built
 *     from a field the scale does not carry routes to nothing - which the page answers by falling
 *     back to the grid, silently and plausibly.
 *   - text a reader can see is not only text a reader can read. `aria-label` and `title` carry
 *     sentences too, and they are what a screen reader is given.
 *
 * Usage: node smoke.mjs <path to a built atlas.html>
 * Prints one JSON object on stdout: {problems: [{where, what}], visited: [...], checks: {...}}.
 * Exit code is 0 whether or not problems were found - reporting them is the Python test's job; a
 * non-zero exit here means the driver itself failed.
 */

import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('usage: node smoke.mjs <atlas.html>');
  process.exit(2);
}

const problems = [];
const visited = [];

/* One fault usually produces many findings - a year's day calendar carried the same broken label in
 * all 366 of its cells - and a failure report of 366 identical lines is harder to read than three.
 * `kind` is what makes two findings the same fault; findings without one are never folded. */
const counted = new Map();
function note(where, what, kind) {
  if (kind) {
    const n = (counted.get(kind) || 0) + 1;
    counted.set(kind, n);
    if (n > 3) {
      if (n === 4) problems.push({ where, what: 'and more of the same, not listed' });
      return;
    }
  }
  problems.push({ where, what: String(what).slice(0, 600) });
}

/* What the driver is doing when something throws. A throw arrives through a window listener rather
 * than out of the call that caused it, so without this every one of them reads `[thrown]` and says
 * nothing about which interaction produced it. */
let stage = 'load';

/* Everything the renderer asks a browser for that jsdom does not implement. Each is stubbed rather
 * than worked around in the renderer: the page is written for a browser, and a stub that returns a
 * plausible value keeps the code under test on the path a browser would take. `getComputedTextLength`
 * is the one that matters - it returns a real number so the measured chart margins and `trimText`
 * are exercised instead of being skipped by their own guards. */
/* The CSV the page hands over, caught where a browser would start a download. jsdom has no object
 * URLs and would try to navigate on an anchor's click, so both are replaced by a recorder: the Blob
 * the renderer built and the file name it asked for are what the checks below read. */
const downloads = [];

function stub(window) {
  window.URL.createObjectURL = blob => {
    downloads.push({ blob, name: null });
    return 'blob:fluxatlas-test/' + downloads.length;
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {
    const last = downloads[downloads.length - 1];
    if (last && this.href === 'blob:fluxatlas-test/' + downloads.length) last.name = this.download;
  };
  window.scrollTo = () => {};
  window.scrollBy = () => {};
  window.matchMedia = query => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  window.SVGElement.prototype.getComputedTextLength = function getComputedTextLength() {
    // Roughly the advance of the page's own type at its chart sizes. The exact figure does not
    // matter; that it is a number, and that longer strings measure wider, does.
    return (this.textContent || '').length * 6.6;
  };
  // jsdom has no canvas: its `getContext` returns null and logs "not implemented", which this
  // driver reports as a console error. A 2D context that accepts every call and draws nothing
  // keeps the renderer on the path a browser takes - the image is still built cell by cell, it is
  // only never shown. What it draws is asserted elsewhere, in a real browser.
  window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    const canvas = this;
    return {
      canvas,
      imageSmoothingEnabled: true,
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      drawImage() {},
      clearRect() {},
      fillRect() {},
    };
  };
}

const virtualConsole = new VirtualConsole();
const firstLine = text => String(text).split('\n')[0];
virtualConsole.on('jsdomError', err => note('thrown during ' + stage, err.stack || err.message,
  'thrown|' + stage + '|' + firstLine(err.message)));
virtualConsole.on('error', (...args) => note('console.error during ' + stage, args.join(' '),
  'console|' + stage + '|' + firstLine(args.join(' '))));

const dom = new JSDOM(readFileSync(htmlPath, 'utf-8'), {
  url: 'https://fluxatlas.test/atlas.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse: stub,
});

const { window } = dom;
const doc = window.document;
window.addEventListener('error', ev => note('thrown during ' + stage,
  ev.error ? (ev.error.stack || ev.error.message) : ev.message,
  'thrown|' + stage + '|' + firstLine(ev.error ? ev.error.message : ev.message)));
window.addEventListener('unhandledrejection', ev => note('rejected during ' + stage, ev.reason));

const tick = () => new Promise(resolve => window.setTimeout(resolve, 0));

/* What a reader is actually looking at. The three views are siblings and hidden with the `hidden`
 * attribute, so the visible one is the only one whose text is on screen; scanning all of them would
 * report a stale panel that nobody can see. */
function visibleViews() {
  return ['view-grid', 'view-month', 'view-var']
    .map(id => doc.getElementById(id))
    .filter(node => node && !node.hidden);
}

/* The footer is on screen under every view, and it is where the caller's own strings - the site,
 * its description, the file name and, where the build records it, the file's provenance - are
 * printed; so it is read with the view rather than left out as chrome. */
function visibleText() {
  const extras = ['crumbs', 'footer-text', 'footer-prov', 'footer-methods', 'footer-credit'].map(id => doc.getElementById(id))
    .filter(Boolean);
  return visibleViews().concat(extras)
    .map(node => node.textContent || '').join('\n');
}

/* The strings a reader is given that are not in the flow of the page: the accessible name of every
 * chart, tile and day cell, and the `<title>` a truncated chart label keeps its full text in. They
 * are built by the same interpolation as the prose and go wrong the same way - `1 undefined 2016`
 * sat in 366 of them - and nothing that only reads `textContent` can see any of it. */
function labelledStrings() {
  const out = [];
  visibleViews().forEach(root => {
    root.querySelectorAll('[aria-label]').forEach(node => {
      out.push(['an aria-label on <' + node.nodeName.toLowerCase() + '>',
        node.getAttribute('aria-label')]);
    });
    root.querySelectorAll('[title]').forEach(node => {
      out.push(['a title attribute on <' + node.nodeName.toLowerCase() + '>',
        node.getAttribute('title')]);
    });
    root.querySelectorAll('title').forEach(node => out.push(['an svg <title>', node.textContent]));
  });
  return out;
}

const BAD = ['undefined', 'NaN', '[object Object]'];

/** Report every marker of a field that was not there, with enough of its sentence to place it. */
function scan(where, what, text) {
  if (!text) return;
  for (const bad of BAD) {
    const at = text.indexOf(bad);
    if (at < 0) continue;
    const around = text.slice(Math.max(0, at - 90), at + 90).replace(/\s+/g, ' ').trim();
    note(where, `${what} contains "${bad}": …${around}…`, `${where}|${what}|${bad}`);
  }
}

function inspect(where) {
  visited.push(where);
  const text = visibleText();
  if (text.replace(/\s+/g, '').length < 200) {
    note(where, 'the visible view rendered almost no text, which is what a blanked page looks like');
  }
  scan(where, 'rendered text', text);
  labelledStrings().forEach(([what, value]) => scan(where, what, value));
  planted(where);
}

/* The renderer never writes a <u> element, so one in the page can only have been parsed out of a
 * string that was the caller's - a site name, a description, a column - and reached `innerHTML`
 * unescaped. The escaping test plants `<u>` in every one of those it can reach, and this is where
 * it is caught, on whichever view first prints it. */
function planted(where) {
  const hit = doc.querySelector('u');
  if (!hit) return;
  const host = hit.parentElement;
  note(where, 'a <u> element was parsed out of text that should have arrived as text, inside <'
    + (host ? host.nodeName.toLowerCase() + (host.id ? '#' + host.id : '') : '?') + '>: '
    + (host ? host.textContent.slice(0, 160) : ''), `planted|${where}`);
}

/* The tooltip is a sibling of the views rather than inside one, so it is scanned where it is shown
 * rather than by `inspect`. An empty one is a finding in itself: everything that shows a tooltip
 * gives it a title, so nothing is what a handler that threw leaves behind. */
const tipNode = doc.getElementById('tooltip');
function inspectTip(where) {
  visited.push(where);
  const text = tipNode.textContent || '';
  if (!text.replace(/\s+/g, '')) {
    note(where, 'no tooltip was shown, which is what a handler that threw leaves behind',
      'no tooltip|' + stage);
    return;
  }
  scan(where, 'the tooltip', text);
}

let current = null;
async function goto(hash, where) {
  if (current !== hash) {
    current = hash;
    window.location.hash = hash;
    await tick();
    await tick();
  }
  inspect(where);
}

/* The payload is in the page, so every route this walks is derived from the record under test
 * rather than hard-coded here: every variable it carries, and a real span at each scale. */
const DATA = JSON.parse(doc.getElementById('payload').textContent);
const pad2 = n => String(n).padStart(2, '0');

// A span from the middle of the record rather than the first. The first year of a record is the
// one most likely to be short, and a short span exercises fewer of the cards.
const pick = rows => rows[Math.floor(rows.length / 2)];

const mouse = kind => new window.MouseEvent(kind, { bubbles: true, clientX: 20, clientY: 20 });

/* Hovering and focusing a tile of the grid, which is how a reader reads one without opening it.
 *
 * A tile addresses its span by the column it sits in, and that column is a month number only at
 * the month scale - `DJF` at the season scale, `YEAR` at the year scale. Looked up as a month it
 * is nothing, and the tooltip then threw on every hover and every keyboard focus of every tile at
 * two of the three scales while the grid behind it drew perfectly.
 *
 * Three tiles rather than all of them: the fault is in the handler, which every tile shares, and
 * a grid of twenty-one years by twelve months would cost 252 tooltips per scale per page. */
function driveTiles(where) {
  const cells = Array.from(doc.querySelectorAll('#view-grid .cell:not(.empty)'));
  if (!cells.length) {
    // The day raster is one svg rather than a grid of buttons, and it is focusable for the same
    // reason the tiles are, so its keyboard path is driven instead.
    const raster = doc.querySelector('#view-grid .rasterhost svg');
    if (!raster) return;
    tipNode.innerHTML = '';
    raster.dispatchEvent(new window.FocusEvent('focus'));
    inspectTip(`${where}, focusing the day raster`);
    return;
  }
  const sample = [cells[0], cells[Math.floor(cells.length / 2)], cells[cells.length - 1]];
  sample.forEach(cell => {
    const at = `${cell.dataset.y}-${cell.dataset.c}`;
    tipNode.innerHTML = '';
    cell.dispatchEvent(mouse('mousemove'));
    inspectTip(`${where}, hovering the tile at ${at}`);
    tipNode.innerHTML = '';
    cell.dispatchEvent(new window.FocusEvent('focus'));
    inspectTip(`${where}, focusing the tile at ${at}`);
  });
}

/* Every chart under the cursor. `hover` puts a crosshair on the nearest x value and titles the
 * tooltip with what that value is, which is where a chart reads a field its scale does not carry:
 * a day-by-day chart titled from the span's month said "1 undefined" on both the season and the
 * year panel, and no card text was wrong. */
function driveCharts(where) {
  visibleViews().forEach(root => {
    Array.from(root.querySelectorAll('rect.hit')).forEach((hit, i) => {
      tipNode.innerHTML = '';
      hit.dispatchEvent(mouse('mousemove'));
      inspectTip(`${where}, chart ${i + 1} under the cursor`);
    });
  });
}

/* Where a selection landed. A click builds a URL and the router follows it, so a URL built from a
 * field the active scale does not carry - `#2016-null-01` - resolves to nothing, and the page
 * answers by falling back to the grid. That is indistinguishable from a reader changing their
 * mind, which is why it survived: the grid it lands on renders perfectly. */
function landed(where, from) {
  visited.push(where);
  const hash = window.location.hash;
  for (const bad of ['null', 'undefined', 'NaN']) {
    if (hash.includes(bad)) note(where, `it built the address ${hash}, which addresses nothing`);
  }
  if (!doc.getElementById('view-grid').hidden && from !== 'grid') {
    note(where, `it landed back on the grid, at ${hash || '(no hash)'}`);
    return;
  }
  inspect(`${where} (${hash})`);
}

/* Opening a day, by both routes a span panel offers: a point on a day-by-day chart, and a cell of
 * the calendar below them. The two build the address differently and so fail differently - the
 * charts hand back an index into the span, the calendar stamps the month on the cell.
 *
 * Each click leaves the panel, and returning to it re-renders the grid behind it as well, which is
 * the expensive part of this driver. So the panel is re-entered once, between the two clicks, and
 * the caller's next route carries the reader away from the second. */
async function openADay(where, hash) {
  const hit = visibleViews().map(root => root.querySelector('rect.hit')).find(Boolean);
  if (hit) {
    hit.dispatchEvent(mouse('click'));
    await tick();
    await tick();
    landed(`${where}, selecting a day from a chart`);
    current = null;
  }
  const cells = () => Array.from(doc.querySelectorAll('#view-month .daycell[data-day]'));
  if (hit && cells().length) await goto(hash, `${where}, back from the day`);
  const open = cells();
  if (open.length) {
    open[Math.floor(open.length / 2)].dispatchEvent(mouse('click'));
    await tick();
    await tick();
    landed(`${where}, selecting a day from the calendar`);
    current = null;
  }
}

/* What the three newest parts of the page did, for the Python side to assert on by name. A part
 * that silently stopped being drawn would otherwise pass every scan above by producing nothing to
 * scan, so each one records that it ran as well as reporting what went wrong. */
const checks = { cumulative: [], csv: [], address: {} };

const nYears = DATA => DATA.meta.last_year - DATA.meta.first_year + 1;

/* The running total through the year: drawn with a line per year, and put under the cursor. The
 * chart names itself in its accessible label, which is what finds it here - the same text a screen
 * reader is given, so a chart that lost its label fails this as well as failing a reader. */
function driveCumulative(where, required) {
  const svgs = visibleViews().flatMap(root =>
    Array.from(root.querySelectorAll('svg[aria-label*="accumulated through the year"]')));
  if (!svgs.length) {
    if (required) note(where, 'no chart of the total accumulated through the year was drawn');
    return;
  }
  svgs.forEach(svg => {
    const lines = svg.querySelectorAll('path[fill="none"]').length;
    const hit = svg.querySelector('rect.hit');
    tipNode.innerHTML = '';
    if (hit) hit.dispatchEvent(mouse('mousemove'));
    inspectTip(`${where}, the accumulated total under the cursor`);
    checks.cumulative.push({ where, label: svg.getAttribute('aria-label'), lines,
      tip: tipNode.textContent });
    // A line per year, and the normal where there is one: fewer is a year that was not drawn.
    if (lines < nYears(DATA)) {
      note(where, `the accumulated chart drew ${lines} lines for ${nYears(DATA)} years`);
    }
  });
}

/* A Blob as its bytes, through the window's own FileReader since jsdom's Blob has no `text()`.
 * Decoded with the byte-order mark kept, so whether the file carries one can be asserted. */
function readBlob(win, blob) {
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(new TextDecoder('utf-8', { ignoreBOM: true })
      .decode(new Uint8Array(reader.result)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/* The download button, at whatever scale and metric the grid is on. The file has to exist, be
 * named for what it holds, carry a row per year under one header, and say nothing a spreadsheet
 * would read as text where a number was missing. */
async function driveCsv(where) {
  const control = doc.getElementById('csv-control');
  const button = doc.getElementById('csv-download');
  if (!control || !button) {
    note(where, 'no CSV download was offered on the grid');
    return;
  }
  if (control.hidden) {
    checks.csv.push({ where, hidden: true });
    return;
  }
  const before = downloads.length;
  button.dispatchEvent(mouse('click'));
  const got = downloads[before];
  if (!got || !got.name) {
    note(where, 'the CSV button produced no file');
    return;
  }
  const raw = await readBlob(window, got.blob);
  const bom = raw.charCodeAt(0) === 0xFEFF;
  const lines = raw.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  // No cell in these files is quoted - no header carries a comma - so a plain split is exact.
  const rows = lines.map(line => line.split(','));
  const header = rows[0] || [];
  const record = { where, name: got.name, type: got.blob.type, bom, header,
    rows: rows.length - 1, widths: Array.from(new Set(rows.map(r => r.length))),
    sample: lines.slice(0, 3) };
  checks.csv.push(record);
  if (rows.length - 1 !== nYears(DATA)) {
    note(where, `the CSV holds ${rows.length - 1} rows for ${nYears(DATA)} years`);
  }
  if (record.widths.length !== 1) note(where, 'the CSV rows are not all as wide as its header');
  for (const bad of ['NaN', 'null', 'undefined', 'Infinity']) {
    if (lines.slice(1).some(line => line.split(',').includes(bad))) {
      note(where, `the CSV carries "${bad}" where a value was missing`);
    }
  }
  if (header.some(h => h.includes('undefined'))) note(where, `a CSV header reads ${header}`);
}

/* The same page, opened afresh at an address: what a reload or a shared link does. A second DOM is
 * the only way to run the renderer's start-up path again, and start-up is where an address has to
 * be read before anything is drawn. */
const HTML = readFileSync(htmlPath, 'utf-8');
async function openAt(hash) {
  const fresh = new JSDOM(HTML, {
    url: 'https://fluxatlas.test/atlas.html' + hash,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: stub,
  });
  fresh.window.addEventListener('error', ev => note('thrown during ' + stage,
    ev.error ? (ev.error.stack || ev.error.message) : ev.message));
  await new Promise(resolve => fresh.window.setTimeout(resolve, 0));
  await new Promise(resolve => fresh.window.setTimeout(resolve, 0));
  return fresh;
}

/* A history step settles on a task of its own in jsdom, as it does in a browser, so it is waited
 * for by watching the address rather than by a fixed number of ticks. */
async function settle(before) {
  for (let k = 0; k < 40 && window.location.hash === before; k++) {
    await new Promise(resolve => window.setTimeout(resolve, 5));
  }
  await tick();
}

/* The metric and the scale, through the address and back out of it.
 *
 * Chosen with the controls, as a reader chooses them; carried into a span and out again by the
 * page's own links, which state neither; stepped back and forward through; and then opened afresh
 * from the address alone, at the grid and at a span. Each of those is a separate way to lose the
 * choice, and a page that lost it at any one would still draw a perfectly good grid - in the
 * default metric. */
async function driveAddress(monthHash) {
  stage = 'the address';
  await goto('#grid', 'the grid, before choosing through the address');
  const metricPick = doc.getElementById('metric-pick');
  const scalePick = doc.getElementById('scale-pick');
  const options = Array.from(metricPick.options).map(o => o.value);
  // The second metric, because the first is the default and an address leaves a default out.
  const metricKey = options.length > 1 ? options[1] : options[0];
  const offered = Array.from(scalePick.options).map(o => o.value);
  const scaleValue = offered.includes('season') ? 'season' : 'year';
  const out = checks.address;
  out.metric = metricKey;
  out.scale = scaleValue;

  metricPick.value = metricKey;
  metricPick.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  scalePick.value = scaleValue;
  scalePick.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  await tick();
  out.chosen = window.location.hash;
  // A page with one metric has nothing to choose, and a default is left out of the address by
  // design - so the metric is only looked for where there was a choice to record.
  const says = hash => (options.length < 2 || hash.includes('metric=' + encodeURIComponent(metricKey)))
    && hash.includes('scale=' + scaleValue);
  if (options.length > 1 && !out.chosen.includes('metric=' + encodeURIComponent(metricKey))) {
    note('the address', `choosing a metric left the address at ${out.chosen}`);
  }
  if (!out.chosen.includes('scale=' + scaleValue)) {
    note('the address', `choosing a scale left the address at ${out.chosen}`);
  }

  /* Into a span by a tile, whose link states neither choice, then back by the page's own button.
   * A tile of the grid as drawn, because the grid follows the scale of whatever span is opened -
   * a link into a month from a season grid moves the grid to months, by design - and the reader's
   * own path out of a season grid is into a season. */
  const tile = doc.querySelector('#view-grid .cell:not(.empty)');
  if (!tile) {
    note('the address', 'the grid at the chosen scale drew no tile to open');
    return;
  }
  tile.dispatchEvent(mouse('click'));
  await tick();
  await tick();
  out.span = window.location.hash;
  if (options.length > 1 && !out.span.includes('metric=')) {
    note('the address', `opening a span dropped the metric from the address: ${out.span}`);
  }
  doc.getElementById('month-back').dispatchEvent(mouse('click'));
  await tick();
  await tick();
  out.back = { hash: window.location.hash, metric: metricPick.value, scale: scalePick.value };
  if (metricPick.value !== metricKey || scalePick.value !== scaleValue
      || !says(window.location.hash)) {
    note('the address', 'coming back from a span lost the choice: '
      + JSON.stringify(out.back));
  }

  // Back and forward through the browser's history.
  let before = window.location.hash;
  window.history.back();
  await settle(before);
  out.historyBack = { hash: window.location.hash,
    view: doc.getElementById('view-month').hidden ? 'grid' : 'span' };
  if (out.historyBack.view !== 'span') {
    note('the address', `Back from the grid did not return to the span: ${out.historyBack.hash}`);
  }
  before = window.location.hash;
  window.history.forward();
  await settle(before);
  out.historyForward = { hash: window.location.hash, metric: metricPick.value,
    view: doc.getElementById('view-grid').hidden ? 'span' : 'grid' };
  if (out.historyForward.view !== 'grid' || metricPick.value !== metricKey) {
    note('the address', 'Forward did not return to the grid in the chosen metric: '
      + JSON.stringify(out.historyForward));
  }
  current = null;

  // A reload of the grid, and a shared link into a span, each from the address alone.
  stage = 'reopening the page at its address';
  const atGrid = await openAt(out.back.hash);
  const g = atGrid.window.document;
  out.reload = { hash: out.back.hash, metric: g.getElementById('metric-pick').value,
    scale: g.getElementById('scale-pick').value,
    grid: g.getElementById('calgrid').className };
  if (out.reload.metric !== metricKey || out.reload.scale !== scaleValue) {
    note('the address', 'a reload did not restore the choice: ' + JSON.stringify(out.reload));
  }
  atGrid.window.close();

  const shared = `${monthHash}?metric=${encodeURIComponent(metricKey)}`;
  const atSpan = await openAt(shared);
  const s = atSpan.window.document;
  const label = DATA.metrics.find(m => m.key === metricKey).label;
  out.shared = { hash: shared, view: s.getElementById('view-month').hidden ? 'grid' : 'span',
    metric: s.getElementById('metric-pick').value,
    colouredBy: (s.getElementById('month-body').textContent || '').includes(label + '.') };
  if (out.shared.view !== 'span' || out.shared.metric !== metricKey || !out.shared.colouredBy) {
    note('the address', 'a shared link into a span did not open it in the metric it named: '
      + JSON.stringify(out.shared));
  }
  atSpan.window.close();
  visited.push('the address, chosen, carried, stepped through and reopened');
}

/* Where the caller's own strings are printed, as the DOM holds them: the text a reader sees and the
 * elements it was parsed into. A description reading "Plot <b>north</b>" that arrives as text
 * leaves no element behind; one that reaches `innerHTML` unescaped leaves a <b>. */
function recordMarkup() {
  const elements = id => {
    const node = doc.getElementById(id);
    return node ? Array.from(node.querySelectorAll('*')).map(n => n.nodeName.toLowerCase()) : null;
  };
  const text = id => (doc.getElementById(id) || {}).textContent || '';
  const prov = doc.getElementById('footer-prov');
  checks.page = {
    title: doc.title,
    footer: { text: text('footer-text'), elements: elements('footer-text') },
    provenance: { hidden: prov ? prov.hidden : null, text: text('footer-prov'),
      elements: elements('footer-prov'),
      hash: (doc.querySelector('#footer-text code.hash') || {}).textContent || null },
    crumbs: { text: text('crumbs'), elements: elements('crumbs') },
  };
}

async function run() {
  await tick();
  inspect('load');
  recordMarkup();

  // 1. The grid, at each of the four scales the picker offers. This is a control rather than a
  //    route, so it is driven the way a reader drives it.
  await goto('#grid', 'grid');
  const scalePick = doc.getElementById('scale-pick');
  if (!scalePick) {
    note('grid', 'no scale picker was rendered, so the grid scales cannot be walked');
  } else {
    const offered = Array.from(scalePick.options).map(o => o.value);
    for (const value of offered) {
      stage = `the grid at the ${value} scale`;
      scalePick.value = value;
      scalePick.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
      inspect(`grid at the ${value} scale`);
      driveTiles(`grid at the ${value} scale`);
      await driveCsv(`grid at the ${value} scale, downloading it as CSV`);
    }
    scalePick.value = 'month';
    scalePick.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
  }

  // 2. Colouring the grid by each metric in turn. A metric whose ramp or units are read from a
  //    field it does not carry fails here and nowhere else.
  const metricPick = doc.getElementById('metric-pick');
  if (metricPick) {
    for (const option of Array.from(metricPick.options)) {
      metricPick.value = option.value;
      metricPick.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
      inspect(`grid coloured by ${option.value}`);
      // Every metric's table, since a metric that reads a field it does not carry fails here too.
      await driveCsv(`grid coloured by ${option.value}, downloading it as CSV`);
    }
  }

  /* 3. The detail switch, which is the one control the grid has that is not a picker - and which
   *    also makes everything after it cheap. Opening a day out of a span panel changes the span
   *    scale, and the grid behind the panel is redrawn with it; with the micro-strips on that is a
   *    per-day colour for every tile of the record, and it is by far the largest cost in this
   *    driver. The grid has already been read with them on, under every metric. */
  const strips = doc.getElementById('strip-toggle');
  if (strips) {
    stage = 'the detail switch';
    strips.checked = false;
    strips.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    inspect('the grid with the micro-strips switched off');
  }

  /* 4. A span panel at each of the three span scales, and a day opened out of each of them.
   *    Every card of the panel is read, every chart is put under the cursor, and both routes into
   *    a day are taken - because a panel that renders is not the same claim as a panel that works,
   *    and the difference is where this class of bug lives. */
  const month = pick(DATA.months);
  const monthHash = `#${month.y}-${pad2(month.m)}`;
  const season = DATA.seasons && DATA.seasons.length ? pick(DATA.seasons) : null;
  const year = DATA.years && DATA.years.length ? pick(DATA.years) : null;
  const panels = [[monthHash, `the month panel (${month.y}-${pad2(month.m)})`]];
  if (season) panels.push([`#${season.y}-${season.s}`, `the season panel (${season.y} ${season.s})`]);
  if (year) panels.push([`#${year.y}-${DATA.meta.year_slug}`, `the year panel (${year.y})`]);

  // The year panel draws a signed total accumulated through the year, wherever there is one.
  const sums = DATA.variables.filter(v => v.agg === 'sum' && DATA.days.series[`${v.key}_sum`]);
  const signedSum = sums.some(v => v.sign);
  for (const [hash, where] of panels) {
    stage = where;
    await goto(hash, where);
    driveCharts(where);
    const isYear = hash.endsWith(`-${DATA.meta.year_slug}`);
    driveCumulative(where, isYear && signedSum);
    await openADay(where, hash);
    /* The accumulated total on the year panel opens a day as well, by the date under the cursor;
     * it is the one chart there whose x axis is a date of the year rather than a day of a span. */
    if (isYear && signedSum) {
      await goto(hash, `${where}, back for the accumulated total`);
      const svg = doc.querySelector('#view-month svg[aria-label*="accumulated through the year"]');
      const hit = svg && svg.querySelector('rect.hit');
      if (hit) {
        hit.dispatchEvent(mouse('click'));
        await tick();
        await tick();
        landed(`${where}, selecting a day from the accumulated total`);
        current = null;
      }
    }
  }

  // The day panel is also reached by its own address, which is the link a reader shares.
  stage = 'the day panel';
  await goto(`${monthHash}-15`, `the day panel (${month.y}-${pad2(month.m)}-15)`);
  driveCharts(`the day panel (${month.y}-${pad2(month.m)}-15)`);

  // 5. Every variable page. This is the view that grew last and the one a one-variable build is
  //    most likely to break.
  for (const variable of DATA.variables) {
    stage = `the ${variable.key} page`;
    await goto(`#var-${variable.key}`, `the ${variable.key} page`);
    driveCharts(`the ${variable.key} page`);
    driveCumulative(`the ${variable.key} page`, sums.includes(variable));
  }

  /* The theme toggle, on a view that is not the grid. It repaints the view on screen, and it used
   * to repaint anything that was not the grid as a span panel: on a variable page that threw on
   * the null span and left the page in its old colours. Toggled twice, so the walk goes on in the
   * theme it began in. */
  const toggle = doc.getElementById('theme-toggle');
  for (const [hash, where] of [[`#var-${DATA.variables[0].key}`, 'a variable page'],
    [monthHash, 'the month panel']]) {
    stage = `the theme toggle on ${where}`;
    await goto(hash, `${where}, before the theme toggle`);
    for (let k = 0; k < 2; k++) {
      toggle.dispatchEvent(mouse('click'));
      await tick();
      inspect(`${where}, after the theme toggle`);
    }
  }

  // 6. The metric and the scale, through the address and back out of it.
  await driveAddress(monthHash);

  // 7. Back to where a reader started, which is also the route that has to survive an unknown hash.
  stage = 'an unknown hash';
  await goto('#nothing-addresses-this', 'an unknown hash, which has to fall back to the grid');
  landed('an unknown hash, which has to fall back to the grid', 'grid');
}

try {
  await run();
} catch (err) {
  note('driver', err.stack || err.message);
}
await tick();

process.stdout.write(JSON.stringify({ problems, visited, checks }, null, 2));
