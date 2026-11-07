// The things in the world that carry words: the cast-iron bridge plate, the dial thermometer, the board at the feeding
// field, and the plates of carved type in the sky (title and end card). All drawn on canvas, in ink and paper only.
import { mulberry } from '/core/lib.js';
import { INK, PAPER, cut } from './textures.js';

export const FONT = `'NotoSerifSC', serif`;
const font = (px) => `700 ${px}px ${FONT}`;

// letters cut into an ink ground: paper face, a hairline of ink inside each stroke edge, a few knife nicks
function carvedText(g, text, x, y, px, R, opts = {}) {
  g.font = font(px); g.textBaseline = 'alphabetic'; g.textAlign = opts.align || 'left';
  g.fillStyle = opts.col || PAPER; g.fillText(text, x, y);
  if (opts.nicks !== false) {
    const w = g.measureText(text).width, x0 = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
    g.save(); g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < w / 18; i++) { const xx = x0 + R() * w, yy = y - R() * px * .8; cut(g, xx, yy, xx + 6 + R() * 14, yy + (R() - .5) * 2, 1.6, R, INK); }
    g.restore();
  }
  return g.measureText(text).width;
}

// ------------------------------------------------------------------ the bridge plate: cast iron, raised letters
export function plateCanvas() {
  const W = 1100, H = 560, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), R = mulberry(31);
  g.fillStyle = INK; g.fillRect(0, 0, W, H);
  // a raised rim and four bolts
  g.strokeStyle = PAPER; g.lineWidth = 10; g.strokeRect(26, 26, W - 52, H - 52);
  g.lineWidth = 3; g.strokeRect(44, 44, W - 88, H - 88);
  for (const [x, y] of [[70, 70], [W - 70, 70], [70, H - 70], [W - 70, H - 70]]) { g.fillStyle = PAPER; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill(); g.fillStyle = INK; g.fillRect(x - 9, y - 2, 18, 4); }
  carvedText(g, '音羽橋', W / 2, 300, 210, R, { align: 'center', nicks: false });
  carvedText(g, 'Otowa Bridge', W / 2, 455, 96, R, { align: 'center', nicks: false });
  // rime on the top edge of the plate
  for (let i = 0; i < 60; i++) { const x = R() * W; cut(g, x, 4 + R() * 10, x + 10 + R() * 30, 6 + R() * 10, 5, R, PAPER); }
  return c;
}
// where each line sits on the plate, as fractions of its width and height (for the reading check)
export const PLATE_LINES = [
  { id: 'plate-cn', text: '音羽橋', u0: .2, u1: .8, v0: .17, v1: .58 },
  { id: 'plate-en', text: 'Otowa Bridge', u0: .2, u1: .8, v0: .66, v1: .86 },
];

// ------------------------------------------------------------------ an old dial thermometer: paper face, ink scale, needle on −20
export function dialCanvas() {
  const S = 600, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'), m = S / 2, R = mulberry(77);
  g.fillStyle = INK; g.beginPath(); g.arc(m, m, 296, 0, 7); g.fill();
  g.fillStyle = PAPER; g.beginPath(); g.arc(m, m, 262, 0, 7); g.fill();
  // scale −40 … +40 over 270°
  const ang = v => (-225 + (v + 40) / 80 * 270) * Math.PI / 180;
  g.strokeStyle = INK; g.lineCap = 'butt';
  for (let v = -40; v <= 40; v += 2) {
    const a = ang(v), r0 = v % 10 ? 222 : 200;
    g.lineWidth = v % 10 ? 4 : 9; g.beginPath(); g.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0); g.lineTo(m + Math.cos(a) * 248, m + Math.sin(a) * 248); g.stroke();
  }
  g.fillStyle = INK; g.font = font(46); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const v of [-40, -20, 0, 20, 40]) { const a = ang(v); g.fillText(v < 0 ? '−' + -v : String(v), m + Math.cos(a) * 160, m + Math.sin(a) * 160); }
  g.font = font(60); g.fillText('°C', m, m + 120);
  // the needle, on −20
  const a = ang(-20);
  g.strokeStyle = INK; g.lineWidth = 12; g.lineCap = 'round';
  g.beginPath(); g.moveTo(m - Math.cos(a) * 40, m - Math.sin(a) * 40); g.lineTo(m + Math.cos(a) * 236, m + Math.sin(a) * 236); g.stroke();
  g.fillStyle = INK; g.beginPath(); g.arc(m, m, 26, 0, 7); g.fill();
  // frost on the glass
  for (let i = 0; i < 26; i++) { const aa = R() * 7, r = 250 + R() * 30; cut(g, m + Math.cos(aa) * r, m + Math.sin(aa) * r, m + Math.cos(aa + .08) * (r - 20), m + Math.sin(aa + .08) * (r - 20), 4, R, PAPER); }
  return c;
}

