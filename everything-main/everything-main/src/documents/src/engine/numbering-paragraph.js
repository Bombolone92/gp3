import { resolvedFormat } from './formatting.js';
import { mergeSpacing } from './line-spacing.js';

/**
 * Paragraph properties a numbering level's pPr (§17.9.23) contributes besides
 * its geometry (indents, tabs, contextual spacing). Each takes the level's place
 * in the §17.7.2 cascade for the list's paragraphs.
 */
export const LEVEL_PARAGRAPH_KEYS = Object.freeze(['spacing', 'alignment', 'keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'paragraphBorders', 'paragraphShading', 'mirrorIndents', 'suppressAutoHyphens', 'suppressLineNumbers']);
/** The WordprocessingML elements carrying those properties, as read in a level's pPr. */
export const LEVEL_PARAGRAPH_ELEMENTS = Object.freeze(['keepNext', 'keepLines', 'pageBreakBefore', 'widowControl', 'pBdr', 'shd', 'spacing', 'jc', 'mirrorIndents', 'suppressAutoHyphens', 'suppressLineNumbers']);

export function levelParagraphPatch(properties = {}) {
  const result = {};
  for (const key of LEVEL_PARAGRAPH_KEYS) {
    if (!(key in properties)) continue;
    if (key === 'spacing' || key === 'paragraphBorders') { if (Object.keys(properties[key] || {}).length) result[key] = { ...properties[key] }; }
    else result[key] = properties[key];
  }
  return result;
}

function merge(base, patch = {}) {
  return { ...base, ...patch, spacing: mergeSpacing(base.spacing, patch.spacing), paragraphBorders: { ...base.paragraphBorders, ...patch.paragraphBorders } };
}

const SPACING_GROUPS = [
  [['before', 'beforeLines', 'beforeAutospacing'], ['spaceBefore', 'autoSpaceBefore', 'explicitSpaceBefore']],
  [['after', 'afterLines', 'afterAutospacing'], ['spaceAfter', 'autoSpaceAfter', 'explicitSpaceAfter']],
  [['line', 'lineRule'], ['lineSpacing', 'lineRule']],
];

/**
 * Apply a level's declared paragraph properties to `result`, a list paragraph's
 * resolved format. `context` holds the base (defaults and table style), paragraph
 * style chain and direct patches. Style numbering ranks the level below the
 * paragraph style; direct numbering ranks it above. Direct properties and edits
 * (formatOverrides) always win.
 */
export function applyLevelParagraph(result, declared, context, direct, overrides = {}) {
  if (!declared || !context) return result;
  const chain = direct ? [context.base, context.style, declared, context.direct] : [context.base, declared, context.style, context.direct];
  const derived = resolvedFormat(chain.reduce((properties, patch) => merge(properties, patch), {}));
  for (const [attributes, keys] of SPACING_GROUPS) {
    if (!attributes.some(name => name in (declared.spacing || {})) || keys.some(key => Object.hasOwn(overrides, key))) continue;
    for (const key of keys) { if (key in derived) result[key] = derived[key]; else delete result[key]; }
  }
  for (const key of LEVEL_PARAGRAPH_KEYS) {
    if (key === 'spacing' || !(key in declared)) continue;
    if (key === 'paragraphBorders') result.paragraphBorders = { ...derived.paragraphBorders, ...overrides.paragraphBorders };
    else if (!Object.hasOwn(overrides, key)) result[key] = derived[key];
  }
  return result;
}
