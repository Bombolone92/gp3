import { el } from './dom.js';
import { richTextNode } from './rich-text.js';

/** Spacing is presentation only: values and clipboard strings stay unchanged. */
export function formatLayoutNode(layout, text, align = 'left', wrap = false, general = false, richOptions = {}) {
  const filled = layout.runs.some(run => run.type === 'fill' && run.text);
  if (general && filled) align = 'left';
  const node = el('span.number-format-layout', { 'aria-label': text, style: { display: 'inline-block', flex: 'none', whiteSpace: wrap ? 'pre-wrap' : 'pre', ...(wrap ? { maxWidth: '100%', overflowWrap: 'anywhere' } : null), textAlign: align } });
  if (filled && layout.availableWidth != null) node.style.inlineSize = `${layout.availableWidth}px`;
  for (const run of layout.runs) {
    if (run.type === 'break') node.append(el('br'));
    else if (run.type === 'pad') node.append(el('span', { 'aria-hidden': 'true', style: { display: 'inline-block', inlineSize: `${run.width}px` } }));
    else node.append(run.rich ? richTextNode(run.text, run.s, richOptions) : document.createTextNode(run.text));
  }
  return node;
}
