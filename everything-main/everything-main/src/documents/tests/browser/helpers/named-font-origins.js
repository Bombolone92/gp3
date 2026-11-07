// SVG exposes advance-cell starts. For legacy kern tables these can omit
// glyph placement offsets. Treat them as ink origins only with an equivalent
// xAdvance-only GPOS face and a byte-identical Canvas paint check.
export async function namedFontOrigins(page,bytes){
  return page.evaluate(async encoded=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {loadCanvasFonts,measureCanvasText,setCanvasTextStyle}=await import('/src/engine/canvas-text.js');
    const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
    const pkg=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
    const ctx=document.createElement('canvas').getContext('2d');
    return layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories).lines.map(line=>{
      const f=line.fragments[0],scale=1536/f.fontSize;
      if(f.ligatures!=='none'||/[^\x20-\x7e]/.test(f.text)||f.bidiLevel%2)throw Error('This oracle requires LTR ASCII with disabled ligatures.');
      setCanvasTextStyle(ctx,{...f,fontSize:1536,characterSpacing:f.characterSpacing*scale,kerning:f.kerning*scale});
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),text=document.createElementNS(svg.namespaceURI,'text');
      Object.assign(svg.style,{position:'fixed',visibility:'hidden',width:'1px',height:'1px',overflow:'visible'});
      Object.assign(text.style,{font:ctx.font,letterSpacing:ctx.letterSpacing,fontKerning:ctx.fontKerning,textRendering:ctx.textRendering,whiteSpace:'pre',fontVariantLigatures:'none'});
      text.textContent=f.text;svg.append(text);document.body.append(svg);
      try{return {text:f.text,page:line.page,baseline:line.baseline*.75,contextFont:ctx.font,
        advanceError:Math.abs(text.getComputedTextLength()/scale-f.width),
        origins:Array.from({length:text.getNumberOfChars()},(_,i)=>(f.x+text.getStartPositionOfChar(i).x/scale)*.75)};}
      finally{svg.remove();}
    });
  },bytes.toString('base64'));
}
