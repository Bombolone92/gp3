// scenes.js · the cities of "The Long Way Home", as full-bleed 16:9 prints (1920×1080 u), ink layers in print order.
// A scene = { parts: [{ pull, ink, path, knock?, lit? }] }. `pull` names the squeegee pass that prints the part (one pass may carry
// several parts); `ink` is a palette key: sky1 sky2 far mid near sun glow. Landmarks are stylised silhouettes, not traced from photos.
import { mulberry, polyPath, circlePath, ringPath, rectPath, unionPath, bandSteps, lerp } from './silk.js';

export const AW = 1920, AH = 1080, BLEED = 60;
const FULL = () => rectPath(-BLEED, -BLEED, AW + 2 * BLEED, AH + 2 * BLEED);

function blob(p, x, y, rx, ry, a0 = 0, a1 = Math.PI * 2) { p.moveTo(x + rx * Math.cos(a0), y + ry * Math.sin(a0)); p.ellipse(x, y, rx, ry, 0, a0, a1); p.closePath(); }
// a cypress crown: overlapping flat-bottomed clumps (one outline, no strokes)
function cypress(p, x, base, h, w, seed) {
  const r = mulberry(seed);
  p.rect(x - w * .035, base - h * .45, w * .07, h * .45 + 30);                    // trunk
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), cy = base - h * (.35 + .62 * t), cw = w * (.5 - .32 * t) * (.8 + .4 * r()), ch = h * (.13 + .04 * r());
    const cx = x + (r() - .5) * w * .28;
    blob(p, cx, cy, cw, ch);
    if (r() < .7) blob(p, cx + cw * (r() < .5 ? -.7 : .7), cy + ch * .3, cw * .55, ch * .8);
  }
}
// a conical eave roof seen from the front: concave slopes, eave tips flaring up
function roof(cx, yBot, wBot, yTop, wTop, flare = 12) {
  const pts = [];
  const k = 8;
  for (let i = 0; i <= k; i++) { const t = i / k, y = lerp(yBot - flare, yTop, t), w = lerp(wBot, wTop, 1 - Math.pow(1 - t, 1.7)); pts.push([cx - w, y]); }
  const R = pts.slice().reverse().map(([x, y]) => [2 * cx - x, y]);
  return polyPath([[cx - wBot + 22, yBot + 4], ...pts, ...R, [cx + wBot - 22, yBot + 4]]);
}
function roofLit(cx, yBot, wBot, yTop, wTop, flare = 12) {     // the left (sun-facing) half, a jagged-edged lit face
  const pts = [[cx - wBot + 22, yBot + 4]], k = 8;
  for (let i = 0; i <= k; i++) { const t = i / k, y = lerp(yBot - flare, yTop, t), w = lerp(wBot, wTop, 1 - Math.pow(1 - t, 1.7)); pts.push([cx - w, y]); }
  pts.push([cx - wTop * .2, yTop + 2], [cx - wBot * .32, yBot - (yBot - yTop) * .35], [cx - wBot * .42, yBot + 4]);
  return polyPath(pts);
}

