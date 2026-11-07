import { PDFContext, decodePDFRawStream } from 'pdf-lib';

/**
 * The most a single stream may expand to when pdf-lib decodes it. A few kilobytes of Flate data
 * can expand to gigabytes, and pdf-lib decodes object streams in full while it opens a file, so
 * a small crafted PDF could otherwise exhaust the tab's memory before any size check applies.
 */
export const MAX_DECODED_STREAM_SIZE = 256 * 1024 * 1024;

export class DecodedStreamTooLargeError extends Error {
  constructor() {
    super('A part of this PDF expands to more data than the editor can hold.');
    this.name = 'DecodedStreamTooLargeError';
  }
}

// pdf-lib does not export its decoder base class; reach it through a decoder it returns.
let proto = Object.getPrototypeOf(decodePDFRawStream(PDFContext.create().flateStream('')));
while (proto && !Object.prototype.hasOwnProperty.call(proto, 'ensureBuffer'))
  proto = Object.getPrototypeOf(proto);
if (proto && !proto.ensureBuffer.limited) {
  const ensureBuffer = proto.ensureBuffer;
  const limited = function (requested) {
    if (requested > MAX_DECODED_STREAM_SIZE) throw new DecodedStreamTooLargeError();
    return ensureBuffer.call(this, requested);
  };
  limited.limited = true;
  proto.ensureBuffer = limited;
}
