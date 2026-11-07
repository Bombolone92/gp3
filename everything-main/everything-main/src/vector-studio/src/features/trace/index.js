/**
 * Bitmap tracing and image commands:
 *   Object > Trace Image > Make / Make and Expand / Release / Expand
 *   Window > Trace Image (panel)
 *   Object > Crop Image, Create Object Mosaic, Make Pixel Perfect
 *   Embed Image (Properties panel, for linked images)
 * Trace objects are live artwork (see trace-live.js); the trace service
 * re-traces them in a worker when their options change.
 */
import './styles.css';
import './trace-live.js';
import { registerTraceIcons } from './icons.js';
import { TracePanel } from './trace-panel.js';
import { TraceService } from './trace-service.js';
import { registerTraceCommands, selectedImages } from './trace-commands.js';
import { CropImageTool, croppableImage, startCrop } from './crop.js';
import { mosaicDialog } from './mosaic-dialog.js';
import { makePixelPerfect, embedImages } from './image-ops.js';
import { installPropertiesSections } from './properties.js';

export function install(app) {
  registerTraceIcons();
  app.registerPanel(TracePanel);
  app.registerTool(CropImageTool);
  registerTraceCommands(app);
  installPropertiesSections(app);

  const service = new TraceService(app);
  app.traceService = service;
  app.on('active-editor', (ed) => ed && service.watch(ed.doc));
  // Keep the panels' progress and counts current.
  app.on('trace-progress', () => app.dock?.update?.());

  const pathsInSelection = (ed) => (ed ? ed.selectedNodes().some(function has(n) {
    if (n.type === 'path' || n.type === 'compound') return true;
    return n.type === 'group' && !n.live && n.children.some((c) => has(ed.doc.get(c)));
  }) : false);

  app.commands.register([
    {
      id: 'object.cropImage',
      label: 'Crop Image',
      enabled: (a) => Boolean(croppableImage(a.editor)),
      checked: (a) => a.toolId === 'crop-image',
      run: (a) => (a.toolId === 'crop-image' ? a.getTool('crop-image').applyCrop() : startCrop(a)),
    },
    {
      id: 'object.mosaic',
      label: 'Create Object Mosaic...',
      enabled: (a) => selectedImages(a.editor).length === 1,
      run: (a) => mosaicDialog(a),
    },
    {
      id: 'object.pixelPerfect',
      label: 'Make Pixel Perfect',
      enabled: (a) => pathsInSelection(a.editor),
      run: (a) => {
        const ed = a.editor;
        let n = 0;
        ed.doc.transact('Make Pixel Perfect', () => (n = makePixelPerfect(ed.doc, ed.topSelection()).length));
        if (!n) a.notify('Select paths to align to the pixel grid.');
      },
    },
    {
      id: 'image.embed',
      label: 'Embed Image',
      enabled: (a) => selectedImages(a.editor).some((n) => a.editor.doc.assets.get(n.asset)?.external),
      run: async (a) => {
        const ed = a.editor;
        try {
          const n = await embedImages(ed.doc, selectedImages(ed).map((x) => x.id));
          if (n) a.notify(n === 1 ? 'The image is now embedded.' : `${n} images are now embedded.`, { polite: true });
        } catch (err) {
          a.notify(err?.message || 'The image could not be embedded.', { error: true });
        }
      },
    },
  ]);
}
