/* Drive the design switch of a built page and report what each design put on it.
 *
 * A design is a token set and a repaint, so what is under test is that choosing one sets the
 * attribute, changes the tokens the renderer reads, repaints the tiles in the new colours, is
 * remembered, and survives the light/dark toggle - and that none of it throws.
 *
 * jsdom is borrowed from `tests/js/`, as `fill_text.mjs` borrows it.
 *
 * Usage: node design_switch.mjs <atlas.html> [<stored design>]
 * Prints {options, initial, designs: {name: {attr, stored, tokens, dark, cell, text}}, errors}.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('./js/package.json', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');

const [htmlPath, stored] = process.argv.slice(2);
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
    if (stored) window.localStorage.setItem('fluxatlas-design', stored);
  },
});
const { window } = dom;
const doc = window.document;
const tick = () => new Promise(resolve => window.setTimeout(resolve, 0));
await tick();

const root = doc.documentElement;
const token = name => window.getComputedStyle(root).getPropertyValue(name).trim();
const TOKENS = ['--page', '--text-primary', '--pole-warm', '--pole-cold', '--series-1', '--seq-7'];
const cellColour = () => {
  const cell = doc.querySelector('#calgrid .cell:not(.empty)');
  return cell ? cell.style.background || cell.style.backgroundColor : null;
};
const select = doc.getElementById('design-select');
const out = {
  options: select ? [...select.options].map(o => o.value) : null,
  initial: { attr: root.getAttribute('data-design'), value: select ? select.value : null,
    cell: cellColour() },
  designs: {},
};

for (const name of out.options || []) {
  select.value = name;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const row = {
    attr: root.getAttribute('data-design'),
    stored: window.localStorage.getItem('fluxatlas-design'),
    tokens: Object.fromEntries(TOKENS.map(t => [t, token(t)])),
    cell: cellColour(),
  };
  // The light/dark toggle under this design, and back.
  const toggle = doc.getElementById('theme-toggle');
  toggle.click();
  await tick();
  row.dark = { theme: root.getAttribute('data-theme'),
    tokens: Object.fromEntries(TOKENS.map(t => [t, token(t)])), cell: cellColour() };
  toggle.click();
  await tick();
  row.text = doc.getElementById('calgrid').textContent.length;
  out.designs[name] = row;
}
out.errors = errors;
process.stdout.write(JSON.stringify(out));
