import { describe, it, expect } from 'vitest';
import { TEMPLATES, TEMPLATE_CATEGORIES, templateDraft, artSize } from '../src/model/templates.js';
import { RATIOS, normalizeProject, normalizeAsset } from '../src/model/project.js';
import { TEXT_PRESETS, ANIMATIONS, TRANSITIONS, EFFECTS, FILTERS, FONTS } from '../src/model/catalog.js';
import { STICKERS } from '../src/engine/stickers.js';
import { SFX_BY_ID } from '../src/media/sfx.js';
import { projectDuration } from '../src/model/timeline.js';
import { Library } from '../src/storage/library.js';
import { memoryBackend } from '../src/storage/backends.js';
import { createProjectFromTemplate } from '../src/storage/template-project.js';

const ids = (list) => new Set(list.map((x) => x.id));
const IN = ids(ANIMATIONS.in);
const OUT = ids(ANIMATIONS.out);
const LOOP = ids(ANIMATIONS.loop);

/** The draft with stand-in assets, normalized like a project loaded from storage. */
function normalizedDraft(tpl) {
  const { project, media } = templateDraft(tpl);
  for (const m of media) {
    const size = m.kind === 'image' ? artSize(m.spec, project.settings) : {};
    project.assets[m.id] = normalizeAsset({ id: m.id, kind: m.kind, name: m.name, hash: m.id, ext: 'x', ...size, duration: m.duration || 0 });
  }
  return { raw: structuredClone(project), project: normalizeProject(project), media };
}