// ================= BEIJING · Temple of Heaven, Hall of Prayer for Good Harvests (dawn) =================
export function temple(seed = 3) {
  const CX = 820, SUN = [1240, 452], SR = 86;
  // sky
  const sunKnock = unionPath([circlePath(SUN[0], SUN[1], SR + 9), ringPath(SUN[0], SUN[1], SR + 30, SR + 40), ringPath(SUN[0], SUN[1], SR + 64, SR + 71)]);
  const sky2 = new Path2D(); sky2.rect(-BLEED, -BLEED, AW + 2 * BLEED, 170 + BLEED); sky2.addPath(bandSteps(-BLEED, AW + 2 * BLEED, 150, 470, 6, 14));
  // hall + terraces (their silhouette is knocked out of the woods and the ground, so the marble stays bare paper)
  const T1 = [CX - 480, 806, 960, 50], T2 = [CX - 396, 766, 792, 40], T3 = [CX - 312, 728, 624, 38];
  const terr = unionPath([rectPath(...T1), rectPath(...T2), rectPath(...T3)]);
  const R1 = [CX, 642, 300, 594, 178], R2 = [CX, 556, 252, 512, 142], R3 = [CX, 476, 212, 416, 34];
  const roofs = unionPath([roof(...R1), roof(...R2), roof(...R3, 10)]);
  const drums = unionPath([rectPath(CX - 202, 652, 404, 76), rectPath(CX - 166, 566, 332, 28), rectPath(CX - 130, 486, 260, 26)]);
  const finial = unionPath([circlePath(CX, 384, 14), rectPath(CX - 5, 398, 10, 10), polyPath([[CX - 12, 408], [CX + 12, 408], [CX + 22, 416], [CX - 22, 416]])]);
  const hallSil = unionPath([roofs, drums, finial]);
  const sil = unionPath([terr, hallSil]);
  // far: the old cypress woods and the round enclosure wall behind the hall
  const far = new Path2D();
  { const r = mulberry(seed + 4); far.rect(-BLEED, 690, AW + 2 * BLEED, 500);
    for (let x = -BLEED; x < AW + BLEED; x += 46 + r() * 40) blob(far, x, 690 - r() * 34, 40 + r() * 46, 28 + r() * 26); }
  const wall = rectPath(-BLEED, 744, AW + 2 * BLEED, 26);            // enclosure wall: a lighter band (glow) across the woods
  // mid: the blue tiled roofs; under-eave shadows; the terrace shadows and stair treads
  const eaves = unionPath([rectPath(CX - 262, 642, 524, 12), rectPath(CX - 216, 556, 432, 10), rectPath(CX - 178, 476, 356, 10)]);
  const terrShade = unionPath([rectPath(T1[0], T1[1], T1[2], 9), rectPath(T2[0], T2[1], T2[2], 8), rectPath(T3[0], T3[1], T3[2], 8),
    ...[0, 1, 2].map(i => { const t = [T1, T2, T3][i]; const post = new Path2D(); for (let x = t[0] + 14; x < t[0] + t[2] - 8; x += 26) post.rect(x, t[1] - 13, 6, 13); return post; })]);
  const stair = new Path2D(); for (let y = 732; y < 852; y += 10) stair.rect(CX - 62, y, 124, 3.5);
  // near: ground with the raised walkway knocked out (paper), the big cypresses, the doors in the drums, birds
  const ground = polyPath([[-BLEED, 856], [AW + BLEED, 856], [AW + BLEED, AH + BLEED], [-BLEED, AH + BLEED]]);
  const walk = polyPath([[CX - 120, 856], [CX + 120, 856], [CX + 360, AH + BLEED], [CX - 360, AH + BLEED]]);
  const walkLines = new Path2D(); for (let i = 1; i < 7; i++) { const y = 856 + Math.pow(i / 7, 1.6) * 260; const w = lerp(120, 360, (y - 856) / (AH + BLEED - 856)); walkLines.rect(CX - w, y, 2 * w, 3 + i); }
  const trees = new Path2D();
  cypress(trees, 150, 1100, 660, 470, seed + 11); cypress(trees, 400, 1110, 470, 330, seed + 12); cypress(trees, -40, 1100, 800, 380, seed + 13);
  cypress(trees, 1350, 1110, 470, 330, seed + 14); cypress(trees, 1560, 1110, 640, 460, seed + 15); cypress(trees, 1860, 1100, 820, 520, seed + 16);
  const doors = new Path2D(); for (let i = -3; i <= 3; i++) doors.rect(CX + i * 52 - 9, 664, 18, 58);
  for (let i = -2; i <= 2; i++) doors.rect(CX + i * 56 - 7, 570, 14, 20);
  for (let i = -2; i <= 2; i++) doors.rect(CX + i * 44 - 6, 490, 12, 18);
  const birds = new Path2D();
  for (const [x, y, s] of [[560, 300, 1], [612, 270, .8], [520, 252, .65], [1010, 330, .7]]) birds.addPath(polyPath([[x - 24 * s, y - 6 * s], [x - 11 * s, y - 10 * s], [x, y], [x + 11 * s, y - 10 * s], [x + 24 * s, y - 6 * s], [x + 11 * s, y - 5 * s], [x, y + 5 * s], [x - 11 * s, y - 5 * s]]));
  // lit faces: the sun side of each roof (glow), the cypress tops (mid)
  const lit = unionPath([roofLit(...R1), roofLit(...R2), roofLit(...R3, 10)]);
  const crownsLit = new Path2D(); { const r = mulberry(seed + 21); for (const [x, base, h, w] of [[150, 1100, 760, 560], [380, 1110, 520, 360], [1560, 1110, 640, 460], [1860, 1100, 820, 520]]) for (let i = 0; i < 4; i++) { const t = (i + 1) / 6, cy = base - h * (.35 + .62 * t) - h * .05, cw = w * (.5 - .32 * t) * .55; blob(crownsLit, x - cw * .4 + (r() - .5) * 20, cy, cw, h * .045, Math.PI, Math.PI * 2); } }
  return {
    sun: SUN, focus: [CX, 600], header: { x: 104, y: 214, size: 150 },
    depth: { sun: .1, sky1: 0, sky2: 0, far: .3, mid: .6, near: .9, acc: .6, lit: .6 },
    parts: [
      { pull: 'sun', ink: 'sun', path: circlePath(SUN[0], SUN[1], SR) },
      { pull: 'sky1', ink: 'sky1', path: FULL(), knock: sunKnock, cut: unionPath([terr, walk]) },
      { pull: 'sky2', ink: 'sky2', path: sky2 },
      { pull: 'far', ink: 'far', path: far, cut: unionPath([sil, walk]) },
      { pull: 'mid', ink: 'mid', path: unionPath([roofs, eaves]) },
      { pull: 'mid', ink: 'far', path: unionPath([terrShade, stair]), lit: 1 },
      { pull: 'near', ink: 'mid', path: ground, cut: unionPath([walk, sil]) },
      { pull: 'near', ink: 'near', path: unionPath([trees, doors, birds]) },
      { pull: 'near', ink: 'far', path: walkLines, lit: 1 },
      { pull: 'acc', ink: 'sun', path: unionPath([drums, finial]), knock: doors },
      { pull: 'lit', ink: 'glow', path: lit, lit: 1 },
    ],
  };
}

