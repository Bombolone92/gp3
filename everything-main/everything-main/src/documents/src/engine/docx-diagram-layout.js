import {UnsupportedDocumentError} from './errors.js';
import {parseXml} from './docx-xml.js';
import {readDiagramParts,validateEmptyDiagramText,DGM} from './docx-diagram-drawing.js';
import {readDiagramDataModel} from './diagram-data-model.js';
import {buildDiagramLayoutTree} from './diagram-layout-tree.js';
import {solveDiagramLinearGeometry} from './diagram-linear-geometry.js';
import {resolveDiagramStyles} from './diagram-styling.js';
import {WPG,WPS} from './docx-compatibility.js';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const fail=why=>{throw new UnsupportedDocumentError(`diagram layout recalculation with ${why}`);};
const kids=n=>[...(n?.children||[])];
const direct=(n,ns,name)=>kids(n).filter(c=>c.namespaceURI===ns&&c.localName===name);
const attributes=n=>[...(n?.attributes||[])].filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/');
function neutralStyle(xml){
 if(['sp3d','txPr'].includes(xml.localName))return !kids(xml).length&&!attributes(xml).length;
 if(xml.localName!=='scene3d'||attributes(xml).length)return false;
 const [camera,light]=kids(xml);
 return kids(xml).length===2&&camera.namespaceURI===A&&camera.localName==='camera'&&camera.getAttribute('prst')==='orthographicFront'&&attributes(camera).length===1&&!kids(camera).length&&light.namespaceURI===A&&light.localName==='lightRig'&&light.getAttribute('rig')==='threePt'&&light.getAttribute('dir')==='t'&&attributes(light).length===2&&!kids(light).length;
}
export function readRecalculatedDiagram(parts,rels,types,reference,sourcePart,width,height){
 const {dm,lo,qs,cs}=readDiagramParts(parts,rels,types,reference,sourcePart),model=readDiagramDataModel(dm),tree=buildDiagramLayoutTree(lo,model);
 // Visible or decorated text needs the diagram text algorithm. Plain spaces
 // have no ink; the native controls verify its font/margin rules independently.
 for(const point of model.points.values())if(point.type!=='pres'){
  const text=direct(point.xml,DGM,'t');if(text.length>1)fail('duplicate text');validateEmptyDiagramText(text[0]);
  const props=direct(point.xml,DGM,'prSet')[0];
  if(attributes(props).some(a=>a.localName.startsWith('cust')&&!['custT'].includes(a.localName)))fail('custom point layout');
 }
 for(const name of ['bg','whole'])for(const node of direct(dm,DGM,name))if(attributes(node).length||kids(node).some(c=>name!=='bg'||c.namespaceURI!==A||c.localName!=='noFill'||kids(c).length||attributes(c).length))fail('diagram background formatting');
 if(tree.shape&&(tree.shape.getAttribute('type')||'none')!=='none')fail('root shape geometry');
 const geometry=solveDiagramLinearGeometry(tree,width/12700,height/12700);
 for(const {kind,xml}of geometry.pending){
  const type=xml.getAttribute('type');
  if(kind==='rule'?type!=='primFontSz':!['primFontSz','tMarg','bMarg','lMarg','rMarg'].includes(type))fail('unresolved non-geometric constraints');
  if(kids(xml).length)fail('extended text constraints');
  for(const name of ['val','fact','max'])if(xml.hasAttribute(name)&&!(kind==='rule'&&xml.getAttribute(name)==='NaN')&&!Number.isFinite(Number(xml.getAttribute(name))))fail('invalid text constraint values');
 }
 const boxes=geometry.boxes.filter(b=>b.node.algorithm.type!=='sp');
 const styles=resolveDiagramStyles(boxes.map(b=>b.node),qs,cs);
 const doc=parseXml(`<wpg:wgp xmlns:wpg="${WPG}" xmlns:wps="${WPS}" xmlns:a="${A}"/>`),root=doc.documentElement;
 const make=(ns,name,attrs={},parent=root)=>{const n=doc.createElementNS(ns,`${ns===WPG?'wpg':ns===WPS?'wps':'a'}:${name}`);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;};
 make(WPG,'cNvPr',{id:0,name:'Recalculated diagram'});make(WPG,'cNvGrpSpPr');const gp=make(WPG,'grpSpPr'),xf=make(A,'xfrm',{},gp);
 for(const[name,attrs]of [['off',{x:0,y:0}],['ext',{cx:width,cy:height}],['chOff',{x:0,y:0}],['chExt',{cx:width,cy:height}]])make(A,name,attrs,xf);
 for(const [i,box]of boxes.entries()){
  const {node}=box,{properties,style,pending}=styles[i];
  if(pending.some(n=>!neutralStyle(n)))fail('active 3D or text styles');
  const shape=node.shape;if(!shape||kids(shape).some(c=>c.namespaceURI!==DGM||c.localName!=='adjLst'||kids(c).length||attributes(c).length)||attributes(shape).some(a=>!['type','rot'].includes(a.localName)&&!(a.namespaceURI==='http://schemas.openxmlformats.org/officeDocument/2006/relationships'&&a.localName==='blip'&&a.value==='')))fail('unsupported shape declaration');
  const kind=shape.getAttribute('type')||'none';if(kind==='none')continue;
  if(direct(properties,A,'xfrm').length||direct(properties,A,'prstGeom').length||direct(properties,A,'custGeom').length)fail('custom point geometry');
  const sp=make(WPS,'wsp');make(WPS,'cNvPr',{id:i+1,name:'Diagram node'},sp);make(WPS,'cNvSpPr',{},sp);
  const props=make(WPS,'spPr',{},sp),rotation=Number(shape.getAttribute('rot')||0);if(!Number.isFinite(rotation))fail('invalid shape rotation');
  const transform=make(A,'xfrm',rotation?{rot:Math.round(rotation*60000)}:{},props);
  make(A,'off',{x:Math.round(box.x*12700),y:Math.round(box.y*12700)},transform);make(A,'ext',{cx:Math.round(box.width*12700),cy:Math.round(box.height*12700)},transform);
  make(A,'avLst',{},make(A,'prstGeom',{prst:kind},props));
  for(const c of kids(properties))props.append(doc.importNode(c,true));
  if(style){const st=make(WPS,'style',{},sp);for(const c of kids(style))st.append(doc.importNode(c,true));}
  make(WPS,'bodyPr',{},sp);
 }
 return root;
}
