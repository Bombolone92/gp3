/**
 * Keep PivotTable slicers' saved no-data flags (x14:i@nd) in step with their reports. A choice
 * in one slicer, or a timeline's date range, changes which members of the other slicers on the
 * same reports still have records; Excel saves that as nd on each item and draws such items
 * dimmed (or last, or hidden, by the cache's cross-filter settings). One cache serves every
 * connected report, so an item is flagged when no connected report has data for it.
 */
import { nativePivotSlicerAvailability } from './native-pivot-slicer-availability.js';
import { readNativePivotSlicerState } from './native-pivot-slicer-state.js';
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';

const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';

/** The cache with exactly these member indexes flagged as having no data. */
export function writeNativePivotSlicerNoData(slicer, noData) {
  const root = parseModelXml(slicer.xml);
  const tabular = modelChildren(modelChildren(root, 'data', X14)[0], 'tabular', X14)[0];
  for (const item of modelChildren(modelChildren(tabular, 'items', X14)[0], 'i', X14)) {
    if (noData.has(Number(item.getAttribute('x')))) item.setAttribute('nd', '1');
    else item.removeAttribute('nd');
  }
  return { ...slicer, xml: standaloneModelXml(root) };
}

/** From computed availability (cache → report → items), the caches whose flags change, re-flagged. */
export function nativePivotSlicerNoDataUpdates(availability) {
  const updates = new Map();
  for (const [cache, reports] of availability) {
    const state = readNativePivotSlicerState(cache);
    if (state.crossFilter === 'none') continue; // nd is not written without cross filtering
    const contexts = [...reports.values()];
    if (!contexts.length) continue;
    const noData = new Set(state.items.filter(item => contexts.every(items => items.find(i => i.index === item.index)?.noData)).map(item => item.index));
    if (state.items.some(item => item.noData !== noData.has(item.index))) updates.set(cache, writeNativePivotSlicerNoData(cache, noData));
  }
  return updates;
}

/** Every slicer cache connected to one of these reports, with its flags recomputed against `pivots`. */
export function syncNativePivotSlicers(previous, pivots, sheets, reports) {
  const identity = p => JSON.stringify([p.owner, p.name]);
  const affected = new Set(reports.map(identity));
  const slicers = (previous.slicers || []).filter(s => s.connections.some(c => affected.has(identity(c))));
  if (!slicers.length) return new Map();
  const updates = nativePivotSlicerNoDataUpdates(nativePivotSlicerAvailability(slicers, pivots, sheets));
  return new Map(slicers.map(s => [s, updates.get(s) || s]));
}
