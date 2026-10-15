/* Gauge SVG: same look as the Android 4.1.x gauge (280 degree band, red/orange/yellow/green, silver rim, white needle).
   Built from numbers only, parsed with DOMParser (no HTML injection path). */
import { gaugeScale, gaugePos } from './calc.js';
import { short, money } from './util.js';

const pt = (cx, cy, r, deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
const arc = (cx, cy, r, a0, a1) => {
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
let uid = 0;

export function gaugeSVG(value, { main = true, reverse = false, label = 'Gauge' } = {}) {
  const sc = gaugeScale(value, main), pos = gaugePos(value, sc.marks);
  const id = 'rim' + (++uid), cx = 150, cy = 150, start = 130, sweep = 280, R = 112, W = 26;
  let cols = ['#d92f2f', '#ef6a2e', '#e8c62e', '#2daa49']; if (reverse) cols = cols.reverse();
  const o = [];
  o.push(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef3f8"/><stop offset="1" stop-color="#97a4b3"/></linearGradient></defs>`);
  o.push(`<path d="${arc(cx, cy, R + W / 2 + 5, start - 1.5, start + sweep + 1.5)}" stroke="#7d8a99" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  o.push(`<path d="${arc(cx, cy, R + W / 2 + 1.5, start - 1, start + sweep + 1)}" stroke="url(#${id})" stroke-width="3.5" fill="none" stroke-linecap="round"/>`);
  cols.forEach((c, i) => { const a0 = start + i * sweep / 4; o.push(`<path d="${arc(cx, cy, R, a0, a0 + sweep / 4)}" stroke="${c}" stroke-width="${W}" fill="none"/>`); });
  o.push(`<path d="${arc(cx, cy, R - W / 2 - 1.5, start - 1, start + sweep + 1)}" stroke="#e4ecf3" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  for (let i = 0; i <= 40; i++) {
    const a = start + sweep * i / 40, major = i % 10 === 0;
    const [x0, y0] = pt(cx, cy, R + W / 2 - 1, a), [x1, y1] = pt(cx, cy, R + W / 2 - (major ? 15 : 9), a);
    o.push(`<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="#101c33" stroke-width="${major ? 3.4 : 1.8}" stroke-linecap="round"/>`);
  }
  const lab = sc.marks.map((mk, k) => {
    const a = start + sweep * k / 4; let [x, y] = pt(cx, cy, R + W / 2 + 22, a);
    const anc = k === 1 ? 'end' : k === 3 ? 'start' : 'middle';
    if (k === 0 || k === 4) y += 10; else if (k !== 2) y += 5;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anc}">${short(mk)}</text>`;
  }).join('');
  const ang = start + pos * sweep, [nx, ny] = pt(cx, cy, 98, ang), [tx, ty] = pt(cx, cy, -12, ang);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="gauge${main ? '' : ' mini'}" viewBox="-66 -22 432 336" role="img" aria-label="${label}: ${money(value)}, needle at ${Math.round(pos * 100)} percent of the scale">
<circle cx="${cx}" cy="${cy}" r="${R - W / 2 - 4}" fill="#0a2150"/>${o.join('')}<g class="gl">${lab}</g>
<path d="M${tx.toFixed(1)} ${ty.toFixed(1)}L${nx.toFixed(1)} ${ny.toFixed(1)}" stroke="rgba(0,0,0,.35)" stroke-width="10" stroke-linecap="round" transform="translate(0 3)"/>
<path d="M${tx.toFixed(1)} ${ty.toFixed(1)}L${nx.toFixed(1)} ${ny.toFixed(1)}" stroke="#f7f9fb" stroke-width="8" stroke-linecap="round"/>
<circle cx="${cx}" cy="${cy}" r="23" fill="#0b1826" stroke="#2a4a7c" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="14" fill="#cdd5dd" stroke="#0b1826" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="6" fill="#0b1826"/></svg>`;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = document.importNode(doc.documentElement, true);
  el.dataset.pos = String(Math.round(pos * 1000) / 1000);
  return el;
}
