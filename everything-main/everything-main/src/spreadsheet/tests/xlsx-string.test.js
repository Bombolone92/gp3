import { expect, it } from 'vitest';
import { decodeXlsxString, encodeXlsxAttribute } from '../src/core/xlsx-string.js';

it('protects literal escape text before encoding attribute whitespace and XML-illegal code units', () => {
  const input = '_x0041_ _X00aB_\r\n\t\u0000\u000b\ufffe\ud800𠜎 <&>';
  const encoded = encodeXlsxAttribute(input);
  expect(encoded).toBe('_x005F_x0041_ _x005F_X00aB__x000D__x000A__x0009__x0000__x000B__xFFFE__xD800_𠜎 <&>');
  expect(decodeXlsxString(encoded)).toBe(input);
});
it('decodes once and leaves non-escape syntax and absent attributes alone', () => {
  expect(decodeXlsxString('_x005F_x0041_')).toBe('_x0041_');
  expect(decodeXlsxString('_xD840__xDC0E_')).toBe('𠀎');
  expect(decodeXlsxString('_x41_ _xGGGG_')).toBe('_x41_ _xGGGG_');
  expect(decodeXlsxString(null)).toBeNull();
});