// ---------------- shared helpers for the other cities ----------------
function halfDome(p, cx, cy, rx, ry) { p.moveTo(cx - rx, cy); p.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2); p.closePath(); }
function waterBars(x0, x1, y0, y1, n, seed, len = 220) {
  const p = new Path2D(), r = mulberry(seed);
  for (let i = 0; i < n; i++) {
    const k = i / n, y = y0 + (y1 - y0) * Math.pow(k, 1.5), th = 2.5 + 16 * Math.pow(k, 1.4);
    let x = x0 + r() * 80;
    while (x < x1) { const L = len * (.5 + r()), g = 30 + r() * 90 * (.4 + k); p.rect(x, y, L, th); x += L + g; }
  }
  return p;
}
const bird = (p, x, y, s) => p.addPath(polyPath([[x - 24 * s, y - 6 * s], [x - 11 * s, y - 10 * s], [x, y], [x + 11 * s, y - 10 * s], [x + 24 * s, y - 6 * s], [x + 11 * s, y - 5 * s], [x, y + 5 * s], [x - 11 * s, y - 5 * s]]));
function sunParts(x, y, r) {
  return { disc: circlePath(x, y, r), knock: unionPath([circlePath(x, y, r + 9), ringPath(x, y, r + 28, r + 37), ringPath(x, y, r + 58, r + 64)]) };
}

