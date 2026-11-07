import {UnsupportedDocumentError} from './errors.js';
const D='http://schemas.openxmlformats.org/drawingml/2006/diagram',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const fail=why=>{throw new UnsupportedDocumentError(`diagram styling with ${why}`);};
const children=n=>[...(n?.children||[])];
function one(n,ns,name){const found=children(n).filter(c=>c.namespaceURI===ns&&c.localName===name);if(found.length>1)fail(`duplicate ${name}`);return found[0];}
function labels(root,kind){
 if(root?.namespaceURI!==D||root.localName!==kind)fail('invalid style roots');
 const result=new Map();
 for(const label of children(root).filter(n=>n.namespaceURI===D&&n.localName==='styleLbl')){
  const name=label.getAttribute('name');if(!name||result.has(name))fail('missing or duplicate style labels');result.set(name,label);
 }
 return result;
}
// Style references remain DrawingML XML so the shared shape/theme renderer
// resolves colors, line merging and effects through its existing code path.
export function resolveDiagramStyles(nodes,styleDefinition,colorDefinition){
 const styles=labels(styleDefinition,'styleDef'),colors=labels(colorDefinition,'colorsDef'),indices=new Map();
 return nodes.map(node=>{
  // Flat text-layout nodes take node1 when no label is
  // specified, even with a different first style and stale presentation labels.
  const name=node.styleLabel||(!node.children.length&&node.algorithm?.type==='tx'?'node1':'');
  const label=styles.get(name),colorLabel=colors.get(name);
  if(!label)fail('an unresolved style label');
  if(node.presentation.length!==1)fail('ambiguous presentation formatting');
  const ordinal=indices.get(name)||0;indices.set(name,ordinal+1);
  const point=node.presentation[0],doc=point.xml.ownerDocument;
  const properties=one(point.xml,D,'spPr')?.cloneNode(true)||doc.createElementNS(D,'dgm:spPr');
  const style=one(label,D,'style')?.cloneNode(true)||null,pending=[];
  for(const container of [styleDefinition,label])for(const item of children(container)){
   if(item.namespaceURI!==D)fail('unsupported style namespace');
   if(['scene3d','sp3d','txPr'].includes(item.localName))pending.push(item);
   else if(!['title','desc','catLst','styleLbl','style'].includes(item.localName))fail('unsupported style markup');
  }
  if(colorLabel)for(const list of children(colorLabel)){
   if(list.namespaceURI!==D||!['fillClrLst','linClrLst','effectClrLst','txLinClrLst','txFillClrLst','txEffectClrLst'].includes(list.localName))fail('unsupported color list');
   if(children(colorLabel).filter(n=>n.localName===list.localName).length!==1)fail('duplicate color lists');
   const entries=children(list);if(!entries.length)continue;
   if((list.getAttribute('meth')||'span')!=='repeat')fail('unsupported color distribution');
   if(entries.some(n=>n.namespaceURI!==A||!['srgbClr','scrgbClr','hslClr','sysClr','schemeClr','prstClr'].includes(n.localName)))fail('invalid list colors');
   const refName={fillClrLst:'fillRef',linClrLst:'lnRef',effectClrLst:'effectRef'}[list.localName];
   if(!refName){pending.push(list);continue;}
   const ref=one(style,A,refName);if(!ref)fail('missing color style reference');
   ref.replaceChildren(entries[ordinal%entries.length].cloneNode(true));
  }
  return {node,properties,style,pending};
 });
}
