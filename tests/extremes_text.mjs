/* Read what a variable page says at either end of its record, and year by year of its day tests.
 *
 * `smoke.mjs` proves the two parts render without `undefined` in them; it cannot say whether they
 * list the right days, name the right end, or count the right years. This reads the lists, the
 * headings over them and the links out of them, and puts the cursor on each threshold chart so the
 * tooltip it writes can be read too.
 *
 * jsdom is borrowed from `tests/js/`, as `fill_text.mjs` borrows it.
 *
 * Usage: node extremes_text.mjs <atlas.html> <hash> [<hash> ...]
 * Prints {hash: {extremes, thresholds}}, each null where the page drew nothing into it.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('./js/package.json', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');

const [htmlPath, ...hashes] = process.argv.slice(2);
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', err => errors.push(String(err.message)));

const dom = new JSDOM(readFileSync(htmlPath, 'utf-8'), {
  url: 'https://fluxatlas.test/atlas.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.scrollBy = () => {};
    window.matchMedia = query => ({ media: query, matches: false, addEventListener() {},
      removeEventListener() {}, addListener() {}, removeListener() {} });
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.Element.prototype.scrollIntoView = function scrollIntoView() {};
    window.SVGElement.prototype.getComputedTextLength = function getComputedTextLength() {
      return (this.textContent || '').length * 6.6;
    };
  },
});
const { window } = dom;
const tick = () => new Promise(resolve => window.setTimeout(resolve, 0));
await tick();

const lists = root => [...root.querySelectorAll('.card')].map(card => ({
  title: card.querySelector('.card-title')?.textContent ?? null,
  sub: card.querySelector('.card-sub')?.textContent ?? null,
  foot: card.querySelector('.card-foot')?.textContent ?? null,
  heads: [...card.querySelectorAll('h4')].map(h => h.textContent),
  items: [...card.querySelectorAll('.ranklist')].map(ul =>
    [...ul.querySelectorAll('li')].map(li => ({
      text: li.textContent,
      href: li.querySelector('a')?.getAttribute('href') ?? null,
    }))),
  table: [...card.querySelectorAll('tbody tr')].map(tr =>
    [...tr.children].map(td => td.textContent)),
  charts: card.querySelectorAll('svg').length,
}));

const out = {};
for (const hash of hashes) {
  window.location.hash = hash;
  await tick();
  await tick();
  const doc = window.document;
  const read = id => {
    const host = doc.getElementById(id);
    if (!host || !host.innerHTML.trim()) return null;
    return { heading: host.querySelector('h2')?.textContent ?? null, text: host.textContent,
      cards: lists(host) };
  };
  const extremes = read('var-extremes');
  const thresholds = read('var-thresholds');
  if (thresholds) {
    // The cursor over the middle of each threshold chart, and the tooltip that produces.
    const tips = [];
    for (const hit of doc.getElementById('var-thresholds').querySelectorAll('rect.hit')) {
      const svg = hit.ownerSVGElement;
      svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 320 });
      hit.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 320, clientY: 100,
        bubbles: true }));
      tips.push(doc.getElementById('tooltip').textContent);
    }
    thresholds.tips = tips;
  }
  out[hash] = { extremes, thresholds };
}
out.errors = errors;
process.stdout.write(JSON.stringify(out));
