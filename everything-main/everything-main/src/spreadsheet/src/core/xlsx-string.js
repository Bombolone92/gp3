/** ST_Xstring decoding follows XML entity/attribute normalization and runs once:
 * an escaped underscore must not expose a second escape for recursive decoding. */
export const decodeXlsxString = value => value == null ? value : value.replace(/_x([\da-f]{4})_/gi,
  (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/** Encode ST_Xstring attribute content before ordinary XML escaping. DrawingML
 * xsd:string attributes must not use this codec. MS-OE376 2.1.1127 requires
 * escapes for CR, attribute LF/TAB, and literal escape-leading underscores. */
export const encodeXlsxAttribute = value => String(value).replace(/_(?=x[\da-f]{4}_)/gi, '_x005F_')
  .replace(/[\u0000-\u001f\ud800-\udfff\ufffe\uffff]/gu,
    ch => `_x${ch.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`);
