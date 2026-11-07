import type {
  ColorStop,
  EffectSolidGradient,
  ExtraGradientInfo,
  VectorContent,
} from "ag-psd";
import {
  parseVectorContent,
  parseColor,
  GrdT,
  gradientInterpolationMethodType,
  serializeVectorContent,
  writeVersionAndDescriptor,
  type DescriptorVectorContent,
} from "ag-psd/dist/descriptor";
import { writeSignature, type PsdWriter } from "ag-psd/dist/psdWriter";

// Stop locations use the fixed 0..4096 range, independently of Intr (the
// interpolation/smoothness value); the descriptor stores them as separate fields.
// Keep original double percentages rather than dividing/multiplying by 100.
export type PsdGradientColorStop = ColorStop & { colorType?: string };
export type PsdGradientOpacityStop = {
  location: number;
  midpoint: number;
  opacityPercent: number;
};
export type PsdSolidGradientFill = Omit<
  EffectSolidGradient,
  "smoothness" | "colorStops" | "opacityStops"
> &
  Omit<ExtraGradientInfo, "scale" | "offset"> & {
    interpolationSamples?: number;
    scalePercent?: number;
    offsetPercent?: { x: number; y: number };
    colorStops: PsdGradientColorStop[];
    opacityStops: PsdGradientOpacityStop[];
  };
type LegacyGradient = Extract<VectorContent, { type: "solid" }>;
type Descriptor = Record<string, any>;

function finite(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid PSD gradient number.");
  return value;
}
function range(value: unknown, min: number, max: number, integer = false) {
  const n = finite(value);
  if (n < min || n > max || (integer && !Number.isInteger(n)))
    throw new Error("Invalid PSD gradient range.");
  return n;
}
function unit(value: any, units: "Percent" | "Angle") {
  if (!value || typeof value !== "object" || value.units !== units)
    throw new Error("Invalid PSD gradient units.");
  return finite(value.value);
}
function stopList(value: unknown): Descriptor[] {
  if (!Array.isArray(value)) throw new Error("Invalid PSD gradient stop list.");
  for (const stop of value)
    if (!stop || typeof stop !== "object")
      throw new Error("Invalid PSD gradient stop.");
  return value;
}
function flags(fill: ExtraGradientInfo) {
  for (const flag of [fill.align, fill.reverse, fill.dither])
    if (flag !== undefined && typeof flag !== "boolean")
      throw new Error("Invalid PSD gradient flag.");
  if (fill.angle !== undefined) finite(fill.angle);
}
function color(stop: ColorStop) {
  if (
    !stop.color ||
    !Object.values(stop.color).every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  )
    throw new Error("Invalid PSD gradient color.");
}

/** Canonical solid fills use original percentage/interpolation units. */
export function parsePsdGradientFill(
  descriptor: Descriptor,
): PsdSolidGradientFill | VectorContent {
  if (!descriptor.Grad || descriptor.Grad.GrdF !== "GrdF.CstS")
    return parseVectorContent(descriptor as DescriptorVectorContent);
  const grad = descriptor.Grad;
  if (grad.Intr !== undefined) range(grad.Intr, 0, 4096);
  const colors = stopList(grad.Clrs),
    opacities = stopList(grad.Trns);
  for (const stop of [...colors, ...opacities]) {
    range(stop.Lctn, 0, 4096, true);
    range(stop.Mdpn, 0, 100, true);
  }
  for (const stop of colors)
    if (
      stop.Type !== undefined &&
      (typeof stop.Type !== "string" || !stop.Type.startsWith("Clry."))
    )
      throw new Error("Invalid PSD gradient color-stop type.");
  for (const stop of opacities) range(unit(stop.Opct, "Percent"), 0, 100);
  if (descriptor.Angl !== undefined) unit(descriptor.Angl, "Angle");
  if (descriptor["Scl "] !== undefined) unit(descriptor["Scl "], "Percent");
  if (descriptor.Ofst !== undefined) {
    unit(descriptor.Ofst.Hrzn, "Percent");
    unit(descriptor.Ofst.Vrtc, "Percent");
  }
  if (typeof grad["Nm  "] !== "string")
    throw new Error("Invalid PSD gradient name.");
  const fill: PsdSolidGradientFill = {
    type: "solid",
    name: grad["Nm  "],
    style: GrdT.decode(descriptor.Type),
    colorStops: colors.map((s) => ({
      color: parseColor(s["Clr "]),
      location: s.Lctn / 4096,
      midpoint: s.Mdpn / 100,
      ...(s.Type !== undefined ? { colorType: s.Type } : {}),
    })),
    opacityStops: opacities.map((s) => ({
      location: s.Lctn / 4096,
      midpoint: s.Mdpn / 100,
      opacityPercent: s.Opct.value,
    })),
  };
  if (descriptor.Dthr !== undefined) fill.dither = descriptor.Dthr;
  if (descriptor.Rvrs !== undefined) fill.reverse = descriptor.Rvrs;
  if (descriptor.Algn !== undefined) fill.align = descriptor.Algn;
  if (descriptor.Angl !== undefined) fill.angle = descriptor.Angl.value;
  if (descriptor.gradientsInterpolationMethod !== undefined)
    fill.interpolationMethod = gradientInterpolationMethodType.decode(
      descriptor.gradientsInterpolationMethod,
    );
  flags(fill);
  fill.colorStops.forEach(color);
  if (grad.Intr !== undefined) fill.interpolationSamples = grad.Intr;
  if (descriptor["Scl "] !== undefined)
    fill.scalePercent = descriptor["Scl "].value;
  if (descriptor.Ofst !== undefined)
    fill.offsetPercent = {
      x: descriptor.Ofst.Hrzn.value,
      y: descriptor.Ofst.Vrtc.value,
    };
  return fill;
}

