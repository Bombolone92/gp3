import { FontFormatError } from "./binary.ts";

export interface FontEmbeddingPermissions {
  /** Effective bits, with undefined bits in OS/2 versions 0/1 removed. */
  readonly fsType: number;
  readonly level: "installable" | "editable" | "previewPrint" | "restricted";
  readonly canEmbed: boolean;
  readonly canEdit: boolean;
  readonly temporary: boolean;
  readonly noSubsetting: boolean;
  readonly bitmapOnly: boolean;
}

/**
 * OpenType OS/2.fsType, including the version-dependent permission rules.
 * EOT headers have no OS/2 version; their historical rules allow the least
 * restrictive set permission. Pass the actual OS/2 version once available.
 * These flags describe embedding permissions, not a license to bundle fonts.
 * https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype
 */
export const readFontEmbeddingPermissions = (
  raw: number,
  os2Version?: number,
): FontEmbeddingPermissions => {
  if (!Number.isInteger(raw) || raw < 0 || raw > 0xffff)
    throw new FontFormatError("invalid font embedding permission bits");
  if (
    os2Version !== undefined &&
    (!Number.isInteger(os2Version) || os2Version < 0 || os2Version > 0xffff)
  )
    throw new FontFormatError("invalid OS/2 version");
  const fsType = os2Version !== undefined && os2Version <= 1 ? raw & 0xf : raw;
  if (fsType & ~0x30e)
    throw new FontFormatError(
      "reserved font embedding permission bits are set",
    );
  const levels = fsType & 0xe;
  if (os2Version !== undefined && os2Version >= 3 && levels & (levels - 1))
    throw new FontFormatError("conflicting font embedding permissions");
  const level =
    levels & 8
      ? "editable"
      : levels & 4
        ? "previewPrint"
        : levels & 2
          ? "restricted"
          : "installable";
  return {
    fsType,
    level,
    canEmbed: level !== "restricted",
    canEdit: level === "installable" || level === "editable",
    temporary: level !== "installable",
    noSubsetting: !!(fsType & 0x100),
    bitmapOnly: !!(fsType & 0x200),
  };
};
