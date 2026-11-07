import { describe, expect, it } from 'vitest';
import { Scene } from '../../src/core/scene';
import {
  parseDocument,
  serializeDocument,
  documentFilename,
  MAX_FILE_BYTES,
} from '../../src/storage/document';
import { modelMatrix } from '../../src/core/math';

describe('scene documents', () => {
  it('round trips names, primitives, precise transforms, and multiple selection', () => {
    const s = new Scene();
    s.renameScene('My scene');
    s.create('sphere');
    s.transform('rotation', [12.345678, 35, 10]);
    s.selectAll();
    expect(parseDocument(serializeDocument(s.state))).toEqual(s.state);
    const empty = new Scene(false);
    expect(parseDocument(serializeDocument(empty.state))).toEqual(empty.state);
  });
  it('rejects malformed, oversized, unsupported, and unsafe documents', () => {
    const state = new Scene().state;
    const data = JSON.parse(serializeDocument(state));
    expect(() => parseDocument('{')).toThrow('valid JSON');
    expect(() => parseDocument(' '.repeat(MAX_FILE_BYTES + 1))).toThrow('64 MB');
    for (const bad of [
      { ...data, version: 999 },
      { ...data, selection: ['unknown'] },
      { ...data, objects: [...data.objects, ...data.objects] },
      { ...data, name: '' },
    ])
      expect(() => parseDocument(JSON.stringify(bad))).toThrow();
    for (const change of [
      { position: [null, 0, 0] },
      { scale: [0, 1, 1] },
      { rotation: [10001, 0, 0] },
      { kind: 'script' },
      { name: 42 },
    ]) {
      expect(() =>
        parseDocument(JSON.stringify({ ...data, objects: [{ ...data.objects[0], ...change }] })),
      ).toThrow();
    }
    expect(documentFilename('../a/<scene>:test')).toBe('ascenetest.3d.json');
  });
  it('opening a document is undoable, including its name and prior selection', () => {
    const s = new Scene(),
      previous = structuredClone(s.state),
      other = new Scene(false);
    other.renameScene('Imported');
    other.create('plane');
    s.open(parseDocument(serializeDocument(other.state)));
    expect(s.state).toEqual(other.state);
    s.undo();
    expect(s.state).toEqual(previous);
    s.redo();
    expect(s.state).toEqual(other.state);
    s.open(previous, true);
    expect(s.canUndo).toBe(false);
    expect(s.state).toEqual(previous);
  });
});

describe('multiple selection and duplication', () => {
  const pair = () => {
    const s = new Scene();
    const first = s.selected!.id;
    const second = s.create('sphere');
    s.transform('position', [4, 1, 0]);
    s.select(first, true);
    return { s, first, second: second.id };
  };
  it('toggles members, tracks the active object, and excludes selection from history', () => {
    const { s, first, second } = pair();
    expect(s.state.selection).toEqual([second, first]);
    expect(s.selected!.id).toBe(first);
    s.select(first, true);
    expect(s.selected!.id).toBe(second);
    s.select(second, true);
    expect(s.selected).toBeNull();
    s.selectAll();
    expect(s.selectedObjects).toHaveLength(2);
    s.select(null);
    expect(s.selectedObjects).toHaveLength(0);
  });
  it('duplicates independent objects with unique IDs and names as a single action', () => {
    const { s } = pair(),
      original = structuredClone(s.state);
    s.duplicateSelected();
    expect(s.state.objects).toHaveLength(4);
    expect(s.selectedObjects.map((o) => o.name)).toEqual(['Cube copy', 'Sphere copy']);
    expect(s.selectedObjects.map((o) => o.position)).toEqual([
      [1, 1, 1],
      [5, 1, 1],
    ]);
    expect(new Set(s.state.objects.map((o) => o.id)).size).toBe(4);
    s.undo();
    expect(s.state).toEqual(original);
    s.redo();
    expect(s.selectedObjects).toHaveLength(2);
    s.transform('position', [10, 1, 1]);
    expect(s.state.objects[0].position).toEqual([0, 1, 0]);
    s.duplicateSelected();
    expect(s.selectedObjects.map((o) => o.name)).toEqual(['Cube copy 2', 'Sphere copy 2']);
  });
  it('moves from an immutable drag baseline and undoes the whole group', () => {
    const { s } = pair(),
      before = structuredClone(s.state);
    expect(s.transformTarget!.position).toEqual([2, 1, 0]);
    s.begin('Move group');
    s.transform('position', [3, 1, 0]);
    s.transform('position', [5, 1, 0]);
    s.commit();
    expect(s.selectedObjects.map((o) => o.position)).toEqual([
      [3, 1, 0],
      [7, 1, 0],
    ]);
    s.undo();
    expect(s.state).toEqual(before);
    s.begin('Cancelled group');
    s.transform('position', [50, 1, 0]);
    s.cancel();
    expect(s.state).toEqual(before);
  });
  it('rotates around a shared pivot and composes object orientations', () => {
    const { s } = pair();
    s.transform('rotation', [0, 90, 0]);
    const objects = s.selectedObjects;
    expect(objects[0].position[0]).toBeCloseTo(2);
    expect(objects[0].position[2]).toBeCloseTo(2);
    expect(objects[1].position[2]).toBeCloseTo(-2);
    const matrix = modelMatrix([0, 0, 0], objects[0].rotation, [1, 1, 1]);
    expect(matrix[2]).toBeCloseTo(-1);
    expect(s.transformTarget!.rotation).toEqual([0, 0, 0]);
  });
  it('uniformly scales the group without altering relative rotations and respects limits', () => {
    const { s } = pair();
    s.transform('scale', [2, 1, 1]);
    expect(s.selectedObjects.map((o) => o.position)).toEqual([
      [-2, 1, 0],
      [6, 1, 0],
    ]);
    expect(s.selectedObjects.map((o) => o.scale)).toEqual([
      [2, 2, 2],
      [2, 2, 2],
    ]);
    s.transform('scale', [100, 1, 1]);
    expect(s.selectedObjects.every((o) => o.scale.every((v) => v === 100))).toBe(true);
    s.transform('scale', [0, 1, 1]);
    expect(s.selectedObjects.every((o) => o.scale.every((v) => v >= 0.01))).toBe(true);
  });
  it('deletes the complete selection and restores it atomically', () => {
    const { s } = pair(),
      before = structuredClone(s.state);
    s.deleteSelected();
    expect(s.state.objects).toHaveLength(0);
    s.undo();
    expect(s.state).toEqual(before);
    s.redo();
    expect(s.selectedObjects).toHaveLength(0);
  });
});
