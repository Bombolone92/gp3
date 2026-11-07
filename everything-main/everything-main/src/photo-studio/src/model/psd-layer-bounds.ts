import type { Layer } from "ag-psd";

export type PsdLayerBounds = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export function validatePsdBounds(bounds: PsdLayerBounds) {
  if (!bounds || typeof bounds !== "object")
    throw new Error("Invalid PSD layer bounds.");
  const { top, left, bottom, right } = bounds;
  if (
    ![top, left, bottom, right].every(
      (value) =>
        Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
    ) ||
    bottom < top ||
    right < left
  )
    throw new Error(
      "PSD layer bounds exceed signed 32-bit coordinates or are inverted.",
    );
}

// Cached planes define raster dimensions. Cacheless text, vector/fill and
// other declarative layers can still carry a nonempty document rectangle.
export function psdLayerBounds(layer: Layer) {
  const top = layer.top ?? 0,
    left = layer.left ?? 0;
  const pixels = layer.imageData ?? layer.canvas;
  const bottom = pixels ? top + pixels.height : (layer.bottom ?? top);
  const right = pixels ? left + pixels.width : (layer.right ?? left);
  validatePsdBounds({ top, left, bottom, right });
  return { top, left, bottom, right };
}

export function validatePsdLayerBounds(layers: Layer[]) {
  for (const layer of layers) {
    psdLayerBounds(layer);
    if (layer.children) validatePsdLayerBounds(layer.children);
  }
}
