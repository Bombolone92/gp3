import { el } from './dom.js';
/** Only the core icon catalogue supplies iconImage; imported SVG is never used. */
export function conditionalIconNode(icon, print = false) {
  const spacing = icon.iconOnly ? { marginRight: '0' } : {};
  if (!icon.iconImage) return el('span.cf-icon', { style: { color: icon.iconColor, ...spacing }, 'aria-hidden': 'true' }, icon.icon);
  return el('img.cf-icon', { src: icon.iconImage, alt: '', 'aria-hidden': 'true', width: 16, height: 16,
    style: { width: '16px', height: '16px', flex: 'none', verticalAlign: 'middle',
      ...spacing,
      ...(print && !icon.iconOnly ? { position: 'absolute', left: '2px', top: '50%', transform: 'translateY(-50%)' } : {}) } });
}
