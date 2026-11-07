/** Graphic tab: colors, blend and transform. */
import { h } from '../../lib/dom.js';
import { segmented } from '../controls.js';
import { isMultiColorSticker, stickerInfo } from '../../engine/stickers.js';
import { color, propSection, row } from './common.js';
import { transformSection, blendSection } from './transform.js';

export function stickerTab(view) {
  // Multi-color graphics keep their own palette ("original") or take one custom main color.
  const mode = segmented({
    label: 'Colors',
    options: [
      { value: 'original', label: 'Original' },
      { value: 'custom', label: 'Custom' },
    ],
    value: view.clip?.colorMode === 'original' ? 'original' : 'custom',
    onChange: (v) => view.edit(v === 'original' ? 'Original colors' : 'Custom color', (c) => {
      if (v === 'original') c.colorMode = 'original';
      else {
        // Start from the palette's main color so the switch is not a jump.
        if (c.colorMode === 'original') c.color = stickerInfo(c.sticker)?.main || c.color;
        delete c.colorMode;
      }
    }),
  });
  const modeRow = row('Colors', mode.el);
  const fill = color(view, {
    label: 'Color',
    get: (c) => (c.colorMode === 'original' ? stickerInfo(c.sticker)?.main || c.color : c.color),
    set: (v, final) => view.edit('Graphic color', (c) => {
      c.color = v;
      // Picking a color switches a multi-color graphic to the custom color.
      delete c.colorMode;
    }, { key: 'sticker-color', final }),
  });
  const sync = () => {
    const clip = view.clip;
    if (!clip) return;
    modeRow.hidden = !isMultiColorSticker(clip.sticker);
    mode.set(clip.colorMode === 'original' ? 'original' : 'custom');
  };
  view.bind(sync);
  sync();
  return h('div', propSection('Graphic', [modeRow, fill.el]), blendSection(view), transformSection(view));
}
