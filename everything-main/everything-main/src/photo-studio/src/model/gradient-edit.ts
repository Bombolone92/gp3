import type { Layer, PhotoDocument } from "./document";
import { vectorBounds } from "./vector";
import {
  gradientRamp,
  gradientFrame,
  isVectorGradient,
  validateVectorGradient,
  type VectorGradient,
} from "./vector-gradient";
import { vectorColorRgb, vectorHexColor } from "../color/vector";
export function gradientProperty(
  l: Layer,
  doc: PhotoDocument,
  key: string,
  value: string,
  checked: boolean,
): VectorGradient {
  if (!isVectorGradient(l.vector?.fill))
    throw new Error("Expected an editable gradient.");
  const fill = structuredClone(l.vector.fill),
    number = value.trim() === "" ? NaN : Number(value);
  if (key === "gradientAligned") {
    fill.align = checked;
    delete fill.matrix;
    fill.frame = gradientFrame(
      { x: 0, y: 0, width: doc.width, height: doc.height },
      checked,
      l.vector!.psdBounds,
      vectorBounds(l.vector!.mask),
    );
  } else if (key === "gradientReverse") fill.reverse = checked;
  else if (key === "gradientStyle")
    fill.style = value as VectorGradient["style"];
  else if (key === "gradientAngle") fill.angle = number;
  else if (key === "gradientScale") fill.scalePercent = number;
  else if (key === "gradientSmoothness")
    fill.interpolationSamples = (number / 100) * 4096;
  else if (key === "gradientOffsetX" || key === "gradientOffsetY") {
    fill.offsetPercent ??= { x: 0, y: 0 };
    fill.offsetPercent[key === "gradientOffsetX" ? "x" : "y"] = number;
  } else {
    const match =
      /^gradient(Color|Opacity)(\d+)(Color|Location|Midpoint|OpacityPercent)$/.exec(
        key,
      );
    if (!match) throw new Error("Unknown gradient property.");
    const index = Number(match[2]),
      kind = match[1],
      property = match[3],
      stop =
        kind === "Color" ? fill.colorStops[index] : fill.opacityStops[index];
    if (!stop) throw new Error("Missing gradient stop.");
    if (property === "Color" && kind === "Color") {
      if (!/^#[0-9a-f]{6}$/i.test(value))
        throw new Error("Invalid gradient stop color.");
      const rgb = vectorColorRgb(vectorHexColor(value), doc),
        color = fill.colorStops[index];
      color.color = { r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255 };
      color.colorType = "Clry.UsrS";
    } else if (property === "Location") stop.location = number / 100;
    else if (property === "Midpoint") stop.midpoint = number / 100;
    else if (property === "OpacityPercent" && kind === "Opacity")
      fill.opacityStops[index].opacityPercent = number;
    else throw new Error("Invalid gradient stop property.");
  }
  validateVectorGradient(fill);
  return fill;
}
export function gradientStop(
  fill: VectorGradient,
  kind: "color" | "opacity",
  operation: "add" | "remove",
  index?: number,
): VectorGradient {
  const result = structuredClone(fill),
    stops = kind === "color" ? result.colorStops : result.opacityStops;
  if (operation === "remove") {
    if (
      index === undefined ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= stops.length ||
      (kind === "color" && stops.length === 1)
    )
      throw new Error("Cannot remove that gradient stop.");
    stops.splice(index, 1);
  } else {
    if (stops.length >= 256) throw new Error("Gradient stop limit reached.");
    const locations = [0, ...stops.map((s) => s.location), 1].sort(
      (a, b) => a - b,
    );
    let left = 0,
      right = 1,
      gap = -1;
    for (let i = 1; i < locations.length; i++)
      if (locations[i] - locations[i - 1] > gap) {
        left = locations[i - 1];
        right = locations[i];
        gap = right - left;
      }
    const location = (left + right) / 2,
      rgba = gradientRamp(fill)(location);
    if (kind === "color")
      result.colorStops.push({
        location,
        midpoint: 0.5,
        colorType: "Clry.UsrS",
        color: { r: rgba[0] * 255, g: rgba[1] * 255, b: rgba[2] * 255 },
      });
    else
      result.opacityStops.push({
        location,
        midpoint: 0.5,
        opacityPercent: rgba[3] * 100,
      });
  }
  validateVectorGradient(result);
  return result;
}
