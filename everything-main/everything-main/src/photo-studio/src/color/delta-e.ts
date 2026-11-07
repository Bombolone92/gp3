// Color differences between CIE L*a*b* triples.
// CIEDE2000 follows Luo, Cui & Rigg (2001) with the implementation notes of
// Sharma, Wu & Dalal, "The CIEDE2000 Color-Difference Formula" (2005): mean
// hue handling across the 0/360 discontinuity and h' = 0 for achromatic pairs.
const RAD = Math.PI / 180;
const POW25_7 = 25 ** 7;

export function deltaE76(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function deltaE2000(
  lab1: ArrayLike<number>,
  lab2: ArrayLike<number>,
  kL = 1,
  kC = 1,
  kH = 1,
): number {
  const L1 = lab1[0],
    a1 = lab1[1],
    b1 = lab1[2];
  const L2 = lab2[0],
    a2 = lab2[1],
    b2 = lab2[2];
  const C1 = Math.hypot(a1, b1),
    C2 = Math.hypot(a2, b2);
  const Cm7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + POW25_7)));
  const a1p = (1 + G) * a1,
    a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1),
    C2p = Math.hypot(a2p, b2);
  const hue = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p),
    h2p = hue(b2, a2p);
  const dLp = L2 - L1,
    dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
  const Lmp = (L1 + L2) / 2,
    Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hmp /= 2;
    else hmp = hmp < 360 ? (hmp + 360) / 2 : (hmp - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hmp - 30) * RAD) +
    0.24 * Math.cos(2 * hmp * RAD) +
    0.32 * Math.cos((3 * hmp + 6) * RAD) -
    0.2 * Math.cos((4 * hmp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2));
  const Cmp7 = Cmp ** 7;
  const RC = 2 * Math.sqrt(Cmp7 / (Cmp7 + POW25_7));
  const l50 = (Lmp - 50) ** 2;
  const SL = 1 + (0.015 * l50) / Math.sqrt(20 + l50);
  const SC = 1 + 0.045 * Cmp,
    SH = 1 + 0.015 * Cmp * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;
  const l = dLp / (kL * SL),
    c = dCp / (kC * SC),
    h = dHp / (kH * SH);
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}
