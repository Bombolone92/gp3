// Spot (ink) channels of Multichannel documents: the overprinted composite
// and keeping the composite layer in step with the channels. Light enough for
// the Channels panel to use synchronously inside its commands.
import type { Editor } from '../../editor';
import type { Layer, PhotoDocument } from '../../model/document';
import type { TileStore } from '../../model/tiles';
import { gridFromImage, readMask } from '../../model/tiles';
import { setLayerPixels } from '../../model/pixel-layer';
import { inkComposite } from '../../color/multichannel';

export const hex = (c: readonly number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export const rgb = (h: string | undefined): [number, number, number] => (h && /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number] : [0, 0, 0]);

export const spotChannels = (doc: PhotoDocument) => (doc.channels ?? []).filter((c) => c.spot);
const compositeLayer = (d: PhotoDocument): Layer | undefined => d.layers.find((l) => l.id === d.modeData?.multichannelLayer);

/** Overprinted composite of the visible spot channels. */
export function spotComposite(store: TileStore, doc: PhotoDocument) {
  const area = { x: 0, y: 0, width: doc.width, height: doc.height };
  const spots = spotChannels(doc);
  return inkComposite(
    spots.map((c) => (c.hidden ? null : readMask(store, c.grid, area).data)),
    spots.map((c) => ({ name: c.name, color: rgb(c.color) })),
    doc.width,
    doc.height,
  );
}

/** Inside a command: redraw the composite layer from the channels. */
export function syncMultichannel(store: TileStore, d: PhotoDocument) {
  if (d.mode !== 'multichannel') return;
  const l = compositeLayer(d);
  if (l) setLayerPixels(l, gridFromImage(store, spotComposite(store, d)), d);
}

/** Inside a command: back to an ordinary document (the composite stays as
 * an unlocked pixel layer; spot channels are dropped). */
export function leaveMultichannel(d: PhotoDocument) {
  const l = compositeLayer(d);
  if (l) l.locked = false;
  d.channels = d.channels?.filter((c) => !c.spot);
  if (!d.channels?.length) delete d.channels;
  delete d.modeData;
}

/** Show or hide one ink channel (the composite follows). */
export function toggleSpotVisibility(e: Editor, id: string) {
  const ch = e.doc.channels?.find((c) => c.id === id && c.spot);
  if (!ch) return;
  e.command(ch.hidden ? 'Show Channel' : 'Hide Channel', (d) => {
    const c = d.channels!.find((x) => x.id === id)!;
    if (c.hidden) delete c.hidden;
    else c.hidden = true;
    syncMultichannel(e.assets.tiles, d);
  });
}
