/**
 * Insert a project template into the open project at the playhead: its
 * backdrops, placeholders and sounds become media, and its tracks are added
 * above what is already there, grouped so the whole template moves as one.
 */
import { uid } from '../lib/ids.js';
import { announce } from '../lib/dom.js';
import { templateDraft, artSize } from '../model/templates.js';
import * as T from '../model/timeline.js';

export async function insertTemplate(ctx, tpl, { onProgress, artFile, sfxFile } = {}) {
  const { store, library } = ctx;
  const art = artFile || (await import('../engine/template-art.js')).artFile;
  const sfx = sfxFile || (await import('../engine/template-art.js')).sfxFile;
  const { project: draft, media } = templateDraft(tpl, {});
  const ids = new Map();
  const assets = [];
  let done = 0;
  for (const m of media) {
    onProgress?.({ done: done++, total: media.length });
    let asset;
    if (m.kind === 'image') {
      // Drawn at the open project's size so backdrops fill its frame.
      const { width, height } = artSize(m.spec, store.project.settings);
      const file = await art(m.spec, width, height);
      if (!file) throw new Error("This browser can't draw the template's images.");
      asset = await library.addMediaBlob({ kind: 'image', name: `${m.name}.${file.ext}`, ext: file.ext, mime: file.mime, width, height, origin: 'template' }, file.blob);
    } else {
      const file = sfx(m.sfx);
      asset = await library.addMediaBlob({ kind: 'audio', name: m.name, ext: file.ext, mime: file.mime, duration: m.duration, hasAudio: true, origin: 'template' }, file.blob);
    }
    assets.push(asset);
    ids.set(m.id, asset.id);
  }
  onProgress?.({ done: media.length, total: media.length });
  const at = store.time;
  const total = draft.tracks.reduce((n, t) => n + t.clips.length, 0);
  const group = total > 1 ? uid('g') : null;
  const added = [];
  store.update(`Insert ${tpl.name}`, (p) => {
    for (const a of assets) p.assets[a.id] = a;
    const main = T.mainTrack(p);
    const baseEmpty = main && !main.clips.length;
    // Bottom to top, so each new track lands above the previous one.
    for (const dt of [...draft.tracks].reverse()) {
      if (!dt.clips.length) continue;
      const target = dt.main && baseEmpty ? main : T.addTrack(p, dt.kind);
      for (const c of dt.clips) {
        const copy = structuredClone(c);
        copy.id = uid('c');
        copy.start = c.start + at;
        if (group) copy.group = group;
        else delete copy.group;
        if (copy.assetId) copy.assetId = ids.get(copy.assetId) ?? copy.assetId;
        target.clips.push(copy);
        added.push(copy.id);
      }
      T.sortTrack(target);
    }
    return added.length > 0;
  });
  store.select(added);
  announce(`${tpl.name} inserted`);
  return added;
}
