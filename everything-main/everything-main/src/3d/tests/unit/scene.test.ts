import { describe, it, expect } from 'vitest';
import { Scene } from '../../src/core/scene';

describe('scene operations and history', () => {
  it('starts with a selected cube and an empty history', () => {
    const s = new Scene();
    expect(s.selected?.kind).toBe('cube');
    expect(s.state.objects).toHaveLength(1);
    expect(s.canUndo).toBe(false);
  });
  it('creates unique names and synchronizes selection', () => {
    const s = new Scene();
    const second = s.create('cube');
    expect(second.name).toBe('Cube 02');
    expect(s.selected?.id).toBe(second.id);
    s.select(s.state.objects[0].id);
    expect(s.selected?.name).toBe('Cube');
    s.select('invalid');
    expect(s.selected).toBeNull();
  });
  it('completes create, select, transform, delete, and undo workflow', () => {
    const s = new Scene(),
      cube = s.selected!.id;
    const sphere = s.create('sphere');
    s.select(cube);
    s.select(sphere.id);
    s.transform('position', [3, 2, -1]);
    s.transform('rotation', [30, 45, 60]);
    s.transform('scale', [2, 0.5, 3]);
    s.rename(sphere.id, 'Hero');
    s.deleteSelected();
    expect(s.selected).toBeNull();
    expect(s.state.objects).toHaveLength(1);
    s.undo();
    expect(s.selected).toMatchObject({
      name: 'Hero',
      position: [3, 2, -1],
      rotation: [30, 45, 60],
      scale: [2, 0.5, 3],
    });
    s.undo();
    expect(s.selected?.name).toBe('Sphere');
    s.undo();
    expect(s.selected?.scale).toEqual([1, 1, 1]);
    s.undo();
    s.undo();
    expect(s.selected?.position).toEqual([0, 1, 0]);
    s.undo();
    expect(s.state.objects).toHaveLength(1);
    expect(s.state.selected).toBe(cube);
    for (let i = 0; i < 6; i++) s.redo();
    expect(s.state.objects).toHaveLength(1);
    expect(s.selected).toBeNull();
  });
  it('groups every drag into one undoable action and cancels cleanly', () => {
    const s = new Scene();
    s.begin('Move');
    for (let i = 1; i <= 20; i++) s.transform('position', [i, 1, 0]);
    s.commit();
    s.undo();
    expect(s.selected?.position).toEqual([0, 1, 0]);
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(s.selected?.position).toEqual([20, 1, 0]);
    s.begin('Move');
    s.transform('position', [100, 1, 0]);
    s.cancel();
    expect(s.selected?.position).toEqual([20, 1, 0]);
    s.undo();
    expect(s.selected?.position).toEqual([0, 1, 0]);
  });
  it('does not add empty changes or selection to history', () => {
    const s = new Scene();
    s.begin('Move');
    s.commit();
    s.transform('scale', [1, 1, 1]);
    s.select(null);
    expect(s.canUndo).toBe(false);
  });
  it('clears the redo branch when a new edit is made', () => {
    const s = new Scene();
    s.create('sphere');
    s.undo();
    s.create('plane');
    expect(s.canRedo).toBe(false);
    expect(s.selected?.kind).toBe('plane');
  });
  it('validates numeric edits and object names', () => {
    const s = new Scene();
    s.transform('position', [NaN, 0, 0]);
    expect(s.selected?.position).toEqual([0, 1, 0]);
    s.transform('scale', [-3, 0, 1000]);
    expect(s.selected?.scale).toEqual([0.01, 0.01, 100]);
    s.rename(s.selected!.id, '   ');
    expect(s.selected?.name).toBe('Cube');
    s.rename(s.selected!.id, '  Renamed  ');
    expect(s.selected?.name).toBe('Renamed');
  });
  it('limits undo history and retains independent snapshots', () => {
    const s = new Scene();
    for (let i = 0; i < 120; i++) s.transform('position', [i + 1, 1, 0]);
    for (let i = 0; i < 100; i++) s.undo();
    expect(s.canUndo).toBe(false);
    expect(s.selected?.position[0]).toBe(20);
    s.redo();
    expect(s.selected?.position[0]).toBe(21);
  });
});
