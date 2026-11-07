import{readFileSync}from'node:fs';
import{createHash}from'node:crypto';
export function baselineSources(){
 return {border:readFileSync('tests/fixtures/border-shared-origin/baseline-border-device-layout.js','utf8'),
 editor:readFileSync('tests/fixtures/border-shared-origin/baseline-canvas-editor.js','utf8')};
}
export async function baselineRoute(target){
 const sources=baselineSources();
 await target.route('**/src/engine/border-device-layout.js*',r=>r.fulfill({body:sources.border,contentType:'text/javascript'}));
 await target.route('**/src/engine/canvas-editor.js*',r=>r.fulfill({body:sources.editor,contentType:'text/javascript'}));
}
export function coupledSources(original,editor,{floorBottom=false,widthThreshold=false}={}){
 const archive=JSON.parse(readFileSync('tests/fixtures/border-shared-origin/coupled-pixels.json'));
 const canonical=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
 if(canonical(original)!==archive.baselineBorderCanonicalSha256||canonical(editor)!==archive.baselineEditorCanonicalSha256)
  throw Error('Historical experiment baseline changed; re-audit before recording.');
 if(createHash('sha256').update(readFileSync('tests/fixtures/border-shared-origin/rejected-fill-clip.js')).digest('hex')!==archive.clipSha256)
  throw Error('Historical fill-clipping helper changed; re-audit before recording.');
 let border=original.replace('r.x = sx(s.x); r.y = sy(s.y);','r.x = sx(s.x); r.y = sy(s.y); if (!s.horizontal && Math.floor(s.width * m.a + 1e-6) === 0) r.x -= 1 / m.a;');
 editor="import {displacedRightFillLimits,clippedFillRects} from '/tests/fixtures/border-shared-origin/rejected-fill-clip.js';\n"+editor;
 editor=editor.replace('const tableBorders = deviceTableBorders(ctx, (pageStory ? this.storyLayout.tableBorders : this.layout.tableBorders).filter(stroke => stroke.page === index));','');
 editor=editor.replace('for (const cell of paintedCells) if (cell.page === index) {',"const logicalBorders=(pageStory ? this.storyLayout.tableBorders : this.layout.tableBorders).filter(stroke=>stroke.page===index);\nconst tableBorders=deviceTableBorders(ctx,logicalBorders),fillLimits=displacedRightFillLimits(ctx,paintedCells.filter(c=>c.page===index),logicalBorders,tableBorders);\nfor (const cell of paintedCells) if (cell.page === index) {");
 editor=editor.replace('if (bottom > top && right > left) ctx.fillRect(left, top, right - left, bottom - top);','for(const rect of clippedFillRects(left,top,right,bottom,fillLimits.get(cell)))ctx.fillRect(...rect);');
 if(floorBottom)border=border.replace('r.height = s.horizontal ? Math.max(1, Math.floor(s.height * m.d + 1e-6)) / m.d : sy(s.y + s.height) - r.y;','r.height = s.horizontal ? Math.max(1, Math.floor(s.height * m.d + 1e-6)) / m.d : sy(s.y + s.height) - r.y; if(s.horizontal && s.side === \'bottom\' && s.cellIds?.length === 1) r.y=(Math.round(Math.floor((s.y+s.height)*6.25+1e-6)*.16*m.d+m.f)-m.f)/m.d-r.height;');
 if(widthThreshold){
  if(floorBottom)throw Error('Choose one historical bottom-edge hypothesis');
  border=border.replace('r.x = sx(s.x); r.y = sy(s.y);','r.x = sx(s.x-.08); r.y = sy(s.y-.08);');
  border=border.replace('sx(s.x + s.width) - r.x','sx(s.x + s.width-.08) - r.x');
  border=border.replace('sy(s.y + s.height) - r.y','sy(s.y + s.height-.08) - r.y');
  border=border.replace('if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => pair.map(v => s.horizontal ? sx(s.x + v) - r.x : sy(s.y + v) - r.y));',"if(s.horizontal && s.side==='bottom' && s.cellIds?.length===1){r.y=Math.floor(s.height*m.d+1e-6)===0 ? (Math.round(s.height*m.d)===0 ? sy(s.y-.08)-1/m.d : (Math.floor(s.y*m.d+m.f+1e-6)-m.f)/m.d) : sy(s.y);} if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => pair.map(v => s.horizontal ? sx(s.x + v-.08) - r.x : sy(s.y + v-.08) - r.y));");
 }
 return {border,editor};
}
export async function coupledRoute(target,options={}){
 const baseline=baselineSources(),sources=coupledSources(baseline.border,baseline.editor,options);
 await target.route('**/src/engine/border-device-layout.js*',r=>r.fulfill({body:sources.border,contentType:'text/javascript'}));
 await target.route('**/src/engine/canvas-editor.js*',r=>r.fulfill({body:sources.editor,contentType:'text/javascript'}));
}
