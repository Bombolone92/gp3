import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { setGeomSource, runGeom, OP } from '../src/features/geometry/engine/index.js';
import { anchor } from '../src/model/bezier.js';

beforeAll(() => setGeomSource(fs.readFileSync(path.resolve(__dirname, '../src/wasm/geom.wasm'))));

const shape = (subpaths, key = 0) => ({ subpaths, filled: true, evenodd: false, string: false, key });
const rect = (x0, y0, x1, y1) => [{ anchors: [anchor(x0, y0), anchor(x1, y0), anchor(x1, y1), anchor(x0, y1)], closed: true }];

describe('Shape Builder merge on the geometry engine', () => {
  it('merges Divide faces of hand-drawn (non-round) rectangles into one outline', async () => {
    // Coordinates as the Rectangle tool produces them from pointer positions.
    const a = rect(100.00000357453331, 100.00000840015328, 250.00002502173317, 200.00001680030658);
    const b = rect(199.9999942807467, 149.99998605932012, 350.0000157279466, 300.00000750652);
    const faces = await runGeom(OP.DIVIDE, [shape(a), shape(b)], []);
    expect(faces).toHaveLength(3);
    const merged = await runGeom(OP.UNITE_GROUPS, faces.map((f) => shape(f.subpaths, 0)), []);
    expect(merged).toHaveLength(1);
    expect(merged[0].subpaths).toHaveLength(1);
    expect(merged[0].subpaths[0].anchors).toHaveLength(8);
  });
});
