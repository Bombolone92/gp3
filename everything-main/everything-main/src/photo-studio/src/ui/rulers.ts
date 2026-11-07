import type { PhotoDocument } from '../model/document';
import { documentPpi } from '../model/text-layer';
import { pixelsPerUnit, RULER_UNITS, type RulerUnit } from '../imaging/measure/geometry';

/** Document pixels per ruler unit along each axis (percent follows the side). */
export function rulerUnitScale(doc: PhotoDocument, unit: string | undefined) {
  const u = (RULER_UNITS.some(([id]) => id === unit) ? unit : 'px') as RulerUnit;
  const ppi = documentPpi(doc);
  return { x: pixelsPerUnit(u, ppi, doc.width), y: pixelsPerUnit(u, ppi, doc.height) };
}

export function rulerTicks(length: number, origin: number, zoom: number, vertical = false, pxPerUnit = 1) {
  // Label every 1, 2, or 5 × power of ten units, about 70 screen pixels apart.
  const unitZoom = zoom * pxPerUnit;
  const ideal = 70 / unitZoom;
  const power = 10 ** Math.floor(Math.log10(ideal));
  const step = ([1, 2, 5, 10].find((n) => n * power >= ideal) ?? 10) * power;
  const minor = step / 5;
  const first = Math.floor(-origin / (minor * unitZoom));
  const last = Math.ceil((length - origin) / (minor * unitZoom));
  let html = '';
  for (let i = first; i <= last; i++) {
    const value = i * minor,
      position = origin + value * unitZoom;
    const major = i % 5 === 0;
    html += `<span class="${major ? 'major' : ''}" style="${vertical ? 'top' : 'left'}:${position}px">${major ? `<b>${Math.round(value * 100) / 100}</b>` : ''}</span>`;
  }
  return html;
}