// ================= ISTANBUL · Hagia Sophia across the water (afternoon) =================
export function istanbul(seed = 7) {
  const CX = 860, W0 = AW, H0 = AH, SUN = sunParts(1270, 300, 66);
  const sky2 = new Path2D(); sky2.rect(-BLEED, -BLEED, W0 + 2 * BLEED, 140 + BLEED); sky2.addPath(bandSteps(-BLEED, W0 + 2 * BLEED, 120, 400, 6, 10));
  // far: the opposite shore, low hills with tiny domes, and the water bars below
  const hills = polyPath([[-BLEED, 650], [-BLEED, 600], [180, 584], [420, 596], [640, 572], [900, 590], [1180, 566], [1460, 588], [1700, 574], [W0 + BLEED, 590], [W0 + BLEED, 650]]);
  const farBits = new Path2D(); halfDome(farBits, 1250, 568, 26, 18); farBits.rect(1290, 520, 7, 50); halfDome(farBits, 1560, 578, 20, 14); farBits.rect(1520, 536, 6, 44);
  const water = waterBars(-BLEED, W0 + BLEED, 760, 1100, 12, seed + 3);
  // mid: the building mass (rose stone) and the four minaret shafts
  const body = unionPath([rectPath(CX - 300, 556, 600, 150), rectPath(CX - 430, 616, 130, 90), rectPath(CX + 300, 616, 130, 90),
    rectPath(CX - 266, 470, 70, 88), rectPath(CX + 196, 470, 70, 88), rectPath(CX - 172, 420, 344, 52)]);
  const mins = new Path2D();
  for (const [x, top] of [[CX - 520, 250], [CX - 450, 300], [CX + 450, 300], [CX + 520, 250]]) {
    mins.rect(x - 11, top, 22, 706 - top); mins.rect(x - 17, top + 90, 34, 10); mins.rect(x - 17, top + 220, 34, 10);
    mins.addPath(polyPath([[x - 13, top + 2], [x, top - 70], [x + 13, top + 2]]));
  }
  // near: domes, windows, the quay, a ferry, gulls
  const domes = new Path2D(); halfDome(domes, CX, 424, 196, 128); halfDome(domes, CX - 212, 558, 112, 70); halfDome(domes, CX + 212, 558, 112, 70);
  halfDome(domes, CX - 366, 618, 62, 40); halfDome(domes, CX + 366, 618, 62, 40);
  const win = new Path2D();
  for (let i = -6; i <= 6; i++) win.rect(CX + i * 24 - 6, 434, 12, 26);
  for (let i = -5; i <= 5; i++) win.rect(CX + i * 46 - 9, 600, 18, 34);
  for (let i = -5; i <= 5; i++) win.rect(CX + i * 46 - 8, 652, 16, 30);
  const quay = rectPath(-BLEED, 704, W0 + 2 * BLEED, 52);
  const ferry = new Path2D(); ferry.addPath(polyPath([[150, 892], [520, 892], [490, 940], [190, 940]])); ferry.rect(230, 852, 220, 42); ferry.rect(300, 818, 60, 36); ferry.rect(318, 790, 22, 30);
  const ferryWin = new Path2D(); for (let i = 0; i < 7; i++) ferryWin.rect(244 + i * 29, 862, 16, 16);
  const birds = new Path2D(); bird(birds, 1180, 360, .9); bird(birds, 1240, 320, .7); bird(birds, 1120, 300, .6); bird(birds, 640, 820, .8);
  // lit faces (sun from the right): right halves of the domes, the right side of each minaret
  const lit = new Path2D();
  for (const [cx, cy, rx, ry] of [[CX, 424, 196, 128], [CX - 212, 558, 112, 70], [CX + 212, 558, 112, 70], [CX + 366, 618, 62, 40]]) { lit.moveTo(cx + rx * .15, cy); lit.ellipse(cx, cy, rx, ry, 0, -Math.PI * .42, 0); lit.lineTo(cx + rx * .15, cy); lit.closePath(); }
  const finials = new Path2D(); for (const [x, top] of [[CX - 520, 250], [CX - 450, 300], [CX + 450, 300], [CX + 520, 250]]) finials.addPath(circlePath(x, top - 76, 6)); finials.addPath(circlePath(CX, 288, 8));
  return {
    w: W0, h: H0, header: { x: 104, y: 214, size: 150 },
    depth: { sky: 0, far: .25, mid: .55, near: .85, acc: .55, lit: .55 },
    parts: [
      { pull: 'sky', ink: 'sky1', path: rectPath(-BLEED, -BLEED, W0 + 2 * BLEED, H0 + 2 * BLEED), knock: SUN.knock },
      { pull: 'sky', ink: 'sky2', path: sky2 },
      { pull: 'far', ink: 'far', path: unionPath([hills, farBits]) },
      { pull: 'far', ink: 'far', path: water, lit: 1 },
      { pull: 'mid', ink: 'mid', path: unionPath([body, mins]) },
      { pull: 'near', ink: 'near', path: unionPath([domes, win, quay, ferry, birds]), cut: ferryWin },
      { pull: 'acc', ink: 'sun', path: unionPath([SUN.disc, finials]) },
      { pull: 'lit', ink: 'glow', path: lit, lit: 1 },
    ],
  };
}

