import { normalizeDataModel } from './data-model.js';
import { inspectDataModel } from './xlsx-data-model.js';
import { modelConnectionId } from './data-model-bindings.js';
import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { prepareNativeModelPivotMembers } from './native-pivot-model-members.js';
import { planNativePivotReport } from './native-pivot-report.js';
import { prepareNativePivotReportUpdates } from './native-pivot-refresh-plan.js';
import { commitNativePivotReports } from './native-pivot-commit.js';
import { effectiveColorPalette } from './font-color.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const fail = reason => { throw new Error(`Cannot publish native model refresh: ${reason}`); };

/** Publish an already computed model snapshot together with all of its native
 * caches and reports. The caller owns source reads, model storage rebuilding,
 * relationships and collation; this operation never substitutes worksheet data
 * for the supplied snapshot. Requiring the previous model prevents stale work
 * from replacing a newer model. All preparation and commit preflight precede
 * mutation, including failures in a later cache/report or conditional rule.
 *
 * maxValues bounds each model/member calculation; maxCells and maxCacheCells
 * bound the complete published cell/cache batch. Page captions, unused model
 * caches and slicer availability need their own refresh semantics and currently
 * fail explicitly rather than leaving a consumer on an older snapshot.
 */
export function publishNativeModelRefresh(wb, { previous, next } = {}, {
  maxCells = 1048576, maxCacheCells = 4 * 1048576, maxValues = 4 * 1048576,
} = {}) {
  if (!Number.isSafeInteger(maxCells) || maxCells < 0 || ![maxValues, maxCacheCells].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 16 * 1048576)) fail('invalid work limits');
  if (!previous || wb.dataModel !== previous) fail('stale model');
  const model = normalizeDataModel(next), pivots = wb.nativePivots;
  if (!model || model.modelXml !== previous.modelXml || model.connectionsXml !== previous.connectionsXml) fail('invalid model or changed bindings');
  const schema = inspectDataModel(model), counts = new Map(), modelIds = new Set();
  for (const connection of schema.bindings.connections) {
    const id = modelConnectionId(connection.id); counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const connection of schema.bindings.connections.filter(c => c.model)) {
    const id = modelConnectionId(connection.id);
    if (id === null || counts.get(id) !== 1) fail('ambiguous model connection');
    modelIds.add(id);
  }
  if (!pivots) {
    const label = 'Refresh Data Model';
    wb.transaction(label, () => {
      const apply = value => { wb.dataModel = value; wb._changed('pivots'); };
      apply(model);
      wb._push({ label, undo: () => apply(previous), redo: () => apply(model) });
    });
    return true;
  }
  const palette = effectiveColorPalette(wb.colorPalette), paintContext = {
    themes: { fontTheme: wb.fontTheme, themeElements: { clrScheme: palette.theme.map(rgb => ({ rgb: rgb?.slice(1) })) }, indexedColors: palette.indexed.map(rgb => rgb?.slice(1)) },
    numberFormats: pivots.formats,
  };
  const cacheUpdates = new Map();
  function* reports() {
    for (const cache of pivots.caches) {
      const source = modelChildren(parseModelXml(cache.xml), 'cacheSource', MAIN);
      if (source.length !== 1) fail('missing or ambiguous cache source');
      if (source[0].getAttribute('type') !== 'external' || !modelIds.has(modelConnectionId(source[0].getAttribute('connectionId')))) continue;
      if (pivots.slicers?.some(s => s.cache === cache.key)) fail('model slicer availability refresh is not implemented');
      const prepared = prepareNativeModelPivotMembers(pivots, cache.key, model, { maxValues });
      cacheUpdates.set(cache, prepared.cache);
      for (const { pivot, next: report } of prepared.reports) {
        const sheet = wb.sheet(pivot.owner);
        if (!sheet || sheet.kind === 'chart') fail('non-worksheet report');
        const plan = planNativePivotReport(report, prepared.cache, { dataModel: model, nativePivots: pivots,
          paintContext, conditionalRules: sheet.rules, sheetName: sheet.name, maxCells, maxValues });
        yield { pivot, cache, nextCache: prepared.cache, plan };
      }
    }
  }
  const { updates, rules } = prepareNativePivotReportUpdates(wb, reports(), { maxCells });
  return commitNativePivotReports(wb, updates, { rules, cacheUpdates, maxCells, maxCacheCells,
    dataModelUpdate: { previous, next: model } });
}