describe('templates', () => {
  it('has about ten templates with unique ids, names and known categories and ratios', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(ids(TEMPLATES).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.name)).size).toBe(TEMPLATES.length);
    const cats = ids(TEMPLATE_CATEGORIES);
    for (const t of TEMPLATES) {
      expect(cats.has(t.category), t.id).toBe(true);
      expect(RATIOS.some((r) => r.id === t.ratio), t.id).toBe(true);
      expect(t.description.length).toBeGreaterThan(10);
    }
    // Every category is used.
    for (const c of TEMPLATE_CATEGORIES) expect(TEMPLATES.some((t) => t.category === c.id), c.id).toBe(true);
  });

  it.each(TEMPLATES.map((t) => [t.id, t]))('%s uses only built-in looks', (_, tpl) => {
    const { project, media } = templateDraft(tpl);
    const clips = project.tracks.flatMap((t) => t.clips);
    expect(clips.length).toBeGreaterThan(2);
    for (const c of clips) {
      if (c.type === 'text') {
        expect(ids(TEXT_PRESETS).has(c.preset), c.preset).toBe(true);
        expect(FONTS.some((f) => f.id === c.style.font), c.style.font).toBe(true);
      }
      if (c.type === 'sticker') expect(ids(STICKERS).has(c.sticker), c.sticker).toBe(true);
      if (c.type === 'effect') expect(ids(EFFECTS).has(c.effect), c.effect).toBe(true);
      if (c.type === 'filter') expect(ids(FILTERS).has(c.filter), c.filter).toBe(true);
      if (c.filter && typeof c.filter === 'object') expect(ids(FILTERS).has(c.filter.id)).toBe(true);
      if (c.transition) expect(ids(TRANSITIONS).has(c.transition.id), c.transition.id).toBe(true);
      if (c.animIn) {
        expect(IN.has(c.animIn.id), c.animIn.id).toBe(true);
        if (c.animIn.id === 'typewriter') expect(c.type).toBe('text');
      }
      if (c.animOut) expect(OUT.has(c.animOut.id), c.animOut.id).toBe(true);
      if (c.animLoop) expect(LOOP.has(c.animLoop.id), c.animLoop.id).toBe(true);
      // Animations fit inside their clip.
      expect((c.animIn?.duration || 0) + (c.animOut?.duration || 0)).toBeLessThanOrEqual(c.duration);
      if (c.assetId) expect(media.some((m) => m.id === c.assetId), c.assetId).toBe(true);
    }
    for (const m of media) {
      expect(clips.some((c) => c.assetId === m.id), `${m.id} unused`).toBe(true);
      if (m.kind === 'audio') expect(SFX_BY_ID.has(m.sfx), m.sfx).toBe(true);
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t]))('%s survives normalization unchanged', (_, tpl) => {
    const { raw, project } = normalizedDraft(tpl);
    // No clip dropped, no track split by overlaps, transitions kept.
    expect(project.tracks.map((t) => t.kind)).toEqual(raw.tracks.map((t) => t.kind));
    expect(project.tracks.filter((t) => t.main)).toHaveLength(1);
    const before = raw.tracks.flatMap((t) => t.clips);
    const after = project.tracks.flatMap((t) => t.clips);
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
    expect(after.filter((c) => c.transition).length).toBe(before.filter((c) => c.transition).length);
    for (const c of before) {
      const n = after.find((x) => x.id === c.id);
      expect(n.start).toBe(c.start);
      expect(n.duration).toBe(c.duration);
      if (c.transition) expect(n.transition).toEqual(c.transition);
    }
    expect(project.settings.ratio).toBe(tpl.ratio);
    expect(project.name).toBe(tpl.name);
    // Everything ends with the base track, so nothing runs past the backdrop.
    const end = projectDuration(project);
    const main = project.tracks.find((t) => t.main);
    const mainEnd = Math.max(...main.clips.map((c) => c.start + c.duration));
    expect(end).toBeGreaterThan(3_000_000);
    expect(mainEnd).toBe(end);
  });

  it('labels placeholder slots so they are easy to find and replace', () => {
    for (const tpl of TEMPLATES) {
      const { project, media } = templateDraft(tpl);
      for (const m of media.filter((x) => x.spec?.slot)) {
        const c = project.tracks.flatMap((t) => t.clips).find((x) => x.assetId === m.id);
        expect(c.name, tpl.id).toMatch(/replace me/);
      }
    }
    expect(TEMPLATES.some((t) => templateDraft(t).media.some((m) => m.spec?.slot))).toBe(true);
  });

  it('builds a fresh copy every time', () => {
    const a = templateDraft(TEMPLATES[0]).project;
    const b = templateDraft(TEMPLATES[0]).project;
    expect(a.id).not.toBe(b.id);
    expect(a.tracks[0].clips[0].id).not.toBe(b.tracks[0].clips[0].id);
  });

  it('creates and saves a playable project with generated media', async () => {
    const lib = new Library(memoryBackend());
    const tpl = TEMPLATES.find((t) => t.id === 'photo-slideshow');
    const drawn = [];
    const artFile = async (spec, w, h) => {
      drawn.push({ slot: spec.slot, w, h });
      return { blob: new Blob([`img:${drawn.length}`], { type: 'image/jpeg' }), ext: 'jpg', mime: 'image/jpeg' };
    };
    const project = await createProjectFromTemplate(lib, tpl, { artFile });
    expect(drawn).toHaveLength(4);
    expect(drawn[0]).toMatchObject({ slot: 'Photo 1', w: 1920, h: 1080 });
    const assets = Object.values(project.assets);
    expect(assets.filter((a) => a.kind === 'image')).toHaveLength(4);
    const sfx = assets.filter((a) => a.kind === 'audio');
    expect(sfx).toHaveLength(1);
    expect(sfx[0]).toMatchObject({ name: 'Whoosh.wav', ext: 'wav', duration: 1_000_000 });
    for (const a of assets) expect(lib.backend.files.has(`media/${a.hash}.${a.ext}`)).toBe(true);
    for (const c of project.tracks.flatMap((t) => t.clips)) if (c.assetId) expect(project.assets[c.assetId]).toBeTruthy();
    expect((await lib.listProjects()).map((p) => p.id)).toEqual([project.id]);
    expect(await lib.openProject(project.id)).toEqual(project);
    // The sound effect is a real WAV file.
    const wav = await lib.mediaBlob(sfx[0]);
    expect(new TextDecoder().decode((await wav.arrayBuffer()).slice(0, 4))).toBe('RIFF');
  });

  it('explains when images cannot be drawn', async () => {
    const lib = new Library(memoryBackend());
    await expect(createProjectFromTemplate(lib, TEMPLATES[0], { artFile: async () => null })).rejects.toThrow(/can't draw/);
    expect(await lib.listProjects()).toEqual([]);
  });
});