// ================= PARIS · the Eiffel Tower (morning), a tall print for a crane move =================
export function paris(seed = 9) {
  const W0 = AW, H0 = 1620, CX = 960, BASE = 1560, SUN = sunParts(520, 600, 72);
  const sky2 = new Path2D(); sky2.rect(-BLEED, -BLEED, W0 + 2 * BLEED, 240 + BLEED); sky2.addPath(bandSteps(-BLEED, W0 + 2 * BLEED, 220, 720, 7, 12));
  // the tower: one outline, then its openings knocked out to whatever is behind
  const prof = [[420, BASE], [330, 1430], [232, 1330], [226, 1292], [150, 1150], [104, 1022], [118, 1004], [70, 860], [42, 680], [26, 470], [30, 452], [18, 400], [12, 330], [3, 250], [2, 130]];
  const tower = polyPath([...prof.map(([x, y]) => [CX - x, y]), ...prof.slice().reverse().map(([x, y]) => [CX + x, y])]);
  const open = new Path2D();
  open.moveTo(CX - 262, BASE + 2); open.ellipse(CX, BASE + 2, 262, 228, 0, Math.PI, Math.PI * 2); open.closePath();          // the big arch
  open.addPath(polyPath([[CX - 150, 1286], [CX + 150, 1286], [CX + 56, 1030], [CX - 56, 1030]]));
  open.addPath(polyPath([[CX - 34, 996], [CX + 34, 996], [CX + 12, 600], [CX - 12, 600]]));
  for (let k = 0; k < 6; k++) {                                                                                           // lattice: diamonds down each leg
    const y = 1060 + k * 40, w = lerp(108, 205, k / 5);
    for (const s of [-1, 1]) { const x = CX + s * (w - 22); open.addPath(polyPath([[x, y - 14], [x + 9, y], [x, y + 14], [x - 9, y]])); }
  }
  // far: distant roofs and chimneys; mid: nearer mansard blocks left and right
  const far = new Path2D(); { const r = mulberry(seed + 2); far.rect(-BLEED, 1400, W0 + 2 * BLEED, 300); for (let x = -BLEED; x < W0 + BLEED; x += 70 + r() * 70) { far.rect(x, 1370 - r() * 50, 50 + r() * 60, 80); far.rect(x + 10, 1340 - r() * 50, 10, 40); } }
  const mid = new Path2D();
  for (const [x0, x1, top] of [[-BLEED, 560, 1300], [1380, W0 + BLEED, 1320]]) {
    mid.addPath(polyPath([[x0, top + 50], [x0 + 30, top], [x1 - 30, top], [x1, top + 50], [x1, H0 + BLEED], [x0, H0 + BLEED]]));
    for (let x = x0 + 60; x < x1 - 40; x += 120) mid.rect(x, top - 34, 24, 36);
  }
  const midWin = new Path2D(); for (const [x0, x1, top] of [[-BLEED, 560, 1300], [1380, W0 + BLEED, 1320]]) for (let x = x0 + 40; x < x1 - 40; x += 70) { midWin.rect(x, top + 20, 24, 22); midWin.rect(x, top + 100, 24, 40); midWin.rect(x, top + 190, 24, 40); }
  const awn = new Path2D(); for (const [x0, x1, top] of [[-BLEED, 560, 1300], [1380, W0 + BLEED, 1320]]) for (let x = x0 + 34; x < x1 - 40; x += 140) awn.addPath(polyPath([[x, top + 262], [x + 40, top + 262], [x + 46, top + 286], [x - 6, top + 286]]));
  // near: the tower, park trees at its foot, lamp posts, birds
  const trees = new Path2D(); { const r = mulberry(seed + 5); for (let x = 520; x < 1420; x += 60 + r() * 40) { const rr = 40 + r() * 30; trees.moveTo(x + rr, 1530); trees.ellipse(x, 1530, rr, rr * .8, 0, 0, Math.PI * 2); trees.closePath(); } trees.rect(500, 1540, 940, 200); }
  const birds = new Path2D(); bird(birds, 1240, 520, .9); bird(birds, 1300, 480, .7); bird(birds, 1190, 456, .6);
  // lit face: the left (sunward) edge of the tower
  const litProf = prof.map(([x, y]) => [CX - x, y]), litIn = prof.map(([x, y]) => [CX - x * .62, y]).reverse();
  const lit = polyPath([...litProf, ...litIn]);
  return {
    w: W0, h: H0, header: { x: 104, y: 900, size: 150 },
    depth: { sky: 0, far: .25, mid: .55, near: 1, acc: .4, lit: 1 },
    parts: [
      { pull: 'sky', ink: 'sky1', path: rectPath(-BLEED, -BLEED, W0 + 2 * BLEED, H0 + 2 * BLEED), knock: SUN.knock },
      { pull: 'sky', ink: 'sky2', path: sky2 },
      { pull: 'far', ink: 'far', path: far },
      { pull: 'mid', ink: 'mid', path: mid },
      { pull: 'mid', ink: 'glow', path: midWin, lit: 1 },
      { pull: 'near', ink: 'near', path: tower, knock: open },
      { pull: 'near', ink: 'near', path: unionPath([trees, birds]) },
      { pull: 'acc', ink: 'sun', path: unionPath([SUN.disc, awn]) },
      { pull: 'lit', ink: 'glow', path: lit, cut: open, lit: 1 },
    ],
  };
}

