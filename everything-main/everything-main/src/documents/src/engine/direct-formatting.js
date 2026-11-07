import { RUN_FORMAT, runFormat } from './formatting.js';

// Imported opaque properties count too: clearing direct formatting also removes
// declarations the canvas cannot preview, while retaining the character style.
export function hasDirectRunFormatting(run) {
  return !!run.hasDirectProperties || Object.keys(run.directFormat || {}).length > 0 || Object.keys(run.overrides || {}).length > 0 ||
    !run.styleManaged && Object.entries(runFormat(run)).some(([key, value]) => value !== RUN_FORMAT[key]);
}

export function clearedRun(run) {
  return { ...run, ...RUN_FORMAT, properties: '', directFormat: {}, overrides: {}, hasDirectProperties: false, styleManaged: true };
}

export function hasDirectMarkFormatting(p) {
  return !!p.markHasDirectProperties || Object.keys(p.styleContext?.mark || {}).length > 0 || Object.keys(p.markOverrides || {}).length > 0 ||
    !p.styleContext && Object.entries(runFormat(p.markFormat)).some(([key, value]) => value !== RUN_FORMAT[key]);
}

export function clearMark(p) {
  p.markFormat = runFormat(); p.markOverrides = {}; p.markProperties = ''; p.markPropertiesChanged = true; p.markHasDirectProperties = false;
  if (p.styleContext) p.styleContext = { ...p.styleContext, mark: {} };
}

const hasDeclarations = value => value !== undefined && value !== null && (typeof value !== 'object' || Object.values(value).some(hasDeclarations));
export function hasDirectParagraphFormatting(p) {
  return !!p.hasDirectParagraphProperties || !!p.listChanged || !!p.list && (!p.styleContext || !!p.list.direct) ||
    hasDeclarations(p.formatOverrides) || hasDeclarations(p.styleContext?.properties) || hasDeclarations(p.styleContext?.reference) ||
    !p.styleContext && hasDeclarations(p.format);
}

export function clearParagraph(p) {
  p.format = {}; p.formatOverrides = {}; p.list = null; p.listChanged = false;
  p.paragraphPropertiesCleared = true; p.hasDirectParagraphProperties = false;
  delete p.outlineLevelCleared; delete p.lineSpacingCleared;
  if (p.styleContext) p.styleContext = { ...p.styleContext, properties: {}, reference: {}, numberingDirect: false };
}
