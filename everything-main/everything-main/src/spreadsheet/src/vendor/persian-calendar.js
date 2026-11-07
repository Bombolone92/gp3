// Adapted from .NET CalendricalCalculationsHelper, MIT licensed.
// Copyright (c) .NET Foundation and Contributors. See DOTNET-LICENSE.txt.
// Upstream revision: 60685192899cbd2f47534e17dc2861bfd7cb77b9
// https://github.com/dotnet/runtime/blob/60685192899cbd2f47534e17dc2861bfd7cb77b9/src/libraries/System.Private.CoreLib/src/System/Globalization/CalendricalCalculationsHelper.cs
// Solar longitude, ephemeris correction and apparent noon determine the
// astronomical Persian new year. Fixed leap-year cycles diverge from Office.

const DAY_MS = 86400000;
const UNIX_EPOCH_DAY = 719162; // Zero-based days since Gregorian 0001-01-01.
const TROPICAL_YEAR = 365.242189;
const days = (y, m, d) => Date.UTC(y, m - 1, d) / DAY_MS + UNIX_EPOCH_DAY;
const sin = a => Math.sin(a * Math.PI / 180);
const cos = a => Math.cos(a * Math.PI / 180);
const longitude = a => a - 360 * Math.floor((a + 180) / 360);
const polynomial = (coefficients, x) => {
  let result = coefficients[0], power = 1;
  for (let i = 1; i < coefficients.length; i++) {
    power *= x;
    result += coefficients[i] * power;
  }
  return result;
};

function ephemerisCorrection(time) {
  const year = Math.min(9999, new Date((Math.floor(time) - UNIX_EPOCH_DAY) * DAY_MS).getUTCFullYear());
  if (year >= 2020 || year < 1620) {
    const x = 0.5 + days(year, 1, 1) - days(1810, 1, 1);
    return (x ** 2 / 41048480 - 15) / 86400;
  }
  if (year >= 1988) return (year - 1933) / 86400;
  const centuries = (days(year, 7, 1) - days(1900, 1, 1)) / 36525;
  if (year >= 1900) return polynomial([-0.00002, 0.000297, 0.025184, -0.181133, 0.553040, -0.861938, 0.677066, -0.212591], centuries);
  if (year >= 1800) return polynomial([-0.000009, 0.003844, 0.083563, 0.865736, 4.867575, 15.845535, 31.332267, 38.291999, 28.316289, 11.636204, 2.043794], centuries);
  if (year >= 1700) return polynomial([8.118780842, -0.005092142, 0.003336121, -0.0000266484], year - 1700) / 86400;
  return polynomial([196.58333, -4.0675, 0.0219167], year - 1600) / 86400;
}

const julianCenturies = time => (time + ephemerisCorrection(time) - 730120.5) / 36525;

function equationOfTime(time) {
  const t = julianCenturies(time);
  const lambda = polynomial([280.46645, 36000.76983, 0.0003032], t);
  const anomaly = polynomial([357.52910, 35999.05030, -0.0001559, -0.00000048], t);
  const eccentricity = polynomial([0.016708617, -0.000042037, -0.0000001236], t);
  const epsilon = polynomial([23.43929111111111, -0.013004166666666667, -1.638888888888889e-7, 5.03611111111111e-7], t);
  const y = Math.tan(epsilon / 2 * Math.PI / 180) ** 2;
  const result = (y * sin(2 * lambda) - 2 * eccentricity * sin(anomaly)
    + 4 * eccentricity * y * sin(anomaly) * cos(2 * lambda)
    - 0.5 * y ** 2 * sin(4 * lambda) - 1.25 * eccentricity ** 2 * sin(2 * anomaly)) / (2 * Math.PI);
  return Math.sign(result) * Math.min(Math.abs(result), 0.5);
}

// Iranian Standard Time is defined at longitude 52.5 degrees east.
const midday = day => day + 0.5 - equationOfTime(day + 0.5 - 52.5 / 360) - 52.5 / 360;
const PERIODIC_TERMS = [
  [403406, 270.54861, 0.9287892],
  [195207, 340.19128, 35999.1376958],
  [119433, 63.91854, 35999.4089666],
  [112392, 331.2622, 35998.7287385],
  [3891, 317.843, 71998.20261],
  [2819, 86.631, 71998.4403],
  [1721, 240.052, 36000.35726],
  [660, 310.26, 71997.4812],
  [350, 247.23, 32964.4678],
  [334, 260.87, -19.441],
  [314, 297.82, 445267.1117],
  [268, 343.14, 45036.884],
  [242, 166.79, 3.1008],
  [234, 81.53, 22518.4434],
  [158, 3.5, -19.9739],
  [132, 132.75, 65928.9345],
  [129, 182.95, 9038.0293],
  [114, 162.03, 3034.7684],
  [99, 29.8, 33718.148],
  [93, 266.4, 3034.448],
  [86, 249.2, -2280.773],
  [78, 157.6, 29929.992],
  [72, 257.8, 31556.493],
  [68, 185.1, 149.588],
  [64, 69.9, 9037.75],
  [46, 8.0, 107997.405],
  [38, 197.1, -4444.176],
  [37, 250.4, 151.771],
  [32, 65.3, 67555.316],
  [29, 162.7, 31556.08],
  [28, 341.5, -4561.54],
  [27, 291.6, 107996.706],
  [27, 98.5, 1221.655],
  [25, 146.7, 62894.167],
  [24, 110.0, 31437.369],
  [21, 5.2, 14578.298],
  [21, 342.6, -31931.757],
  [20, 230.9, 34777.243],
  [18, 256.1, 1221.999],
  [17, 45.3, 62894.511],
  [14, 242.9, -4442.039],
  [13, 115.2, 107997.909],
  [13, 151.8, 119.066],
  [13, 285.3, 16859.071],
  [12, 53.3, -4.578],
  [10, 126.6, 26895.292],
  [10, 205.7, -39.127],
  [10, 85.9, 12297.536],
  [10, 146.1, 90073.778],
];

function solarLongitude(time) {
  const t = julianCenturies(time);
  let periodic = 0;
  for (const [amplitude, phase, frequency] of PERIODIC_TERMS) periodic += amplitude * sin(phase + frequency * t);
  const lambda = 282.7771834 + 36000.76953744 * t + 0.000005729577951308232 * periodic;
  const aberration = 0.0000974 * cos(177.63 + 35999.01848 * t) - 0.005575;
  const nutation = -0.004778 * sin(polynomial([124.90, -1934.134, 0.002063], t))
    - 0.0003667 * sin(polynomial([201.11, 72001.5377, 0.00057], t));
  return longitude(lambda + aberration + nutation);
}

// Input is a one-based Gregorian absolute date; result is zero-based.
export function persianNewYearOnOrBefore(day) {
  const time = midday(day), angle = solarLongitude(time);
  const prior = time - TROPICAL_YEAR / 360 * (angle < 0 ? angle + 360 : angle);
  const estimate = Math.min(time, prior - TROPICAL_YEAR / 360 * solarLongitude(prior));
  const lower = Math.floor(estimate) - 1;
  for (let candidate = lower; candidate < lower + 3; candidate++) {
    const angleAtNoon = solarLongitude(midday(candidate));
    if (angleAtNoon >= 0 && angleAtNoon <= 2) return candidate - 1;
  }
  return NaN;
}
