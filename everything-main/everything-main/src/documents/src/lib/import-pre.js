const paragraphProperties = ['text-align', 'margin-top', 'margin-bottom', 'line-height'];

/** Native PRE conversion reads paragraph styles from its parent, not itself. */
export function preparePreParagraphs(html) {
  if (typeof DOMParser === 'undefined' || !/<pre\b/i.test(html)
    || !/(?:text-align|margin(?:-top|-bottom)?|line-height)\s*:/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const pre of document.querySelectorAll('pre[style]')) {
    const wrapper = document.createElement('div');
    for (const property of paragraphProperties) {
      // Reading longhands resolves margin shorthand without copying horizontal
      // box margins into native paragraph formatting.
      const value = pre.style.getPropertyValue(property);
      if (value) wrapper.style.setProperty(property, value);
    }
    if (!wrapper.style.length) continue;
    pre.before(wrapper);
    wrapper.append(pre);
    changed = true;
  }
  return changed ? document.body.innerHTML : html;
}
