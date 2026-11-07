// The four forms of 射 on the timeline, redrawn by hand as chalk lines (no ancient-script font is used).
// 100 × 100 box, y down. `o: true` marks the parts that carry the bow (orange in every form, same height).
// Oracle bone: incised, thin and angular. Bronze: cast, heavier and rounder, a hand (又) grips the arrow.
// Seal: even curves; the bow has bent into 身, the hand plus a mark has become 寸.
import { clamp } from '/core/lib.js';
import { Stroke, catmull } from './chalk.js';
import { writeChar } from './hand.js';

const FORMS = {
  oracle: { w: .019, round: false, lines: [
    { o: true, p: [[47, 11], [42, 6], [27, 19], [19, 50], [27, 81], [42, 94], [47, 89]] },      // stave, tips turned back
    { o: true, p: [[43, 8], [43, 92]], w: .6 },                                                   // string
    { p: [[78, 84], [17, 23]] },                                                                   // arrow shaft
    { p: [[31, 24], [17, 23], [18, 37]] },                                                         // arrowhead
    { p: [[70, 86], [78, 84], [80, 92]] }, { p: [[66, 80], [74, 78], [76, 86]] },                  // fletching
  ] },
  bronze: { w: .03, round: true, lines: [
    { o: true, p: [[49, 13], [43, 6], [30, 14], [20, 34], [17, 52], [21, 72], [31, 88], [43, 95], [49, 89]] },
    { o: true, p: [[44, 8], [43, 50], [44, 92]], w: .6 },
    { p: [[67, 74], [17, 22]] },
    { p: [[31, 22], [17, 22], [18, 36]] },
    { h: 1, p: [[68, 60], [80, 57], [88, 62], [89, 80], [90, 99]] },                                    // the hand (又) holding the nock: top finger and arm
    { h: 1, p: [[66, 71], [77, 70], [88, 71]] }, { h: 1, p: [[69, 82], [79, 81], [89, 82]] },                 // two more fingers (the same hand the seal keeps)
  ] },
  seal: { w: .024, round: true, lines: [
    { o: true, p: [[32, 5], [26, 9], [20, 14]] },
    { o: true, p: [[18, 15], [18, 40], [18, 64]] },
    { o: true, p: [[18, 15], [32, 13], [42, 14], [44, 26], [44, 60], [44, 80], [40, 92], [28, 96]] },
    { o: true, p: [[18, 30], [44, 30]] }, { o: true, p: [[18, 46], [44, 46]] },
    { o: true, p: [[5, 76], [28, 66], [54, 59]] },
    { o: true, p: [[45, 52], [32, 72], [8, 93]] },
    { p: [[60, 21], [74, 19], [83, 24], [85, 40], [84, 66], [86, 96]] },                          // 又 → 寸: top finger and the arm
    { p: [[62, 36], [74, 35], [84, 38]] }, { p: [[62, 51], [74, 50], [84, 53]] },                 // two more fingers
    { p: [[60, 70], [72, 76]] },                                                                   // the mark that makes 寸
  ] },
};

// returns Stroke[] with timing; `bowLast` writes the bow first so the orange appears as the form's first gesture
export function writeForm(kind, cx, cy, size, clock, o = {}) {
  if (kind === 'kai') return writeChar('射', cx, cy, size, clock, { ...o, colors: { 0: 'orange', 1: 'orange', 2: 'orange', 3: 'orange', 4: 'orange', 5: 'orange', 6: 'orange' } });
  const F = FORMS[kind], out = [], sc = size / 100; let t = clock;
  F.lines.forEach((L, i) => {
    const P = L.p.map(([x, y]) => [cx + (x - 50) * sc, cy + (y - 50) * sc]);
    const pts = F.round ? catmull(P, 10) : P;
    const st = new Stroke(pts, { kind: 'write', w: size * F.w * (L.w ?? 1), color: L.o ? 'orange' : 'white', taper: F.round ? .12 : .3, taperLen: .2,
      land: F.round ? .8 : .4, wob: size * .002, wav: size * .5, skip: .14, press: 1.02, endSpecks: true, specks: .7, seed: 400 + i * 9.1 + size, R: o.R });
    const d = clamp(.05 + st.len / (size * (o.speed ?? 6)), .07, .4);
    if (out.length) t += .035;
    if (L.h && o.handAt != null && t < o.handAt) t = o.handAt;      // the hand is drawn when the voice names it
    st.t0 = t; st.t1 = t + d; t += d; st.hand = !!L.h; out.push(st);
  });
  out.end = t;
  return out;
}
