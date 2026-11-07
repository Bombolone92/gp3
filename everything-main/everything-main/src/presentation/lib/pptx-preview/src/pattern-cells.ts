type Coverage = (x: number, y: number) => boolean;

// Preset pattern brushes use an 8×8 lattice of one-point cells.
// Generate their geometry from bands, dots and geometric operations. Percentage
// names identify historical presets, rather than literal coverage ratios.
// Half-tone diagonals have a distinct midpoint palette, not partial foreground
// coverage. Keep their full and half cells in separate paths.
const dots =
  (w: number, h: number, ox = 0, oy = 0): Coverage =>
  (x, y) =>
    (y - oy) % h === 0 && (x - ox - ((y - oy) / h) * (w / 2)) % w === 0;
const checker = dots(2, 1);
const complement =
  (a: Coverage): Coverage =>
  (x, y) =>
    !a(x, y);
const add =
  (a: Coverage, b: Coverage): Coverage =>
  (x, y) =>
    a(x, y) || b(x, y);
const subtract =
  (a: Coverage, b: Coverage): Coverage =>
  (x, y) =>
    a(x, y) && !b(x, y);
const mod = (value: number, period: number): number =>
  ((value % period) + period) % period;
const transpose =
  (a: Coverage): Coverage =>
  (x, y) =>
    a(y, x);
const mirror =
  (a: Coverage): Coverage =>
  (x, y) =>
    a(7 - x, y);
const horizontal =
  (period: number, width = 1): Coverage =>
  (_x, y) =>
    y % period < width;
const diagonal =
  (period: number, width = 1, phase = 0): Coverage =>
  (x, y) =>
    mod(x - y + phase, period) < width;
const dashedHorizontal: Coverage = (x, y) =>
  y % 4 === 0 && Math.floor(x / 4) === Math.floor(y / 4);
const dashedDiagonal: Coverage = (x, y) =>
  y >= 2 && y < 6 && mod(x - y + 2, 4) === 0;
const cross = add(horizontal(8), transpose(horizontal(8)));
type Point = readonly [number, number];
// Some native presets are small, irregular glyphs rather than infinite bands.
// Define their point stamps and strokes geometrically, then repeat on the same
// lattice. These are brush coordinates, independent of the filled object's
// position, geometry, scale and palette; no native bitmap assets are needed.
const stamps =
  (points: readonly Point[], size = 1): Coverage =>
  (x, y) =>
    points.some(([sx, sy]) => mod(x - sx, 8) < size && mod(y - sy, 8) < size);