// ================= BUENOS AIRES · La Boca houses and the Obelisco (bright noon), a wide print for a truck =================
export const BOCA_INKS = ['#D9483B', '#F2B63D', '#2F86B5', '#4E9C5E', '#E07B4A', '#8E5BA6'];
export function boca(seed = 13) {
  const W0 = 2600, H0 = AH, SUN = sunParts(2280, 230, 56), OB = 1300;
  const sky2 = new Path2D(); sky2.rect(-BLEED, -BLEED, W0 + 2 * BLEED, 120 + BLEED); sky2.addPath(bandSteps(-BLEED, W0 + 2 * BLEED, 100, 380, 6, 10));
  // the Obelisco is bare paper (knocked out of the sky inks), with its shade side in far ink
  const obel = polyPath([[OB - 34, 640], [OB - 26, 190], [OB, 130], [OB + 26, 190], [OB + 34, 640]]);
  const obShade = polyPath([[OB + 2, 640], [OB + 2, 140], [OB + 26, 190], [OB + 34, 640]]);
  const city = new Path2D(); { const r = mulberry(seed + 2); city.rect(-BLEED, 600, W0 + 2 * BLEED, 500); for (let x = -BLEED; x < W0 + BLEED; x += 80 + r() * 90) city.rect(x, 520 + r() * 60, 60 + r() * 70, 120); }
  // the houses: one silhouette, coloured by a split-fountain bead (segments along x)
  const houses = new Path2D(), r = mulberry(seed + 4), H = [], segs = [];
  let x = -BLEED, k = 0;
  while (x < W0 + BLEED) {
    const w = 170 + r() * 120, top = 470 + r() * 110; H.push([x, w, top]);
    houses.addPath(polyPath([[x, top + 26], [x + w * .5, top - 6], [x + w, top + 26], [x + w, H0 + BLEED], [x, H0 + BLEED]]));
    segs.push({ x0: x, x1: x + w, color: BOCA_INKS[(k * 3 + (k >> 1)) % BOCA_INKS.length] });
    x += w; k++;
  }
  // near: roof caps, corrugation, windows and doors, balconies, laundry, the street, a lamp post
  const det = new Path2D(), win = new Path2D();
  for (const [hx, w, top] of H) {
    det.addPath(polyPath([[hx - 8, top + 30], [hx + w * .5, top - 10], [hx + w + 8, top + 30], [hx + w + 8, top + 40], [hx + w * .5, top + 4], [hx - 8, top + 40]]));
    for (let y = top + 70; y < 1000; y += 16) det.rect(hx + 6, y, w - 12, 3);
    for (let c = 0; c < 2; c++) { win.rect(hx + w * (.2 + .42 * c), top + 120, w * .2, 70); win.rect(hx + w * (.2 + .42 * c), top + 300, w * .2, 110); }
    det.rect(hx + 4, top + 210, w - 8, 10);                                   // balcony slab
    for (let b = 0; b < 8; b++) det.rect(hx + 8 + b * (w - 16) / 7, top + 220, 4, 34);
    det.rect(hx + w * .4, 1000 - 150, w * .2, 150);                           // door
  }
  det.rect(-BLEED, 1000, W0 + 2 * BLEED, 120);
  det.rect(1880, 560, 12, 440); det.rect(1860, 556, 52, 14);
  const laundry = new Path2D(); for (const [x0, y0] of [[420, 700], [1500, 690], [2200, 720]]) { laundry.rect(x0, y0, 260, 3); for (let i = 0; i < 5; i++) laundry.rect(x0 + 20 + i * 48, y0 + 3, 26, 34 + (i % 2) * 14); }
  const birds = new Path2D(); bird(birds, 900, 300, .8); bird(birds, 960, 270, .6);
  return {
    w: W0, h: H0, header: { x: 820, y: 214, size: 124 },
    depth: { sky: 0, far: .3, houses: .7, near: .9, acc: .5 },
    fountain: segs,
    parts: [
      { pull: 'sky', ink: 'sky1', path: rectPath(-BLEED, -BLEED, W0 + 2 * BLEED, H0 + 2 * BLEED), knock: unionPath([SUN.knock, obel]) },
      { pull: 'sky', ink: 'sky2', path: sky2, cut: obel },
      { pull: 'far', ink: 'far', path: city, cut: obel },
      { pull: 'far', ink: 'far', path: obShade },
      { pull: 'houses', ink: 'fountain', path: houses },
      { pull: 'near', ink: 'near', path: unionPath([det, birds]) },
      { pull: 'near', ink: 'glow', path: win, lit: 1 },
      { pull: 'acc', ink: 'sun', path: unionPath([SUN.disc, laundry]) },
    ],
  };
}

