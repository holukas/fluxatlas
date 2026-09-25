/* Read what a built page says about how its spans were filled.
 *
 * `smoke.mjs` proves every view renders without `undefined` in it; it cannot say whether the words
 * are the right ones. The fill levels are words chosen per flag convention - a code 2 is reanalysis
 * beside consolidated meteorology and medium-quality fill beside a flux - so what the page prints
 * is the thing under test, and this reads it.
 *
 * jsdom is installed in `tests/js/` for the smoke driver; it is borrowed from there rather than
 * installed twice.
 *
 * Usage: node fill_text.mjs <atlas.html> <hash> [<hash> ...]
 * Prints {hash: {tiles, titles, cov, badges}}: the text of the month panel's tiles, the `title` of
 * every element inside them, the text of the variable page's coverage card, and the month panel's
 * badges with the note on those not evaluated.
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

const out = {};
for (const hash of hashes) {
  window.location.hash = hash;
  await tick();
  await tick();
  const doc = window.document;
  const tiles = doc.getElementById('month-tiles');
  const cov = doc.getElementById('var-cov');
  const badges = doc.getElementById('month-badges');
  out[hash] = {
    tiles: tiles && !tiles.closest('[hidden]') ? tiles.textContent : null,
    titles: tiles ? [...tiles.querySelectorAll('[title]')].map(e => e.getAttribute('title')) : [],
    cov: cov && !cov.closest('[hidden]') ? cov.textContent : null,
    badges: badges && !badges.closest('[hidden]') ? badges.textContent : null,
  };
}
out.errors = errors;
process.stdout.write(JSON.stringify(out));
