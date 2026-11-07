// Isolated unshipped stroke experiment; production modules are never modified.
// Adaptive hints axis-aligned single outlines. Dash also retains physical dash
// lengths while hinting the pen. Compound/raster-origin discrepancies remain.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const output = process.argv[2];
if (!output) throw Error('Usage: node tools/diagnose-outline-stroke-candidate.mjs <private-output-directory>');
mkdirSync(output, { recursive: true });
let source = readFileSync(new URL('../src/engine/canvas-shapes.js', import.meta.url), 'utf8');
const replace = (before, after) => {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw Error(`Unrecognized source boundary: ${before.slice(0, 70)}`);
  source = source.replace(before, after);
};
replace('function rasterShape(asset, bitmaps, fontAlternatives, fieldContext, patternPlacement, requestedScale = 2) {',
  'export function rasterShape(asset, bitmaps, fontAlternatives, fieldContext, patternPlacement, requestedScale = 2, display) {');
replace('const left = Math.floor(bounds.left), top = Math.floor(bounds.top), width = Math.ceil(bounds.right) - left, height = Math.ceil(bounds.bottom) - top;',
  `if(display){bounds.left-=2/display.scale;bounds.top-=2/display.scale;bounds.right+=2/display.scale;bounds.bottom+=2/display.scale;}
  const left = display ? Math.floor((bounds.left+display.x)*display.scale)/display.scale-display.x : Math.floor(bounds.left),
    top = display ? Math.floor((bounds.top+display.y)*display.scale)/display.scale-display.y : Math.floor(bounds.top),
    width = display ? Math.ceil((bounds.right+display.x)*display.scale)/display.scale-display.x-left : Math.ceil(bounds.right)-left,
    height = display ? Math.ceil((bounds.bottom+display.y)*display.scale)/display.scale-display.y-top : Math.ceil(bounds.bottom)-top;`);
replace('const resolution = drawingRasterScale(width,height,requestedScale);',
  'const resolution = display ? display.scale * Math.max(1,Math.ceil(2/display.scale)) : drawingRasterScale(width,height,requestedScale);');
replace('const canvas = new OffscreenCanvas(Math.max(1, width * resolution), Math.max(1, height * resolution));',
  'const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * resolution)), Math.max(1, Math.round(height * resolution)));');
const normalStroke = `ctx.save(); ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
          ctx.strokeStyle = node.outline.color;
          ctx.lineWidth = node.outline.width / EMU_PER_PX;`;
replace(normalStroke, `const m=ctx.getTransform(),factor=display ? resolution/display.scale : 1;
          const screenPen = display && Math.abs(m.b)<1e-12 && Math.abs(m.c)<1e-12 && (!node.outline.dash || display.mode==='dash') ? Math.max(1,Math.round(node.outline.width/EMU_PER_PX*display.scale))*factor : null;
          let screenPath=null;
          if(screenPen!==null){const device=projectedOutline(path,node.width,node.height,new DOMMatrix([m.a/factor,m.b/factor,m.c/factor,m.d/factor,m.e/factor,m.f/factor]),screenPen/factor,'bounds');screenPath=new Path2D();screenPath.addPath(device,new DOMMatrix([factor,0,0,factor,0,0]));}
          ctx.save(); ctx.setTransform(screenPath ? 1 : resolution,0,0,screenPath ? 1 : resolution,0,0);
          ctx.strokeStyle = node.outline.color;
          ctx.lineWidth = screenPath ? screenPen : node.outline.width / EMU_PER_PX;`);
replace('ctx.stroke(); ctx.restore();\n        }\n      }', 'if(screenPath)ctx.stroke(screenPath);else ctx.stroke(); ctx.restore();\n        }\n      }');
replace('\n          ctx.setLineDash(drawingLineDash(node.outline.dash, node.outline.cap).map(length => length * ctx.lineWidth));',
  '\n          ctx.setLineDash(drawingLineDash(node.outline.dash, node.outline.cap).map(length => length * node.outline.width / EMU_PER_PX * (screenPath ? resolution : 1)));');
replace("if (typeof node.fill === 'string') { ctx.fillStyle = node.fill; ctx.fill(); }",
  `if (typeof node.fill === 'string') {
    ctx.fillStyle=node.fill;
    const m=ctx.getTransform(),factor=display ? resolution/display.scale : 1;
    if(display?.fills && Math.abs(m.b)<1e-12 && Math.abs(m.c)<1e-12){
      const fillPen=display.fillStroke && node.outline ? Math.max(1,Math.round(node.outline.width/EMU_PER_PX*display.scale)) : 0;
      const device=projectedOutline(path,node.width,node.height,new DOMMatrix([m.a/factor,m.b/factor,m.c/factor,m.d/factor,m.e/factor,m.f/factor]),fillPen);
      const physical=new Path2D();physical.addPath(device,new DOMMatrix([factor,0,0,factor,0,0]));
      ctx.save();ctx.resetTransform();ctx.fill(physical);ctx.restore();
    }else ctx.fill();
  }`);
