  /* ------------------------------------------------------------------------------------------
     Scales, ticks, SVG
     ------------------------------------------------------------------------------------------ */

  function linear(d0, d1, r0, r1) {
    const span = (d1 - d0) || 1;
    const f = v => r0 + (v - d0) / span * (r1 - r0);
    f.domain = [d0, d1];
    f.range = [r0, r1];
    return f;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(10));
    }
    return out;
  }

  function extent(arrays) {
    let lo = Infinity, hi = -Infinity;
    // A series may legitimately be absent (a normal that does not exist at this scale), and an
    // absent series is not an empty one: it simply does not take part in the extent.
    arrays.filter(Boolean).forEach(a => a.forEach(v => {
      if (!isNum(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }));
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    return [lo, hi];
  }

  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function svgText(parent, x, y, str, cls, extra) {
    const t = el('text', Object.assign({ x: x, y: y, class: cls || 'ax-text' }, extra || {}), parent);
    t.textContent = str;
    return t;
  }

  /* The width a set of labels needs, measured rather than estimated from character counts: the
     same eleven characters are a different width in "Sensible heat" and "Wm-2 mean". Measured off
     a hidden node so nothing has to be drawn twice to find out. */
  function textWidth(strings, cls) {
    const probe = el('svg', { width: 0, height: 0 });
    probe.setAttribute('style', 'position:absolute;visibility:hidden;pointer-events:none');
    document.body.appendChild(probe);
    let widest = 0;
    strings.forEach(s => {
      widest = Math.max(widest, svgText(probe, 0, 0, s, cls).getComputedTextLength());
    });
    probe.remove();
    return Math.ceil(widest);
  }

  /* Trim a label that still does not fit, and keep the whole of it in the tooltip. A name running
     off the edge of the card reads as a broken chart; a trimmed one reads as a trimmed one. */
  function trimText(node, limit, full) {
    if (!node.getComputedTextLength || node.getComputedTextLength() <= limit) return node;
    let text = full;
    while (text.length > 1 && node.getComputedTextLength() > limit) {
      text = text.slice(0, -1);
      node.textContent = text.replace(/[\s.]+$/, '') + '…';
    }
    el('title', {}, node).textContent = full;
    return node;
  }

  function pathFrom(xs, ys, sx, sy) {
    let d = '', pen = false;
    for (let i = 0; i < xs.length; i++) {
      if (!isNum(ys[i])) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + sx(xs[i]).toFixed(2) + ' ' + sy(ys[i]).toFixed(2);
      pen = true;
    }
    return d;
  }

  function areaFrom(xs, lo, hi, sx, sy) {
    const up = [], down = [];
    for (let i = 0; i < xs.length; i++) {
      if (!isNum(lo[i]) || !isNum(hi[i])) continue;
      up.push(sx(xs[i]).toFixed(2) + ' ' + sy(hi[i]).toFixed(2));
      down.unshift(sx(xs[i]).toFixed(2) + ' ' + sy(lo[i]).toFixed(2));
    }
    return up.length ? 'M' + up.join('L') + 'L' + down.join('L') + 'Z' : '';
  }

  /* ------------------------------------------------------------------------------------------
     Tooltip
     ------------------------------------------------------------------------------------------ */

  const tipNode = document.getElementById('tooltip');
  const tip = {
    show(html, x, y) {
      tipNode.innerHTML = html;
      tipNode.classList.add('on');
      const box = tipNode.getBoundingClientRect();
      const left = Math.max(8 + box.width / 2, Math.min(window.innerWidth - 8 - box.width / 2, x));
      const top = y - 12 < box.height + 8 ? y + box.height + 24 : y - 12;
      tipNode.style.left = left + 'px';
      tipNode.style.top = top + 'px';
    },
    hide() { tipNode.classList.remove('on'); }
  };

  function tipRows(title, rows) {
    let html = '<div class="tt-title">' + title + '</div>';
    rows.forEach(r => {
      if (r.rule) { html += '<div class="tt-row"><span class="k">' + r.k + '</span></div>'; return; }
      html += '<div class="tt-row">'
        + (r.color ? '<span class="sw" style="background:' + r.color + '"></span>' : '')
        + '<span class="k">' + r.k + '</span><span class="v">' + r.v + '</span></div>';
    });
    return html;
  }

  /* ------------------------------------------------------------------------------------------
     Chart frame
     ------------------------------------------------------------------------------------------ */

  function frame(host, spec) {
    const p = palette();
    const width = Math.max(260, host.clientWidth || 640);
    const height = spec.height
      || Math.round(Math.max(170, Math.min(400, width * (spec.aspect || 0.42))));
    const m = Object.assign({ top: 12, right: 14, bottom: 30, left: 46 }, spec.margin || {});
    // Room `drawAxes` found missing on an earlier pass for the y labels and their title.
    m.left += host.axisPad || 0;
    const svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height, width: width, height: height,
      role: 'img', 'aria-label': spec.ariaLabel || ''
    });
    host.innerHTML = '';
    host.appendChild(svg);
    return { svg: svg, p: p, width: width, height: height, m: m,
      iw: width - m.left - m.right, ih: height - m.top - m.bottom };
  }

  /** The fewest decimals, up to `most`, that state every tick exactly: 1500 rather than 1500.00. */
  function tickDigits(ticks, most) {
    for (let d = 0; d < most; d++) {
      const k = Math.pow(10, d);
      if (ticks.every(v => Math.abs(Math.round(v * k) - v * k) < 1e-6 * k)) return d;
    }
    return most;
  }

  /* A label's width, measured where the chart is on screen and estimated from its length where it
     is not: a chart redrawn inside a hidden view measures every label as zero wide, and a zero
     would let an edge label or the axis title land on its neighbour. */
  const labelWidth = node => (node.getComputedTextLength && node.getComputedTextLength())
    || node.textContent.length * 6.4;

  function drawAxes(f, sx, sy, spec) {
    const { svg, m, iw, ih } = f;
    const g = el('g', {}, svg);
    const yTicks = spec.yTicks || niceTicks(sy.domain[0], sy.domain[1], spec.yTickCount || 4);
    const digits = tickDigits(yTicks, spec.yDigits === undefined ? 0 : spec.yDigits);
    let widest = 0;
    yTicks.forEach(v => {
      const y = sy(v);
      if (y < m.top - 1 || y > m.top + ih + 1) return;
      el('line', { x1: m.left, x2: m.left + iw, y1: y, y2: y, class: 'gridline' }, g);
      const t = svgText(g, m.left - 8, y + 4, nf(v, digits), 'ax-text', { 'text-anchor': 'end' });
      widest = Math.max(widest, labelWidth(t));
    });
    el('line', { x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih, class: 'ax-line' }, g);
    let lastRight = -Infinity;
    (spec.xTicks || []).forEach(t => {
      const x = sx(t.v);
      if (x < m.left - 1 || x > m.left + iw + 1) return;
      el('line', { x1: x, x2: x, y1: m.top + ih, y2: m.top + ih + 4, class: 'ax-line' }, g);
      const label = svgText(g, x, m.top + ih + 16, t.label, 'ax-text', { 'text-anchor': 'middle' });
      /* A label centred on a tick at either end of the axis would reach into the y labels or past
         the edge of the chart; it is anchored at its tick instead. */
      const w = labelWidth(label);
      let x0 = x - w / 2;
      if (x0 < m.left - 4) { label.setAttribute('text-anchor', 'start'); x0 = x; }
      else if (x + w / 2 > f.width - 2) { label.setAttribute('text-anchor', 'end'); x0 = x - w; }
      // On a narrow chart the labels thin out rather than run into each other; the ticks stay.
      if (x0 < lastRight + 4) { label.remove(); return; }
      lastRight = x0 + w;
    });
    if (spec.yLabel) {
      /* The title stands beside the widest tick label, not at a fixed offset that a label such as
         "-1500" reaches past. Where the margin has no room for both, the chart is drawn again with
         the room added (`frame` reads `axisPad`), once, by `mountChart`. */
      // Turned on its side, the title reaches about 13 px left of its baseline and 3 px right.
      const ascent = 13, descent = 3, gap = 5;
      const x = Math.min(m.left - 32, m.left - 8 - widest - gap - descent);
      if (x < ascent + 1 && svg.parentNode) {
        const host = svg.parentNode;
        host.axisPad = (host.axisPad || 0) + Math.ceil(ascent + 1 - x);
        host.axisRedraw = true;
      }
      const t = svgText(g, 0, 0, spec.yLabel, 'ax-title', { 'text-anchor': 'middle' });
      t.setAttribute('transform', 'translate(' + Math.max(ascent + 1, x) + ','
        + (m.top + ih / 2) + ') rotate(-90)');
    }
    return g;
  }

  /* Charts redraw from their data on a resize and on a theme change rather than being scaled, so
     text stays one size at every width. A chart whose host has left the document - the month view
     is rebuilt whole - drops out of the registry instead of being redrawn into nothing. */
  let charts = [];

  function mountChart(host, draw) {
    charts.push({ host: host, draw: draw });
    let last = 0;
    const drawn = () => {
      draw(host);
      // The axis asked for more room for its labels: draw once more with it.
      if (host.axisRedraw) { host.axisRedraw = false; draw(host); host.axisRedraw = false; }
    };
    new ResizeObserver(() => {
      if (!host.isConnected || host.hidden) return;
      if (Math.abs(host.clientWidth - last) > 6) { last = host.clientWidth; drawn(); }
    }).observe(host);
    drawn();
  }

  function compactCharts() { charts = charts.filter(c => c.host.isConnected); }
  function redrawAll() {
    compactCharts();
    charts.forEach(c => c.draw(c.host));
  }

  /* ------------------------------------------------------------------------------------------
     Cards
     ------------------------------------------------------------------------------------------ */

  function cardEl(parent, def) {
    const node = document.createElement('section');
    node.className = 'card ' + (def.width || 'w-6');
    node.innerHTML = '<div class="card-head"><div><h3 class="card-title">' + def.title + '</h3>'
      + (def.sub ? '<p class="card-sub">' + def.sub + '</p>' : '') + '</div></div>'
      + '<div class="card-body"></div>'
      + (def.foot ? '<p class="card-foot">' + def.foot + '</p>' : '');
    parent.appendChild(node);
    return node.querySelector('.card-body');
  }

  function legendHTML(items) {
    return '<div class="legend">' + items.map(i =>
      '<span class="legend-item"><span class="legend-swatch ' + (i.line ? 'line' : '')
      + '" style="background:' + i.color + '"></span>' + i.label + '</span>').join('') + '</div>';
  }

  function chartCard(parent, def) {
    const body = cardEl(parent, def);
    const host = document.createElement('div');
    host.className = 'chart';
    body.appendChild(host);
    if (def.legend) body.insertAdjacentHTML('beforeend', legendHTML(def.legend));
    if (def.table) tableView(body, host, def);
    mountChart(host, def.draw);
    return body;
  }

  /**
   * A Chart/Table switch in a card's head, with the numbers behind the chart as a table.
   *
   * `def.table` is a function returning the table's markup, called the first time the table is
   * asked for: some of these tables run to hundreds of rows, and a reader who never asks for them
   * should not pay for building them. The chart is hidden rather than removed while the table
   * shows, and redrawn when it returns, since a hidden chart measures nothing.
   */
  function tableView(body, host, def) {
    const card = body.parentNode;
    const view = document.createElement('div');
    view.className = 'tableview';
    view.hidden = true;
    body.appendChild(view);
    card.querySelector('.card-head').insertAdjacentHTML('beforeend',
      '<div class="viewtoggle" role="group" aria-label="Show as">'
      + '<button type="button" data-view="chart" aria-pressed="true">Chart</button>'
      + '<button type="button" data-view="table" aria-pressed="false">Table</button></div>');
    const legend = body.querySelector('.legend');
    card.querySelectorAll('.viewtoggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        const wantTable = btn.dataset.view === 'table';
        card.querySelectorAll('.viewtoggle button').forEach(b =>
          b.setAttribute('aria-pressed', String((b.dataset.view === 'table') === wantTable)));
        if (wantTable && !view.innerHTML) view.innerHTML = def.table();
        host.hidden = wantTable;
        if (legend) legend.hidden = wantTable;
        view.hidden = !wantTable;
        if (!wantTable) {
          def.draw(host);
          if (host.axisRedraw) { host.axisRedraw = false; def.draw(host); host.axisRedraw = false; }
        }
      });
    });
  }

  function tableHTML(columns, rows) {
    let html = '<div class="tablewrap"><table><thead><tr>';
    columns.forEach(c => { html += '<th>' + c + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => {
        if (cell && typeof cell === 'object') {
          html += '<td class="' + (cell.cls || '') + '">' + cell.v + '</td>';
        } else {
          html += '<td>' + (cell === null || cell === undefined ? '–' : cell) + '</td>';
        }
      });
      html += '</tr>';
    });
    return html + '</tbody></table></div>';
  }

