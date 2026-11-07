import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import { outlinePort } from './core/outline-transport.js';

// PDF.js parses outlines correctly but sending a very deep tree can overflow the native
// structured-clone stack. Flatten only that response; outline.js restores its public shape.
const createDocument = WorkerMessageHandler.createDocumentHandler;
WorkerMessageHandler.createDocumentHandler = function (params, port) {
  return createDocument.call(this, params, outlinePort(port, params.docId));
};
// PDF.js imports this same entry when workers are unavailable.
export { WorkerMessageHandler };
