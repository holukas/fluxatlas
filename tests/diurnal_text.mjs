/* Read what a built page draws through the day: the variable page's surface and mean days, and the
 * span panel's mean day and its departure by hour.
 *
 * `smoke.mjs` proves every view renders without `undefined` in it and that every chart answers the
 * cursor; it cannot say whether a month's departure is one row and a year's twelve, or whether the
 * mean day survived a build without the hourly arrays. This reads those.
 *
 * jsdom is installed in `tests/js/` for the smoke driver and is borrowed from there.
 *
 * Usage: node diurnal_text.mjs <atlas.html> <hash> [<hash> ...]
 * Prints {errors, views: {hash: {var, span}}}: for a variable page the cards of `#var-diurnal`,
 * for a span panel the cards of `#month-diurnal`. Each card lists its title, its sub and foot, its
 * facet titles and captions, the rows of each surface it drew, and the tooltip of every mark that
 * answers the cursor.
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
const doc = window.document;
const tick = () => new Promise(resolve => window.setTimeout(resolve, 0));
await tick();

const text = node => (node ? node.textContent : null);

function cards(host) {
  if (!host || host.closest('[hidden]')) return null;
  return [...host.querySelectorAll('.card')].map(card => ({
    title: text(card.querySelector('.card-title')),
    sub: text(card.querySelector('.card-head .card-sub')),
    foot: text(card.querySelector('.card-foot')),
    facets: [...card.querySelectorAll('.facet-title')].map(text),
    captions: [...card.querySelectorAll('.card-body .card-sub')].map(text),
    svgs: card.querySelectorAll('svg').length,
    rows: [...card.querySelectorAll('svg[data-rows]')].map(s => +s.getAttribute('data-rows')),
    tips: [...card.querySelectorAll('rect.hit')].map(hit => {
      doc.getElementById('tooltip').innerHTML = '';
      hit.dispatchEvent(new window.MouseEvent('mousemove',
        { bubbles: true, clientX: 20, clientY: 20 }));
      return doc.getElementById('tooltip').textContent;
    }),
  }));
}

const views = {};
for (const hash of hashes) {
  window.location.hash = hash;
  await tick();
  await tick();
  const section = doc.getElementById('var-diurnal');
  views[hash] = {
    heading: section ? text(section.querySelector('h2')) : null,
    var: cards(section),
    span: cards(doc.getElementById('month-diurnal')),
  };
}
console.log(JSON.stringify({ errors, views }));
