// Browser-side diagnostic. Measures the actual editor layout, not raw paragraphs.
export async function recordFontVersionTypography(encoded){

    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {setCanvasTextStyle,canvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
    const {pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
    const host=document.createElement('div');document.body.append(host);
    let editor;
    try{
    editor=new CanvasEditor(host,{...pkg,images});
    const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,pkg.styles?.fontAlternatives);
    const layout=editor.layout;
    return {scope:'Actual CanvasEditor body layout with resolved style and font-alternative context; shaped origins require LTR ASCII, no small caps or text transform, and matching SVG/Canvas advance',lines:layout.lines.map(line=>({page:line.page,baseline:line.baseline,fragments:line.fragments.filter(f=>f.text).map(original=>{
     const f={...original,text:original.capitalization==='caps'?original.text.toUpperCase():canvasText(ctx,original.text,original)};
     const row={text:f.text,inkX:f.inkX??f.x,fontFamily:f.fontFamily,fontSize:f.fontSize,width:f.width,kerning:f.kerning,legacyKerning:f.legacyKerning,characterSpacing:f.characterSpacing};
     if(f.capitalization==='smallCaps'||f.textTransform||f.bidiLevel%2||/[^\x20-\x7e]/.test(f.text))return {...row,skipped:'unsupported shaped-origin oracle input'};
     const scale=1536/f.fontSize;
     setCanvasTextStyle(ctx,{...f,fontSize:1536,characterSpacing:(f.characterSpacing||0)*scale,justificationSpacing:(f.justificationSpacing||0)*scale,kerning:f.kerning?f.kerning*scale:0});
     const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),t=document.createElementNS(svg.namespaceURI,'text');
     Object.assign(svg.style,{position:'fixed',visibility:'hidden',width:'1px',height:'1px',overflow:'visible'});
     Object.assign(t.style,{font:ctx.font,letterSpacing:ctx.letterSpacing,wordSpacing:ctx.wordSpacing,fontKerning:ctx.fontKerning,textRendering:ctx.textRendering,whiteSpace:'pre',fontVariantLigatures:f.ligatures==='none'?'none':'normal'});
     t.textContent=f.text;svg.append(t);document.body.append(svg);
     try{return {...row,contextFont:ctx.font,contextKerning:ctx.fontKerning,glyphs:Array.from({length:t.getNumberOfChars()},(_,i)=>(f.x+t.getStartPositionOfChar(i).x/scale)*.75),advanceError:Math.abs(t.getComputedTextLength()/scale-f.width)};}finally{svg.remove();}
    })}))};

    }finally{
      if(editor)editor.destroy();
      else{for(const image of images.values())image.close?.();images.clear();}
      host.remove();
    }
}