// ================= the night sea on the way home: a very wide print for a long truck =================
export function sea(seed = 17) {
  const W0 = 5200, H0 = AH, MOON = sunParts(3700, 300, 64), HOR = 640;
  // stars are bare paper, knocked out of the night sky (one per grid cell, so they never overlap)
  const stars = new Path2D(); { const r = mulberry(seed + 1); for (let gx = 0; gx < W0; gx += 90) for (let gy = 20; gy < 520; gy += 70) { if (r() < .45) continue; const x = gx + r() * 70, y = gy + r() * 50, s = 1.6 + r() * 2.6; if (Math.hypot(x - 3700, y - 300) < 140) continue; stars.moveTo(x + s, y); stars.arc(x, y, s, 0, Math.PI * 2); } }
  const sky2 = new Path2D(); sky2.rect(-BLEED, -BLEED, W0 + 2 * BLEED, 160 + BLEED); sky2.addPath(bandSteps(-BLEED, W0 + 2 * BLEED, 140, 420, 6, 8));
  const clouds = new Path2D(); { const r = mulberry(seed + 3); for (let i = 0; i < 16; i++) { const x = r() * W0, y = 380 + r() * 170, w = 260 + r() * 420, h = 14 + r() * 16; clouds.moveTo(x + h, y); clouds.arc(x + h, y + h, h, -Math.PI / 2, Math.PI / 2, true); clouds.lineTo(x + w - h, y + 2 * h); clouds.arc(x + w - h, y + h, h, Math.PI / 2, -Math.PI / 2, true); clouds.closePath(); } }
  const isles = new Path2D(); for (const [x0, w, h] of [[600, 420, 40], [1900, 260, 26], [2900, 520, 52], [4400, 360, 34]]) isles.addPath(polyPath([[x0, HOR + 2], [x0 + w * .3, HOR - h], [x0 + w * .55, HOR - h * .7], [x0 + w * .8, HOR - h * .9], [x0 + w, HOR + 2]]));
  const water = rectPath(-BLEED, HOR, W0 + 2 * BLEED, H0 - HOR + BLEED);
  const glint = new Path2D(); for (let i = 0; i < 12; i++) { const y = HOR + 14 + i * 30 + i * i * 2, w = 150 - i * 7 + (i % 2) * 20; glint.rect(3700 - w / 2 + ((i * 37) % 23) - 11, y, w, 4 + i * .8); }
  const waves = waterBars(-BLEED, W0 + BLEED, HOR + 30, 1100, 12, seed + 5, 260);
  const crests = new Path2D(); for (let x = -BLEED; x < W0 + BLEED; x += 140) { crests.moveTo(x, 1100); crests.quadraticCurveTo(x + 40, 1000, x + 90, 1010); crests.quadraticCurveTo(x + 60, 1030, x + 140, 1100); crests.closePath(); }
  return {
    w: W0, h: H0, header: null,
    depth: { sky: 0, far: .3, mid: .6, near: .9, acc: .3 },
    parts: [
      { pull: 'sky', ink: 'sky1', path: rectPath(-BLEED, -BLEED, W0 + 2 * BLEED, HOR + BLEED), knock: unionPath([MOON.knock, stars]) },
      { pull: 'sky', ink: 'sky2', path: sky2, cut: stars },
      { pull: 'far', ink: 'far', path: unionPath([clouds, isles]) },
      { pull: 'mid', ink: 'mid', path: water, knock: glint },
      { pull: 'mid', ink: 'glow', path: waves, lit: 1, cut: glint },
      { pull: 'near', ink: 'near', path: crests },
      { pull: 'acc', ink: 'sun', path: MOON.disc },
    ],
  };
}
