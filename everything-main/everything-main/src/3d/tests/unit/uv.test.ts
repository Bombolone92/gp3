import { expect, it } from 'vitest';
import { projectUV, transformUV, uvElements } from '../../src/edit/uv';
import { pack } from '../../src/edit/topology';
const mesh = () =>
  pack(
    [0, 0, 0, 4, 0, 0, 4, 2, 0, 0, 2, 0, 0, 0, 2],
    [
      {
        vertices: [0, 1, 2, 3],
        uvs: [2, 2, 3, 2, 3, 3, 2, 3],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      },
      { vertices: [0, 4, 1], uvs: [2, 2, 3, 2, 3, 3], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0] },
    ],
  );
it('projects selected corners with preserved proportions and immutable geometry', () => {
  const t = mesh(),
    before = t.uvs.slice();
  const { topology: result } = projectUV(t, {
    type: 'uv',
    mode: 'face',
    ids: [0],
    projection: 'planar',
    axis: 2,
  });
  expect(Array.from(result.uvs.slice(0, 8))).toEqual([0, 0.75, 1, 0.75, 1, 0.25, 0, 0.25]);
  expect(result.uvs.slice(8)).toEqual(t.uvs.slice(8));
  expect(t.uvs).toEqual(before);
  expect(result.positions).toBe(t.positions);
  expect(result.normals).toBe(t.normals);
});
it('box projection gives perpendicular faces nonzero UV area', () => {
  const t = projectUV(mesh(), {
    type: 'uv',
    mode: 'face',
    ids: [0, 1],
    projection: 'box',
    axis: 2,
  }).topology;
  const a = t.uvs.slice(8);
  expect(Math.abs((a[2] - a[0]) * (a[5] - a[1]) - (a[4] - a[0]) * (a[3] - a[1]))).toBeGreaterThan(
    0,
  );
  expect(Array.from(t.uvs).every((v) => v >= 0 && v <= 1)).toBe(true);
});
it('rejects empty, invalid, and non-face selections', () => {
  for (const ids of [[], [-1], [2], [0.5]])
    expect(() =>
      projectUV(mesh(), { type: 'uv', mode: 'face', ids, projection: 'planar', axis: 2 }),
    ).toThrow();
  expect(() =>
    projectUV(mesh(), { type: 'uv', mode: 'edge', ids: [0], projection: 'box', axis: 2 }),
  ).toThrow();
});

it('retains projected UV values through native storage', async () => {
  const { Scene } = await import('../../src/core/scene');
  const { topologyMesh } = await import('../../src/edit/topology');
  const { serializeDocument, parseDocument } = await import('../../src/storage/document');
  const t = projectUV(mesh(), {
    type: 'uv',
    mode: 'face',
    ids: [0, 1],
    projection: 'box',
    axis: 2,
  }).topology;
  const transformed = transformUV(t, {
    corners: [0, 1, 2, 3],
    move: [0.2, -0.1],
    angle: 30,
    scale: [0.5, 2],
  });
  const asset = topologyMesh('uv-mesh', transformed),
    scene = new Scene();
  scene.begin('UV mesh');
  scene.replaceGeometry(asset, asset, []);
  scene.commit();
  const restored = parseDocument(serializeDocument(scene.state));
  expect(restored.meshes['uv-mesh'].topology!.uvs).toEqual(transformed.uvs);
});

it('rotates and scales around the unique UV center and leaves other corners untouched', () => {
  const t = mesh(),
    before = t.uvs.slice();
  const result = transformUV(t, {
    corners: [0, 1, 2, 3, 0],
    move: [0.5, -0.5],
    angle: 90,
    scale: [2, 1],
  });
  expect(Array.from(result.uvs.slice(0, 8))).toEqual([3.5, 1, 3.5, 3, 2.5, 3, 2.5, 1]);
  expect(result.uvs.slice(8)).toEqual(t.uvs.slice(8));
  expect(t.uvs).toEqual(before);
  expect(result.positions).toBe(t.positions);
  expect(result.normals).toBe(t.normals);
});
const joined = () =>
  pack(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    [
      { vertices: [0, 1, 2], uvs: [0, 0, 1, 0, 1, 1], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      { vertices: [0, 2, 3], uvs: [0, 0, 1, 1, 0, 1], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    ],
  );
it('identifies connected UV islands while respecting UV seams', () => {
  const t = joined();
  expect(uvElements(t, 'island')).toHaveLength(1);
  expect(uvElements(t, 'vertex')).toHaveLength(4);
  expect(uvElements(t, 'edge')).toHaveLength(5);
  const seam = { ...t, uvs: t.uvs.slice() };
  seam.uvs[6] = 2;
  expect(uvElements(seam, 'island')).toHaveLength(2);
  expect(uvElements(seam, 'vertex')).toHaveLength(5);
  // Coincident UVs on disconnected geometry are not joined.
  const separate = { ...t, indices: new Uint32Array([0, 1, 2, 4, 5, 6]) };
  expect(uvElements(separate, 'island')).toHaveLength(2);
});
it('edge selection includes all welded endpoint corners to prevent accidental tears', () => {
  const t = joined(),
    edge = uvElements(t, 'edge')[0];
  expect(edge.corners.sort()).toEqual([0, 1, 3]);
  const changed = transformUV(t, {
    corners: edge.corners,
    move: [0.2, 0],
    angle: 0,
    scale: [1, 1],
  });
  expect(changed.uvs[0]).toEqual(changed.uvs[6]);
});
it('rejects invalid transforms without touching source UVs', () => {
  const t = mesh(),
    before = t.uvs.slice();
  for (const patch of [
    { corners: [] },
    { corners: [-1] },
    { corners: [99] },
    { move: [NaN, 0] },
    { scale: [0, 1] },
    { angle: Infinity },
    { move: [1e9, 0] },
  ])
    expect(() =>
      transformUV(t, { corners: [0], move: [0, 0], angle: 0, scale: [1, 1], ...patch } as any),
    ).toThrow();
  expect(t.uvs).toEqual(before);
});
