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
 * Prints one JSON object on stdout: {problems: [{where, what}], visited: [...]}. Exit code is 0
 * whether or not problems were found - reporting them is the Python test's job; a non-zero exit
 * here means the driver itself failed.
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
function stub(window) {
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

function visibleText() {
  const crumbs = doc.getElementById('crumbs');
  return visibleViews().concat(crumbs ? [crumbs] : [])
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

async function run() {
  await tick();
  inspect('load');

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

  for (const [hash, where] of panels) {
    stage = where;
    await goto(hash, where);
    driveCharts(where);
    await openADay(where, hash);
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
  }

  // 6. Back to where a reader started, which is also the route that has to survive an unknown hash.
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

process.stdout.write(JSON.stringify({ problems, visited }, null, 2));