// ------------------------------------------------------------------ the board at the feeding field
// Two counts side by side on one baseline, the status band under them: old status under 1952, the seal under 2025.
// Chinese and numbers only on the board; the English is in the subtitle bar.
// state: { date: 0..1, num: 0..1 (the 2025 column, cut in), strike: 0..1, stamp: 0..1 }
export const BOARD = { W: 2048, H: 1408 };
const M = 130;
const PIECES = [   // id, text, x, baseline, px, group
  ['b-head', '丹顶鹤 · 冬季清点', M, 190, 88, 'base'],
  ['b-d1', '1952 年冬', M, 380, 84, 'base'],
  ['b-n1', '33 只', M, 700, 0, 'base'],
  ['b-d2', '2025 年 1 月', 1110, 380, 84, 'date'],
  ['b-n2', '1,927 只', 1110, 700, 0, 'num'],
  ['b-lab', '保护等级', M + 50, 960, 72, 'base'],
  ['b-old', '易危', M + 50, 1150, 150, 'base'],
];
const NUM = 250, UNIT = 100;
function numeral(g, x, y, num, R) {   // a big carved numeral with its unit after it
  const w = carvedText(g, num, x - 8, y, NUM, R);
  carvedText(g, '只', x + w + 10, y, UNIT, R);
  return w + 10 + UNIT;
}
export function boardCanvas(c, st) {
  const { W, H } = BOARD;
  if (!c) { c = document.createElement('canvas'); c.width = W; c.height = H; }
  const g = c.getContext('2d'), R = mulberry(1952);
  g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
  g.fillStyle = INK; g.fillRect(0, 0, W, H);
  for (let p = 0; p < 3; p++) {
    const y0 = p * H / 3;
    g.fillStyle = '#2b2c31'; g.fillRect(0, y0 + H / 3 - 3, W, 6);
    for (let i = 0; i < 60; i++) { const y = y0 + 10 + R() * (H / 3 - 20), x = R() * W; cut(g, x, y, x + 60 + R() * 260, y + (R() - .5) * 4, 1.4 + R() * 1.4, R, '#34353b'); }
  }
  const clipCarve = (k, x, y, w, h, draw) => {   // the knife goes left to right; chips at its edge
    if (k <= 0) return;
    g.save(); g.beginPath(); g.rect(x - 10, y - h, (w + 30) * k, h * 1.35); g.clip(); draw(); g.restore();
    if (k < 1) { const xe = x + w * k; for (let i = 0; i < 8; i++) { const xx = xe + R() * 30, yy = y - R() * h; cut(g, xx, yy, xx + 8, yy - 6, 3, R, PAPER); } }
  };
  carvedText(g, '丹顶鹤 · 冬季清点', M, 190, 88, R);
  cut(g, M, 250, W - M, 252, 5, R, PAPER, .2);
  carvedText(g, '1952 年冬', M, 380, 84, R);
  numeral(g, M, 700, '33', R);
  cut(g, 1024, 300, 1026, 770, 5, R, PAPER, .2);
  // the empty column waits: two faint scored guide lines
  if (st.date <= 0) { g.strokeStyle = '#4a4b50'; g.lineWidth = 3; for (const y of [392, 712]) { g.beginPath(); g.moveTo(1110, y); g.lineTo(1900, y); g.stroke(); } }
  clipCarve(st.date, 1110, 380, 520, 90, () => carvedText(g, '2025 年 1 月', 1110, 380, 84, R));
  clipCarve(st.num, 1110, 700, 860, 260, () => numeral(g, 1110, 700, '1,927', R));

  // the pasted paper notice, the width of the board
  const by = 820, bh = 480;
  g.fillStyle = PAPER; g.beginPath(); g.moveTo(M - 24, by + 6); g.lineTo(W - M + 24, by); g.lineTo(W - M + 20, by + bh); g.lineTo(M - 18, by + bh - 4); g.closePath(); g.fill();
  g.strokeStyle = INK; g.lineWidth = 5; g.strokeRect(M + 8, by + 28, W - 2 * M - 16, bh - 56);
  g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = font(72); g.fillText('保护等级', M + 50, 960);
  g.font = font(150); g.fillText('易危', M + 50, 1150);
  if (st.strike > 0) cut(g, M + 20, 1095, M + 20 + 380 * st.strike, 1085, 24, mulberry(9), INK, .1);
  // the cut arrow from the old status toward the seal, under the 2025 column
  if (st.strike > 0) {   // the arrow is cut with the strike, pointing to where the seal will land
    const k = st.strike; cut(g, 560, 1095, 560 + 420 * k, 1095, 9, R, INK, .1);
    if (k >= 1) { g.beginPath(); g.moveTo(1004, 1095); g.lineTo(968, 1074); g.lineTo(968, 1116); g.fill(); }
  }
  if (st.stamp > 0) {
    const ss = 360 * (1 + .12 * (1 - st.stamp)), cx = 1110 + 180, cy = by + bh / 2;
    g.save(); g.translate(cx, cy); g.rotate(-.04); g.globalAlpha = Math.min(1, st.stamp * 1.5);
    g.fillStyle = INK; g.fillRect(-ss / 2, -ss / 2, ss, ss);
    g.fillStyle = PAPER; g.fillRect(-ss / 2 + 14, -ss / 2 + 14, ss - 28, ss - 28); g.fillStyle = INK; g.fillRect(-ss / 2 + 24, -ss / 2 + 24, ss - 48, ss - 48);
    const k = ss / 360; g.fillStyle = PAPER; g.textAlign = 'center';
    g.font = font(132 * k); g.fillText('近危', 0, 18 * k);
    g.font = font(66 * k); g.fillText('2026.3', 0, 128 * k);
    const r = mulberry(5); g.fillStyle = INK; for (let i = 0; i < 50; i++) g.fillRect((r() - .5) * ss * .85, (r() - .5) * ss * .85, 3 + r() * 6, 2 + r() * 4);
    g.restore();
    g.globalAlpha = Math.min(1, st.stamp * 1.5); g.fillStyle = INK; g.textAlign = 'left';
    g.font = font(76); g.fillText('已移出濒危', 1520, 1090); g.globalAlpha = 1;
  }
  g.restore();
  return c;
}
// where each read piece is on the board (canvas px), for the reading check
export function boardPieces(st) {
  const g = document.createElement('canvas').getContext('2d'), out = [];
  const box = (id, text, x, y, px, w) => { g.font = font(px); w = w ?? g.measureText(text).width; out.push({ id, text, x0: x, y0: y - px * .88, x1: x + w, y1: y + px * .14 }); };
  box('b-head', '丹顶鹤 · 冬季清点', M, 190, 88);
  box('b-d1', '1952 年冬', M, 380, 84);
  g.font = font(NUM); const w33 = g.measureText('33').width + 10 + UNIT, w19 = g.measureText('1,927').width + 10 + UNIT;
  box('b-n1', '33 只', M, 700, NUM * .74, w33);
  if (st.date > 0) box('b-d2', '2025 年 1 月', 1110, 380, 84);
  if (st.num > 0) box('b-n2', '1,927 只', 1110, 700, NUM * .74, w19);
  box('b-lab', '保护等级', M + 50, 960, 72);
  box('b-old', '易危', M + 50, 1150, 150);
  if (st.stamp > .5) {
    out.push({ id: 's-cn', text: '近危', x0: 1290 - 130, y0: 1060 - 120, x1: 1290 + 130, y1: 1060 + 25 });
    out.push({ id: 's-date', text: '2026.3', x0: 1290 - 105, y0: 1060 + 70, x1: 1290 + 105, y1: 1060 + 135 });
    box('s-note', '已移出濒危', 1520, 1090, 76);
  }
  return out;
}

// ------------------------------------------------------------------ plates of carved type for the sky (title, end card)
// lines: [{text, px, y}], returns the canvas and each line's box as fractions of the canvas
export function skyTypeCanvas(lines, W = 2400, H = 820) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), R = mulberry(4);
  const boxes = [];
  for (const L of lines) {
    const w = carvedText(g, L.text, L.x ?? 40, L.y, L.px, R, { nicks: true });
    boxes.push({ id: L.id, text: L.text, u0: (L.x ?? 40) / W, u1: ((L.x ?? 40) + w) / W, v0: (L.y - L.px * .92) / H, v1: (L.y + L.px * .22) / H });
  }
  return { c, boxes };
}
