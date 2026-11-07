// Canvas exposes advances but not portable cluster caret positions. A hidden
// DOM range uses the same browser shaper on the complete directional fragment,
// including ligatures. Request only after the complete directional fragment finishes shaping.
export function shapedCaretAdvances(context, text, offsets, width) {
  if (!offsets || !text || typeof document === 'undefined') return;
  const span=document.createElement('span');
  Object.assign(span.style,{
    all:'initial',position:'fixed',left:'0',top:'0',visibility:'hidden',
    pointerEvents:'none',whiteSpace:'pre',display:'inline-block',
    font:context.font,fontKerning:context.fontKerning,
    textRendering:context.textRendering || 'auto',
    fontVariantLigatures:context.textRendering === 'optimizeSpeed' ? 'none' : 'normal',
    letterSpacing:context.letterSpacing || '0px',wordSpacing:context.wordSpacing || '0px',
    direction:context.direction,unicodeBidi:'bidi-override',
  });
  span.textContent=text;document.body.append(span);
  try {
    const rect=span.getBoundingClientRect();
    if(!rect.width) return;
    const range=document.createRange(),rtl=context.direction==='rtl';
    return offsets.map(offset=>{
      if(offset===0) return 0;
      if(offset===text.length) return width;
      range.setStart(span.firstChild,offset);range.collapse(true);
      const caret=range.getBoundingClientRect();
      const advance=rtl ? rect.right-caret.right : caret.left-rect.left;
      return Math.max(0,Math.min(width,advance*width/rect.width));
    });
  } finally {span.remove();}
}