source += `
function projectedOutline(path,width,height,m,pen) {
  const p=new Path2D(),offset=pen%2 ? .5 : 0,x=Math.round(m.e),y=Math.round(m.f);
  const transform=new DOMMatrix([
    width ? (Math.round(m.e+m.a*width)-x)/width : m.a,
    width ? (Math.round(m.f+m.b*width)-y)/width : m.b,
    height ? (Math.round(m.e+m.c*height)-x)/height : m.c,
    height ? (Math.round(m.f+m.d*height)-y)/height : m.d,x+offset,y+offset]);
  const local=new Path2D();appendPath(local,path,width,height);p.addPath(local,transform);return p;
}
`;
source = source.replace(/from '\.\/([^']+)'/g, "from 'http://127.0.0.1:5173/src/engine/$1'");
const names = process.env.OUTLINE_FIXTURE_NAMES?.split(',') || ['rotation-alpha','dash-compound','alpha-only'];
const zooms = process.env.OUTLINE_ZOOMS?.split(',').map(Number);
const modes = process.env.OUTLINE_MODES?.split(',') || ['baseline','adaptive','dash'];
if (modes.some(mode => !['baseline','adaptive','dash','isolated','fills','fillStroke'].includes(mode))) throw Error('Unknown OUTLINE_MODES value.');
if (zooms?.some(z => !Number.isFinite(z) || z <= 0)) throw Error('OUTLINE_ZOOMS must contain positive numeric scales.');
const inputs = Object.fromEntries(names.map(name => [name, [...readFileSync(process.env.OUTLINE_FIXTURE_DIR
  ? join(process.env.OUTLINE_FIXTURE_DIR, `${name}.docx`)
  : new URL(`../tests/fixtures/outline-stroke-holdouts/${name}.docx`, import.meta.url))]]));
if (process.argv[3]) inputs.corpus = [...readFileSync(process.argv[3])];
const editorSource = null;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/playground.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const results = await page.evaluate(async ({ inputs, source, editorSource, zooms, modes }) => {
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    const { rasterShape }=await import(url);URL.revokeObjectURL(url);
    const { openCanvasDocument }=await import('/src/engine/open-document.js');
    const editorUrl=editorSource ? URL.createObjectURL(new Blob([editorSource],{type:'text/javascript'})) : '/src/engine/canvas-editor.js';
    const { CanvasEditor }=await import(editorUrl);if(editorSource)URL.revokeObjectURL(editorUrl);
    const output=[];
    // This experiment leaves incompatible assets on their ORIGINAL decode and
    // raster origin. Suppressing pen hints inside a shifted bitmap did not do so.
    const hintable = scene => {
      let ink=false;
      const visit=node=>{
        if(node.shadow||node.groupRotation||node.shapeRotation||node.lineRotation||node.pictureRotation||node.type==='picture3d')return false;
        if(node.outline){
          if(node.outline.compound||node.outline.headEnd||node.outline.tailEnd)return false;
          ink=true;
        }
        return (node.children||[]).every(visit);
      };
      return visit(scene)&&ink;
    };
    for(const [name,bytes] of Object.entries(inputs))for(const mode of modes) {
      const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
      let painted=0,replacedAssets=0,retainedAssets=0;
      if(mode!=='baseline')for(const [id,asset] of Object.entries(pkg.assets))if(asset.scene&&asset.scene.type!=='picture3d'&&!asset.shadow) {
        if(['isolated','fills','fillStroke'].includes(mode)&&!hintable(asset.scene)){retainedAssets++;continue;}
        replacedAssets++;
        const original=images.get(id);let key,current;
        images.set(id,{...original,forPage(context,placement){
          const next=JSON.stringify([context,placement]);
          if(key!==next){
            const frame=placement||{x:0,y:0,pixelRatio:1};
            const candidate=rasterShape(asset,images,pkg.styles.fontAlternatives,context,undefined,2,{...frame,scale:frame.pixelRatio,mode:['isolated','fills','fillStroke'].includes(mode)?'dash':mode,fills:['fills','fillStroke'].includes(mode),fillStroke:mode==='fillStroke'});
            current?.close();current=candidate;key=next;painted++;
          }
          return current;
        },close(){original.close();current?.close();}});
      }
      const host=document.createElement('div');document.body.append(host);const errors=[];
      const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
      try {
        for(const zoom of zooms || [1,2]) {
          editor.setZoom(zoom);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          output.push({name,mode,zoom,readOnly:!!pkg.readOnly,errors:[...errors],pages:editor.canvases.length,painted,replacedAssets,retainedAssets,
            png:editor.canvases[0].toDataURL()});
        }
      }finally{editor.destroy();host.remove();}
    }
    return output;
  }, { inputs, source, editorSource, zooms, modes });
  for(const r of results) {
    writeFileSync(join(output,`${r.name}-${r.mode}-${r.zoom*100}.png`),Buffer.from(r.png.split(',')[1],'base64'));delete r.png;
  }
  writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({captures:results.length,errors:results.filter(r=>r.errors.length),output}));
}finally{await browser.close();}
