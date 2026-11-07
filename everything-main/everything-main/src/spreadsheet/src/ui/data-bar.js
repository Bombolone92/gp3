/** Shared cell/print data-bar paint. Color is sanitized by the rule model. */
export function paintDataBar(node, cf) {
  const pct = cf.bar * 100;
  if (cf.barNative) {
    // A nested viewport keeps border thickness in CSS pixels as the cell resizes.
    // Its clipped 2px stroke leaves the native 1px inner border on every edge.
    const gradient = `<defs><linearGradient id="bar" x1="${cf.barReverse ? 100 : 0}%" x2="${cf.barReverse ? 0 : 100}%"><stop stop-color="${cf.barColor}"/><stop offset="1" stop-color="${cf.barColor}" stop-opacity="0"/></linearGradient></defs>`;
    const bar = pct > 0 ? `<svg x="${cf.barStart * 100}%" width="${pct}%" height="100%" overflow="hidden">${cf.barGradient ? gradient : ''}<rect width="100%" height="100%" fill="${cf.barGradient ? 'url(#bar)' : cf.barColor}"${cf.barBorderColor ? ` stroke="${cf.barBorderColor}" stroke-width="2"` : ''}/></svg>` : '';
    const axis = cf.barAxis == null ? '' : `<line x1="${cf.barAxis * 100}%" x2="${cf.barAxis * 100}%" y1="0" y2="100%" stroke="${cf.barAxisColor}" stroke-dasharray="1 1"/>`;
    node.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${bar}${axis}</svg>`)}")`;
    node.style.backgroundRepeat = 'no-repeat';
    node.style.backgroundSize = 'calc(100% - 4px) calc(100% - 4px)';
    node.style.backgroundPosition = '2px 50%';
    return;
  }
  node.style.backgroundImage = cf.barGradient
    ? `linear-gradient(to right, ${cf.barColor}, ${cf.barColor}00 ${pct}%, transparent ${pct}%)`
    : `linear-gradient(to right, ${cf.barColor} ${pct.toFixed(1)}%, transparent ${pct.toFixed(1)}%)`;
  node.style.backgroundRepeat = 'no-repeat';
  node.style.backgroundSize = cf.barGradient ? 'calc(100% - 4px) calc(100% - 4px)'
    : cf.barFullHeight ? '100% calc(100% - 4px)' : '100% 70%';
  node.style.backgroundPosition = cf.barGradient ? '2px 50%' : '0 50%';
}
