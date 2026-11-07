import { isVectorGradient } from "../model/vector-gradient";
import type { Layer, PhotoDocument } from "../model/document";
import type { VectorColor } from "../model/vector";
import { isVectorPattern } from '../model/vector-pattern';
import { decodeIccProfile } from "../model/psd-resources";
import {
  colorTransform,
  convertRgb,
  readRgbProfile,
  srgbProfile,
  linearSrgbProfile,
} from "./profile";

let profileKey: string | undefined, profileDepth: number | undefined;
let cached = srgbProfile;
function profile(doc: PhotoDocument) {
  const key = doc.iccUntaggedProfile ? "" : (doc.iccProfile ?? ""),
    depth = doc.bitsPerChannel ?? 8;
  if (key === profileKey && depth === profileDepth) return cached;
  profileKey = key;
  profileDepth = depth;
  return (cached = readProfile(doc));
}
function readProfile(doc: PhotoDocument) {
  if (doc.iccProfile && !doc.iccUntaggedProfile) {
    try {
      return readRgbProfile(decodeIccProfile(doc.iccProfile));
    } catch {
      return srgbProfile;
    }
  }
  return doc.bitsPerChannel === 32 ? linearSrgbProfile : srgbProfile;
}
export function vectorDocumentRgb(l: Layer, doc: PhotoDocument): number[] {
  if (isVectorGradient(l.vector!.fill)) throw new Error('A gradient fill has no single color.');
  if (isVectorPattern(l.vector!.fill)) throw new Error('A pattern fill has no single color.');
  return vectorColorRgb(l.vector!.fill, doc);
}
export function vectorColorRgb(
  fill: VectorColor,
  doc: PhotoDocument,
): number[] {
  return fill.space === "document"
    ? [...fill.rgb]
    : convertRgb(colorTransform(srgbProfile, profile(doc)), fill.rgb);
}
export function vectorDisplayHex(l: Layer, doc: PhotoDocument) {
  if (isVectorGradient(l.vector!.fill)) throw new Error('A gradient fill has no single color.');
  if (isVectorPattern(l.vector!.fill)) throw new Error('A pattern fill has no single color.');
  return vectorColorHex(l.vector!.fill, doc);
}
export function vectorColorHex(fill: VectorColor, doc: PhotoDocument) {
  const rgb =
    fill.space === "srgb"
      ? fill.rgb
      : convertRgb(colorTransform(profile(doc), srgbProfile), fill.rgb);
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function setVectorColor(l: Layer, hex: string) {
  l.color = hex;
  if (l.vector)
    l.vector.fill = {
      rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ],
      space: "srgb",
    };
}
export function vectorHexColor(hex: string): VectorColor {
  return {
    rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ],
    space: "srgb",
  };
}
