/* Read what the hour-by-day heatmap on a variable page drew, cell by cell.
 *
 * jsdom has no canvas, so `smoke.mjs` gives the page a 2D context that draws nothing and can only
 * prove the renderer ran. This one gives it a context that *records*: the ImageData the renderer
 * filled is kept, so the colour of every cell can be read back and checked against the payload it
 * was drawn from. The pointer is then put on a chosen cell and the tooltip read, and the cell is
 * selected to see where the page goes.
 *
 * A gap is planted in the payload before the page loads - the hourly values of one variable set to
 * null over a run of days - because the synthetic record is gap-free and a gap is half of what the
 * picture is for.
 *
 * jsdom is installed in `tests/js/` for the smoke driver; it is borrowed from there.
 *
 * Usage: node hourly_canvas.mjs <atlas.html> <spec.json>
 *   spec: {dpr, gap: {key, from, to} | null, hover: [{key, day, hour}], keys: [...]}
 * Prints {errors, gap, tokens, vars: {key: {...}}}: per variable whether a card, a canvas and a
 * note were drawn, the canvas's accessible name, the legend, the image as base64 RGBA, and the
 * tooltips and addresses the hover and the click produced.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('./js/package.json', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');

const [htmlPath, specPath] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', err => errors.push(String(err.message)));
virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

// The gap, planted in the payload the page parses.
let html = readFileSync(htmlPath, 'utf-8');
const open = '<script id="payload" type="application/json">';
const at = html.indexOf(open);
const end = html.indexOf('</script>', at);
const data = JSON.parse(html.slice(at + open.length, end));
if (spec.gap && data.hourly && data.hourly.vars[spec.gap.key]) {
  const values = data.hourly.vars[spec.gap.key].values;
  for (let d = spec.gap.from; d < spec.gap.to; d++) {
    for (let h = 0; h < 24; h++) values[d * 24 + h] = null;
  }
  html = html.slice(0, at + open.length) + JSON.stringify(data) + html.slice(end);
}

const dom = new JSDOM(html, {
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
    Object.defineProperty(window, 'devicePixelRatio', { value: spec.dpr || 1,
      configurable: true });
    // A context that keeps what it is given: the ImageData put on the small canvas, and what the
    // visible canvas was then drawn from and at what size.
    window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
      if (kind !== '2d') return null;
      const canvas = this;
      return {
        canvas,
        imageSmoothingEnabled: true,
        createImageData: (w, h) => ({ width: w, height: h,
          data: new Uint8ClampedArray(w * h * 4) }),
        putImageData(img) { canvas.fluxImage = img; },
        drawImage(src, x, y, w, h) {
          canvas.fluxDrawn = { image: src.fluxImage, x, y, w, h,
            smoothing: this.imageSmoothingEnabled };
        },
        clearRect() {},
        fillRect() {},
      };
    };
  },
});
const { window } = dom;
const doc = window.document;
const tick = () => new Promise(resolve => window.setTimeout(resolve, 0));
await tick();

const token = name => window.getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
const out = { errors, gap: spec.gap, tokens: {}, vars: {} };
['--text-muted', '--neutral-mid', '--pole-warm', '--pole-cold', '--rdylbu-1', '--rdylbu-11']
  .forEach(t => { out.tokens[t] = token(t); });

const tipNode = doc.getElementById('tooltip');
const nDays = data.hourly ? Math.floor(data.hourly.n / 24) : 0;

for (const key of spec.keys) {
  window.location.hash = '#var-' + key;
  await tick();
  await tick();
  const host = doc.getElementById('var-hourly');
  const canvas = host ? host.querySelector('canvas') : null;
  const drawn = canvas ? canvas.fluxDrawn : null;
  const row = {
    card: !!(host && host.querySelector('.card')),
    text: host ? host.textContent : null,
    canvas: !!canvas,
    aria: canvas ? canvas.getAttribute('aria-label') : null,
    role: canvas ? canvas.getAttribute('role') : null,
    legend: host && host.querySelector('.legend') ? host.querySelector('.legend').textContent
      : null,
    columns: canvas ? +canvas.dataset.columns : null,
    perColumn: canvas ? +canvas.dataset.daysPerColumn : null,
    canvasWidth: canvas ? canvas.width : null,
    drawnWidth: drawn ? drawn.w : null,
    smoothing: drawn ? drawn.smoothing : null,
    image: drawn && drawn.image ? { width: drawn.image.width, height: drawn.image.height,
      rgba: Buffer.from(drawn.image.data.buffer).toString('base64') } : null,
    tips: [],
    clicks: [],
  };
  if (canvas) {
    for (const h of spec.hover.filter(x => x.key === key)) {
      // Found afresh each time, since the click below leaves the page and the return redraws it.
      const hit = doc.querySelector('#var-hourly canvas').parentNode.querySelector('rect.hit');
      // Laid out one CSS pixel per day and per hour, so a pointer can be put on an exact cell.
      hit.getBoundingClientRect = () => ({ left: 0, top: 0, width: nDays, height: 24,
        right: nDays, bottom: 24, x: 0, y: 0 });
      const ev = kind => new window.MouseEvent(kind, { bubbles: true,
        clientX: h.day + 0.5, clientY: 23 - h.hour + 0.5 });
      tipNode.innerHTML = '';
      hit.dispatchEvent(ev('mousemove'));
      row.tips.push({ day: h.day, hour: h.hour, text: tipNode.textContent });
      hit.dispatchEvent(ev('click'));
      await tick();
      row.clicks.push({ day: h.day, hash: window.location.hash });
      window.location.hash = '#var-' + key;
      await tick();
      await tick();
    }
  }
  out.vars[key] = row;
}

process.stdout.write(JSON.stringify(out));
window.close();
