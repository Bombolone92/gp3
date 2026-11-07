/** Character and paragraph styles: the model helpers and the two panels. */
import { CharacterStylesPanel, ParagraphStylesPanel } from './styles-panel.js';

export function installTypeStyles(app) {
  app.registerPanel(CharacterStylesPanel);
  app.registerPanel(ParagraphStylesPanel);
}
