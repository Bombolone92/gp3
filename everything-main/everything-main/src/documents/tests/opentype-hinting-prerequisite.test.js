import { expect, it } from 'vitest';
import { Font } from '../src/vendor/opentype/opentype.mjs';

// Original outline and bytecode; no installed-font data. This audits a
// dependency prerequisite, not a claim that the editor supports hinting.
// https://learn.microsoft.com/en-us/typography/opentype/spec/tt_instructions#move-direct-absolute-point
function control(perpendicular, round = false) {
  const font = new Font({ familyName: 'Original MDAP control', styleName: 'Regular',
    unitsPerEm: 1000, ascender: 800, descender: -200, glyphs: [] });
  font.outlinesFormat = 'truetype';
  const points = [
    { x: 100.25, y: 100.25, onCurve: true, lastPointOfContour: false },
    { x: 400, y: 100, onCurve: true, lastPointOfContour: false },
    { x: 100, y: 400, onCurve: true, lastPointOfContour: true },
  ];
  // SVTCA[x], optional SFVTCA[y], PUSHB point 0, MDAP[round].
  const instructions = [0x01, ...(perpendicular ? [0x04] : []), 0xb0, 0, round ? 0x2f : 0x2e];
  return font.hinting.exec({ advanceWidth: 500, points, instructions }, 1000);
}

it('MDAP[0] touches an aligned point without changing its coordinates', () => {
  const points = control(false);
  expect(points[0]).toMatchObject({ x: 100.25, y: 100.25, xTouched: true });
});

it('MDAP[1] still rounds along the aligned freedom vector', () => {
  expect(control(false, true)[0]).toMatchObject({ x: 100, y: 100.25, xTouched: true });
});

// Unmodified OpenType.js 2.0.0 incorrectly performs a movement for MDAP[0]. With
// perpendicular vectors this creates NaN. No movement is requested here;
// the prohibition on orthogonal vectors for moving points does not apply.
it('MDAP[0] only touches when projection and freedom are perpendicular', () => {
  const points = control(true);
  expect(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  expect(points[0]).toMatchObject({ x: 100.25, y: 100.25, yTouched: true });
});

// SDPVTL sets BOTH vectors. Leaving the current projection on the x axis
// makes the subsequent MDAP round the wrong coordinate.
it('SDPVTL updates the current projection as well as the dual vector', () => {
  const font = new Font({ familyName: 'Original vector control', styleName: 'Regular',
    unitsPerEm: 1000, ascender: 800, descender: -200, glyphs: [] });
  font.outlinesFormat = 'truetype';
  const points = [
    { x: 0, y: 0, onCurve: true, lastPointOfContour: false },
    { x: 0, y: 100, onCurve: true, lastPointOfContour: false },
    { x: 100.25, y: 100.25, onCurve: true, lastPointOfContour: true },
  ];
  // SVTCA[x], PUSHB points 1/0, SDPVTL[parallel], SFVTPV,
  // PUSHB point 2, MDAP[round]. The line through points 0/1 is vertical.
  const instructions = [0x01, 0xb1, 1, 0, 0x86, 0x0e, 0xb0, 2, 0x2f];
  const result = font.hinting.exec({ advanceWidth: 500, points, instructions }, 1000);
  expect(result[2]).toMatchObject({ x: 100.25, y: 100 });
});

it('phantom interpolation retains the original fractional advance', () => {
  const font = new Font({ familyName: 'Original phantom control', styleName: 'Regular',
    unitsPerEm: 1000, ascender: 800, descender: -200, glyphs: [] });
  font.outlinesFormat = 'truetype';
  const points = [
    { x: 500, y: 0, onCurve: true, lastPointOfContour: false },
    { x: 0, y: 100, onCurve: true, lastPointOfContour: false },
    { x: 1000, y: 100, onCurve: true, lastPointOfContour: true },
  ];
  // Set x axis, reference points to the two horizontal phantoms, then IP
  // point 0. At 10ppem the 1049-unit advance is 671/64 before grid fitting
  // and 10 afterward. Interpolation must retain that distinction.
  const instructions = [0x01, 0xb0, 3, 0x11, 0xb0, 4, 0x12, 0xb0, 0, 0x39];
  const result = font.hinting.exec({ advanceWidth: 1049, points, instructions }, 10);
  expect(Math.abs(result[0].x - 5 * 10 / (671 / 64))).toBeLessThanOrEqual(1 / 64);
});
