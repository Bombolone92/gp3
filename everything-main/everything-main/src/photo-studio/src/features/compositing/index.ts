// Multi-image and compositing commands: aligning and blending layers,
// panoramas, HDR merging and toning, Apply Image and Calculations, sky
// replacement and the File → Automate helpers (scanned photos, contact
// sheets, fit image, conditional mode change, PDF presentations), and trapping.
// Dialog modules load on first use.
import type { Editor } from '../../editor';
import { registerCommand, type Command } from '../../app/registry';
import { deferRecording } from '../filters/record';
import { canStack } from './stackable';

const hasDoc = (e: Editor) => e.hasDocument;
// Same rule as the other Image > Adjustments commands.
const canAdjust = (e: Editor) =>
  e.hasDocument && (!!e.settings.quickMask || (!!e.layer && e.selectedIds.size === 1 && e.layer.kind !== 'group' && (e.layer.kind !== 'adjustment' || e.editingMask)));

export function installCompositing(e: Editor) {
  void e;
  const lazy = <M,>(load: () => Promise<M>, pick: (m: M) => Command['run']): Command['run'] => async (ed, arg) => pick(await load())(ed, arg);
  const layers = () => import('./layers');
  const panorama = () => import('./panorama');
  const automate = () => import('./automate');
  registerCommand(
    { id: 'edit.auto-align', label: 'Auto-Align Layers…', enabled: canStack, run: lazy(layers, (m) => m.autoAlign), description: 'Line up overlapping layers by their content' },
    { id: 'edit.auto-blend', label: 'Auto-Blend Layers…', enabled: canStack, run: lazy(layers, (m) => m.autoBlend), description: 'Mask overlapping layers into a seamless panorama or a focus stack' },
    { id: 'edit.sky-replacement', label: 'Sky Replacement…', enabled: hasDoc, run: lazy(() => import('./sky'), (m) => m.skyReplacementDialog), recordable: false, description: 'Replace the sky with a generated sky or your own image' },
    { id: 'adjust.hdr-toning', label: 'HDR Toning…', enabled: (ed) => canAdjust(ed) || (ed.hasDocument && (ed.doc.bitsPerChannel ?? 8) === 32), run: lazy(() => import('./hdr-toning'), (m) => m.hdrToningDialog), description: 'Local tone mapping: compress highlights and shadows, boost detail' },
    { id: 'image.apply-image', label: 'Apply Image…', enabled: (ed) => (ed.doc.bitsPerChannel ?? 8) !== 32 && canAdjust(ed), run: lazy(() => import('./channels'), (m) => m.applyImageDialog), recordable: false, description: 'Blend a layer or channel into the target layer' },
    { id: 'image.calculations', label: 'Calculations…', enabled: (ed) => ed.hasDocument && (ed.doc.bitsPerChannel ?? 8) !== 32, run: lazy(() => import('./channels'), (m) => m.calculationsDialog), recordable: false, description: 'Combine two channels into a new channel, document or selection' },
    { id: 'image.trap', label: 'Trap…', enabled: (ed) => ed.hasDocument && ed.doc.mode === 'cmyk' && canAdjust(ed), run: lazy(automate, (m) => m.trapCommand), description: 'Spread colors for print misregistration (CMYK documents)' },
    { id: 'file.panorama', label: 'Panorama…', run: lazy(panorama, (m) => m.panoramaDialog), recordable: false, description: 'Stitch overlapping photos into a layered panorama' },
    { id: 'file.merge-hdr', label: 'Merge to HDR…', run: lazy(panorama, (m) => m.mergeHdrDialog), recordable: false, description: 'Merge bracketed exposures into a 32-bit or tone-mapped image' },
    { id: 'file.crop-straighten', label: 'Crop and Straighten Photos', enabled: hasDoc, run: lazy(automate, (m) => m.cropAndStraighten), description: 'Open each photo of a multi-photo scan as its own upright document' },
    { id: 'file.contact-sheet', label: 'Contact Sheet…', run: lazy(automate, (m) => m.contactSheetDialog), recordable: false, description: 'Lay out thumbnails with captions on pages' },
    { id: 'file.fit-image', label: 'Fit Image…', enabled: hasDoc, run: lazy(automate, (m) => m.fitImage), description: 'Resize to fit within a width and height' },
    { id: 'file.conditional-mode', label: 'Conditional Mode Change…', enabled: hasDoc, run: lazy(automate, (m) => m.conditionalModeChange), description: 'Change the color mode only from chosen source modes' },
    { id: 'file.pdf-presentation', label: 'PDF Presentation…', run: lazy(automate, (m) => m.pdfPresentationDialog), recordable: false, description: 'Save images as a multi-page PDF' },
  );
  // Dialog commands record their confirmed settings, not the menu click.
  for (const id of ['edit.auto-align', 'edit.auto-blend', 'adjust.hdr-toning', 'image.trap', 'file.fit-image', 'file.conditional-mode']) deferRecording(id);
}