const stroke = (points: readonly Point[], height = 8): Coverage => {
  const cells = new Set<number>();
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1]!,
      [xx, yy] = points[i]!;
    const steps = Math.max(Math.abs(xx - x), Math.abs(yy - y));
    for (let n = 0; n <= steps; n++) {
      const t = steps === 0 ? 0 : n / steps;
      cells.add(
        mod(Math.round(y + (yy - y) * t), height) * 8 +
          mod(Math.round(x + (xx - x) * t), 8),
      );
    }
  }
  return (x, y) => cells.has(mod(y, height) * 8 + mod(x, 8));
};
const weave = subtract(
  add(diagonal(4), (x, y) => mod(x + y, 4) === 0),
  // Interrupt the underpassing strands at their native staggered crossings.
  stamps([
    [7, 1],
    [3, 3],
    [1, 5],
    [7, 5],
    [5, 7],
  ]),
);
const coverage: Readonly<Record<string, Coverage>> = {
  pct5: dots(8, 4),
  pct10: dots(8, 2),
  pct20: dots(4, 2),
  pct25: dots(4, 1),
  pct30: subtract(checker, dots(4, 2, 3, 1)),
  pct40: subtract(checker, dots(8, 4, 5, 3)),
  pct50: checker,
  pct60: add(checker, dots(4, 2, 1)),
  pct70: complement(dots(4, 1)),
  pct75: complement(dots(4, 2)),
  pct80: complement(dots(8, 2, 3)),
  pct90: complement(dots(8, 4, 4, 3)),
  horz: horizontal(8),
  vert: transpose(horizontal(8)),
  ltHorz: horizontal(4),
  ltVert: transpose(horizontal(4)),
  dkHorz: horizontal(4, 2),
  dkVert: transpose(horizontal(4, 2)),
  narHorz: horizontal(2),
  // This preset's native phase is the odd column, unlike narHorz's even row.
  narVert: (x) => x % 2 === 1,
  dashHorz: dashedHorizontal,
  dashVert: transpose(dashedHorizontal),
  cross,
  ltDnDiag: diagonal(4),
  ltUpDiag: mirror(diagonal(4)),
  dkDnDiag: diagonal(4, 2),
  dkUpDiag: mirror(diagonal(4, 2)),
  wdDnDiag: diagonal(8, 3, 1),
  wdUpDiag: mirror(diagonal(8, 3, 1)),
  dashDnDiag: dashedDiagonal,
  dashUpDiag: mirror(dashedDiagonal),
  smCheck: (x, y) =>
    Math.floor((x + 1) / 2) % 2 === Math.floor((y + 1) / 2) % 2,
  lgCheck: (x, y) => Math.floor(x / 4) === Math.floor(y / 4),
  smGrid: add(horizontal(4), transpose(horizontal(4))),
  lgGrid: cross,
  dotGrid: (x, y) => (y === 0 && x % 2 === 0) || (x === 0 && y % 2 === 0),
  horzBrick: (x, y) => y % 4 === 0 || x === Math.floor(y / 4) * 4,
  diagBrick: (x, y) => mod(x + y, 8) === 7 || (x === y && y >= 4),
  solidDmnd: (x, y) => Math.abs(x - 3) + Math.abs(y - 3) <= 3,
  openDmnd: (x, y) => mod(x - y, 8) === 0 || mod(x + y, 8) === 6,
  dotDmnd: (x, y) =>
    x % 2 === 0 && y % 2 === 0 && (mod(x - y, 8) === 0 || mod(x + y, 8) === 0),
  plaid: (x, y) => (y < 4 ? checker(x, y) : x < 4),
  trellis: (x, y) => y % 2 === 0 || mod(x - y, 4) < 2,
  zigZag: (x, y) => x === y % 4 || x === 7 - (y % 4),
  smConfetti: stamps([
    [0, 0],
    [4, 1],
    [1, 2],
    [6, 3],
    [3, 4],
    [7, 5],
    [2, 6],
    [5, 7],
  ]),
  lgConfetti: stamps(
    [
      [2, 0],
      [6, 2],
      [3, 3],
      [0, 4],
      [4, 6],
      [7, 7],
    ],
    2,
  ),
  sphere: (x, y) => {
    const u = x % 4,
      v = y % 4;
    // Shared top/left arcs enclose alternating light and shaded spheres.
    return (
      (u === 0) !== (v === 0) ||
      ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 1 && (v >= 2 || u === 3))
    );
  },
  weave,
  divot: (x, y) => {
    const row = y % 4,
      forward = y < 4;
    return (
      row !== 0 &&
      x ===
        mod((forward ? 3 : 0) + (forward ? 1 : -1) * (1 - Math.abs(row - 2)), 8)
    );
  },
  shingle: add(
    stroke([
      [-1, 0],
      [2, 3],
      [3, 3],
      [6, 0],
      [7, 0],
    ]),
    stroke([
      [3, 3],
      [4, 4],
      [5, 4],
      [7, 6],
      [7, 7],
    ]),
  ),
  wave: stroke(
    [
      [-1, 2],
      [1, 3],
      [3, 1],
      [4, 1],
      [5, 2],
    ],
    4,
  ),
};

export const PATTERN_CELL_PERIOD = 8;

/** Merge adjacent foreground cells into one vector path. */
const cellPath = (cell: Coverage): string => {
  let path = "";
  for (let y = 0; y < PATTERN_CELL_PERIOD; y++)
    for (let x = 0; x < PATTERN_CELL_PERIOD; x++) {
      if (!cell(x, y)) continue;
      const start = x;
      while (x + 1 < PATTERN_CELL_PERIOD && cell(x + 1, y)) x++;
      const width = x - start + 1;
      path += `M${start} ${y}h${width}v1h-${width}Z`;
    }
  return path;
};

const diagonalTone = (x: number, y: number): number => {
  const distance = mod(x - y, PATTERN_CELL_PERIOD);
  return distance === 0 ? 1 : distance === 1 || distance === 7 ? 0.5 : 0;
};

export const nativePatternPaths = (
  preset: string,
): { foreground: string; half?: string } | null => {
  const cell = Object.hasOwn(coverage, preset) ? coverage[preset] : undefined;
  if (cell) return { foreground: cellPath(cell) };
  const tone =
    preset === "dnDiag"
      ? diagonalTone
      : preset === "upDiag"
        ? (x: number, y: number) => diagonalTone(7 - x, y)
        : preset === "diagCross"
          ? (x: number, y: number) =>
              Math.max(diagonalTone(x, y), diagonalTone(7 - x, y))
          : null;
  return tone
    ? {
        foreground: cellPath((x, y) => tone(x, y) === 1),
        half: cellPath((x, y) => tone(x, y) === 0.5),
      }
    : null;
};
