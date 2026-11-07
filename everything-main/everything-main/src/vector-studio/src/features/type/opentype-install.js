/** OpenType shaping, the OpenType panel and the Glyphs panel. */
import { installShaping } from './shaping.js';
import { OpenTypePanel } from './opentype-panel.js';
import { GlyphsPanel } from './glyphs-panel.js';

export function installOpenTypeFeatures(app) {
  installShaping();
  app.registerPanel(GlyphsPanel);
  app.registerPanel(OpenTypePanel);
}
