export { FontFormatError } from "./binary.ts";
export { decodeMtxFont } from "./mtx.ts";
export {
  readFontEmbeddingPermissions,
  type FontEmbeddingPermissions,
} from "./permissions.ts";
export {
  readOpenTypeFont,
  type OpenTypeFontInfo,
  type OpenTypeName,
} from "./opentype.ts";
export {
  readEotFont,
  writeEotFont,
  unmaskEotFontData,
  type EotFontInfo,
  type EotFontData,
} from "./eot.ts";
