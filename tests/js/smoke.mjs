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
const note = (where, what) => problems.push({ where, what: String(what).slice(0, 600) });

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
virtualConsole.on('jsdomError', err => note('thrown', err.stack || err.message));
virtualConsole.on('error', (...args) => note('console.error', args.join(' ')));

const dom = new JSDOM(readFileSync(htmlPath, 'utf-8'), {
  url: 'https://fluxatlas.test/atlas.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse: stub,
});

const { window } = dom;
const doc = window.document;
window.addEventListener('error', ev => note('thrown', ev.error ? (ev.error.stack || ev.error.message) : ev.message));
window.addEventListener('unhandledrejection', ev => note('rejected', ev.reason));

const tick = () => new Promise(resolve => window.setTimeout(resolve, 0));

/* What a reader is actually looking at. The three views are siblings and hidden with the `hidden`
 * attribute, so the visible one is the only one whose text is on screen; scanning all of them would
 * report a stale panel that nobody can see. */
function visibleText() {
  const views = ['view-grid', 'view-month', 'view-var']
    .map(id => doc.getElementById(id))
    .filter(node => node && !node.hidden);
  const crumbs = doc.getElementById('crumbs');
  return views.concat(crumbs ? [crumbs] : []).map(node => node.textContent || '').join('\n');
}

function inspect(where) {
  visited.push(where);
  const text = visibleText();
  if (text.replace(/\s+/g, '').length < 200) {
    note(where, 'the visible view rendered almost no text, which is what a blanked page looks like');
  }
  for (const bad of ['undefined', 'NaN', '[object Object]']) {
    const at = text.indexOf(bad);
    if (at >= 0) {
      const around = text.slice(Math.max(0, at - 90), at + 90).replace(/\s+/g, ' ').trim();
      note(where, `rendered text contains "${bad}": …${around}…`);
    }
  }
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
      scalePick.value = value;
      scalePick.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
      inspect(`grid at the ${value} scale`);
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

  // 3. A span panel at each of the three span scales, and one day inside a month.
  const month = pick(DATA.months);
  const monthHash = `#${month.y}-${pad2(month.m)}`;
  await goto(monthHash, `the month panel (${month.y}-${pad2(month.m)})`);

  if (DATA.seasons && DATA.seasons.length) {
    const season = pick(DATA.seasons);
    await goto(`#${season.y}-${season.s}`, `the season panel (${season.y} ${season.s})`);
  }

  if (DATA.years && DATA.years.length) {
    const year = pick(DATA.years);
    await goto(`#${year.y}-${DATA.meta.year_slug}`, `the year panel (${year.y})`);
  }

  // The day is opened from its own month, which is the route a reader takes and the one that puts
  // the raster cursor where the day panel expects it.
  await goto(monthHash, 'the month panel, before opening a day');
  await goto(`${monthHash}-15`, `the day panel (${month.y}-${pad2(month.m)}-15)`);

  // 4. Every variable page. This is the view that grew last and the one a one-variable build is
  //    most likely to break.
  for (const variable of DATA.variables) {
    await goto(`#var-${variable.key}`, `the ${variable.key} page`);
  }

  // 5. Back to where a reader started, which is also the route that has to survive an unknown hash.
  await goto('#nothing-addresses-this', 'an unknown hash, which has to fall back to the grid');
}

try {
  await run();
} catch (err) {
  note('driver', err.stack || err.message);
}
await tick();

process.stdout.write(JSON.stringify({ problems, visited }, null, 2));
