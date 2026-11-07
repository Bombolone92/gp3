// 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
import { HwpError, check, LIMITS } from './binary.js';
import { parseHwp5 } from './hwp5.js';
import { parseHwpx } from './hwpx.js';
import { modelToDocx } from './docx.js';
import { prepareHanwordImages } from './prepare-images.js';
import { prepareHanwordFonts } from './prepare-fonts.js';

const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export async function convertHanword(file) {
  check(file?.size <= LIMITS.file, 'Hanword imports are limited to 32 MB per file.');
  let bytes;
  try {
    bytes = new Uint8Array(await (file.arrayBuffer ? file.arrayBuffer() : new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(file);
    })));
  } catch {
    // A failed read (a revoked blob, a cloud error) is the same kind of answer as a damaged file.
    throw new HwpError('This Hanword file could not be read. Try opening it again.');
  }
  check(bytes.length <= LIMITS.file, 'Hanword imports are limited to 32 MB per file.');
  try {
    let model, format;
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) { format = 'HWP'; model = parseHwp5(bytes); }
    else if (bytes[0] === 0x50 && bytes[1] === 0x4b) { format = 'HWPX'; model = parseHwpx(bytes); }
    else if (new TextDecoder().decode(bytes.subarray(0, 17)) === 'HWP Document File') throw new HwpError('HWP 3 (Hanword 97) is not supported. Save this file as HWP 5 or HWPX in Hanword first.');
    else throw new HwpError('This file is not a valid Hanword HWP or HWPX document.');
    await prepareHanwordImages(model);
    await prepareHanwordFonts(model);
    const blob = new Blob([modelToDocx(model)], { type: MIME });
    return { blob, format, warnings: [...model.warnings] };
  } catch (e) {
    if (e instanceof HwpError) throw e;
    throw new HwpError('This Hanword file could not be converted. It may be damaged or use unsupported document features.');
  }
}
