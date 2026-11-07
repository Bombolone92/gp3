/**
 * Create a project from a template: generate its backdrops, placeholders and
 * sound effects, store them as ordinary media, and save the project.
 */
import { templateDraft, artSize } from '../model/templates.js';
import { normalizeProject } from '../model/project.js';
import { artFile as drawArtFile, sfxFile as renderSfxFile } from '../engine/template-art.js';

export async function createProjectFromTemplate(library, tpl, { name, artFile = drawArtFile, sfxFile = renderSfxFile, onProgress } = {}) {
  const { project, media } = templateDraft(tpl, { name });
  const ids = new Map();
  let done = 0;
  for (const m of media) {
    onProgress?.({ done: done++, total: media.length });
    let asset;
    if (m.kind === 'image') {
      const { width, height } = artSize(m.spec, project.settings);
      const file = await artFile(m.spec, width, height);
      if (!file) throw new Error("This browser can't draw the template's images.");
      asset = await library.addMediaBlob({ kind: 'image', name: `${m.name}.${file.ext}`, ext: file.ext, mime: file.mime, width, height, origin: 'template' }, file.blob);
    } else {
      const file = sfxFile(m.sfx);
      asset = await library.addMediaBlob({ kind: 'audio', name: m.name, ext: file.ext, mime: file.mime, duration: m.duration, hasAudio: true, origin: 'template' }, file.blob);
    }
    project.assets[asset.id] = asset;
    ids.set(m.id, asset.id);
  }
  for (const t of project.tracks) for (const c of t.clips) if (c.assetId) c.assetId = ids.get(c.assetId) ?? c.assetId;
  const saved = normalizeProject(project);
  await library.saveProject(saved);
  onProgress?.({ done: media.length, total: media.length });
  return saved;
}
