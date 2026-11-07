import { describe, it, expect, vi } from 'vitest';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { insertTemplate } from '../src/ui/template-insert.js';
import { TEMPLATES } from '../src/model/templates.js';
import { mainTrack, allClips, findClip } from '../src/model/timeline.js';
import { fixture, clip, onMain, s } from './helpers.js';

function setup(withMedia = true) {
  const p = fixture();
  if (withMedia) onMain(p, clip('video', 0, 6));
  const store = new EditorStore(p);
  let n = 0;
  const library = { addMediaBlob: vi.fn(async (meta) => ({ id: `a${++n}`, hash: `h${n}`, size: 1, duration: 0, added: 0, ...meta })) };
  const ctx = { store, library, player: { pause() {} } };
  ctx.actions = createActions(ctx);
  return { store, ctx };
}

const stubs = { artFile: async () => ({ blob: new Blob(['x']), ext: 'png', mime: 'image/png' }), sfxFile: () => ({ blob: new Blob(['x']), ext: 'wav', mime: 'audio/wav' }) };

describe('inserting a template', () => {
  it('adds the template above existing content at the playhead as one grouped undo step', async () => {
    const { store, ctx } = setup();
    const tpl = TEMPLATES[0];
    store.seek(s(2));
    const before = store.history.undoStack.length;
    const ids = await insertTemplate(ctx, tpl, stubs);
    expect(ids.length).toBeGreaterThan(1);
    expect(store.history.undoStack.length).toBe(before + 1);
    const clips = ids.map((id) => findClip(store.project, id).clip);
    expect(Math.min(...clips.map((c) => c.start))).toBe(s(2));
    expect(new Set(clips.map((c) => c.group)).size).toBe(1);
    // The original base clip is untouched and still on the base track.
    expect(mainTrack(store.project).clips.length).toBe(1);
    for (const c of clips) if (c.assetId) expect(store.project.assets[c.assetId]).toBeTruthy();
    store.undo();
    expect(allClips(store.project).length).toBe(1);
  });

  it('uses an empty base track for the template backdrop', async () => {
    const { store, ctx } = setup(false);
    await insertTemplate(ctx, TEMPLATES[0], stubs);
    expect(mainTrack(store.project).clips.length).toBeGreaterThan(0);
  });
});