/** Accept normalized dependency inputs too, without whole-percent rounding. */
export function writePsdGradientFill(
  writer: PsdWriter,
  key: "GdFl" | "vscg",
  input: PsdSolidGradientFill | LegacyGradient,
) {
  const fill = input as PsdSolidGradientFill & LegacyGradient;
  flags(fill);
  if (fill.interpolationSamples !== undefined && fill.smoothness !== undefined)
    throw new Error("Ambiguous PSD gradient interpolation units.");
  if (fill.interpolationSamples !== undefined)
    range(fill.interpolationSamples, 0, 4096);
  const samples =
    fill.interpolationSamples ??
    (fill.smoothness !== undefined
      ? range(fill.smoothness, 0, 1) * 4096
      : undefined);
  if (samples !== undefined) range(samples, 0, 4096);
  if (fill.scalePercent !== undefined && fill.scale !== undefined)
    throw new Error("Ambiguous PSD gradient scale units.");
  if (fill.scalePercent !== undefined) finite(fill.scalePercent);
  const scale =
    fill.scalePercent ??
    (fill.scale !== undefined ? finite(fill.scale) * 100 : undefined);
  if (scale !== undefined) finite(scale);
  if (fill.offsetPercent !== undefined && fill.offset !== undefined)
    throw new Error("Ambiguous PSD gradient offset units.");
  for (const point of [fill.offsetPercent, fill.offset])
    if (point !== undefined) {
      if (!point || typeof point !== "object")
        throw new Error("Invalid PSD gradient offset.");
      finite(point.x);
      finite(point.y);
    }
  const offset =
    fill.offsetPercent ??
    (fill.offset
      ? { x: finite(fill.offset.x) * 100, y: finite(fill.offset.y) * 100 }
      : undefined);
  if (offset) {
    finite(offset.x);
    finite(offset.y);
  }
  if (typeof fill.name !== "string")
    throw new Error("Invalid PSD gradient name.");
  const colors = stopList(fill.colorStops);
  let opacities = stopList(fill.opacityStops);
  // No opacity variations means an opaque ramp, but an empty native Trns
  // list causes readers to discard the gradient. Emit its opaque endpoints
  // without mutating the caller's definition. Published interoperability notes:
  // https://github.com/SethRobinson/Patchy/blob/4816d450e6a94e954017629745c06044186b3dec/docs/ps-compat.md
  if (!opacities.length)
    opacities = [
      { location: 0, midpoint: 0.5, opacityPercent: 100 },
      { location: 1, midpoint: 0.5, opacityPercent: 100 },
    ];
  for (const stop of [...colors, ...opacities]) {
    range(stop.location, 0, 1);
    if (stop.midpoint !== undefined) range(stop.midpoint, 0, 1);
  }
  const percentages = opacities.map((stop) => {
    if (stop.opacityPercent !== undefined && stop.opacity !== undefined)
      throw new Error("Ambiguous PSD gradient opacity units.");
    return stop.opacityPercent !== undefined
      ? range(stop.opacityPercent, 0, 100)
      : range(stop.opacity, 0, 1) * 100;
  });
  const legacy: LegacyGradient = {
    ...fill,
    smoothness: samples === undefined ? undefined : samples / 4096,
    colorStops: fill.colorStops,
    opacityStops: opacities.map((s, i) => ({
      location: s.location,
      midpoint: s.midpoint,
      opacity: percentages[i] / 100,
    })),
  };
  colors.forEach((s) => {
    color(s as ColorStop);
    if (
      s.colorType !== undefined &&
      (typeof s.colorType !== "string" || !s.colorType.startsWith("Clry."))
    )
      throw new Error("Invalid PSD gradient color-stop type.");
  });
  const descriptor = serializeVectorContent(legacy).descriptor as Descriptor;
  if (samples === undefined) delete descriptor.Grad.Intr;
  else descriptor.Grad.Intr = samples;
  if (scale !== undefined)
    descriptor["Scl "] = { units: "Percent", value: scale };
  if (offset)
    descriptor.Ofst = {
      Hrzn: { units: "Percent", value: offset.x },
      Vrtc: { units: "Percent", value: offset.y },
    };
  // Locations are integer descriptor codes; smoothness never changes their range.
  colors.forEach((s, i) => {
    const stop = descriptor.Grad.Clrs[i];
    stop.Lctn = Math.round(s.location * 4096);
    if (s.colorType !== undefined) stop.Type = s.colorType;
  });
  opacities.forEach((s, i) => {
    const stop = descriptor.Grad.Trns[i];
    stop.Lctn = Math.round(s.location * 4096);
    stop.Opct = { units: "Percent", value: percentages[i] };
  });
  if (fill.angle !== undefined)
    descriptor.Angl = { units: "Angle", value: fill.angle };
  if (key === "vscg") writeSignature(writer, "GdFl");
  writeVersionAndDescriptor(writer, "", "null", descriptor);
}
