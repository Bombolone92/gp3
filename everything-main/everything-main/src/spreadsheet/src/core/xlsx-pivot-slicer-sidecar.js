/**
 * PivotTable slicers are not written as Excel slicer parts: desktop Excel rejected the parts this
 * exporter wrote (it repaired the file and removed every PivotTable slicer). Until a file written
 * by Excel itself can be compared part by part, a PivotTable slicer travels in the app's own data
 * instead: its native cache definition, the PivotCache it reads (by position, as the caches are
 * exported in order) and its reports (by sheet name). The filter it chose is always in the file,
 * as the PivotTable's hidden items, so Excel shows the filtered report without the slicer box.
 */
import { normalizeNativePivotSlicers } from './native-pivot-slicer-storage.js';
import { normalizeSlicer, slicerItems } from './slicer.js';
import { sheetKey } from './refs.js';
import { nativePivotSlicerParts } from './xlsx-export-slicers.js';

/** The app-data record of a workbook's PivotTable slicer caches, or null when it has none. */
export function pivotSlicerSidecar(wb) {
  const pivots = wb.nativePivots;
  if (!pivots?.slicers?.length || nativePivotSlicerParts.enabled) return null;
  return pivots.slicers.map(slicer => ({ xml: slicer.xml, cacheIndex: pivots.caches.findIndex(c => c.key === slicer.cache),
    connections: slicer.connections.map(c => ({ sheet: c.owner == null ? null : wb.sheet(c.owner)?.name ?? null, name: c.name })) }))
    .filter(s => s.cacheIndex >= 0);
}

/**
 * Bring the app-data PivotTable slicers back after the native PivotTables are read: the caches
 * whose PivotCache and reports are still there, and the slicer views of `savedSheets` bound to
 * them. Anything another application changed out from under them is left out, not guessed.
 */
export function restorePivotSlicerSidecar(wb, saved, savedSheets) {
  const pivots = wb.nativePivots;
  if (!Array.isArray(saved) || !saved.length || !pivots) return;
  const existing = new Set((pivots.slicers || []).map(s => sheetKey(s.name)));
  const restored = [];
  for (const record of saved) {
    try {
      const cache = pivots.caches[record?.cacheIndex];
      if (!cache || typeof record.xml !== 'string' || !Array.isArray(record.connections)) continue;
      const connections = record.connections.map(c => ({ owner: c.sheet == null ? null : wb.sheetByName(c.sheet)?.id ?? '\u0000missing', name: c.name }));
      const [slicer] = normalizeNativePivotSlicers([{ xml: record.xml, cache: cache.key, connections }], pivots);
      if (existing.has(sheetKey(slicer.name))) continue;
      existing.add(sheetKey(slicer.name)); restored.push(slicer);
    } catch (error) { console.warn('A PivotTable slicer saved with this workbook no longer matches its PivotTable; it is left out:', error?.message || error); }
  }
  if (!restored.length) return;
  wb.nativePivots = { ...pivots, slicers: [...(pivots.slicers || []), ...restored] };
  const names = new Set(restored.map(s => sheetKey(s.name)));
  for (const sheet of wb.sheets) {
    for (const raw of savedSheets?.[sheet.name]?.charts || []) {
      if (raw?.type !== 'slicer' || typeof raw.pivotCache !== 'string' || !names.has(sheetKey(raw.pivotCache))) continue;
      if (sheet.charts.some(c => c.id === raw.id)) continue;
      const control = normalizeSlicer(raw);
      try { if (control && slicerItems(wb, control)) sheet.charts.push(control); } catch { /* an unreadable binding stays out */ }
    }
  }
}
