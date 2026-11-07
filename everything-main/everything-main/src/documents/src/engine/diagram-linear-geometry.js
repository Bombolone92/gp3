import {UnsupportedDocumentError} from './errors.js';
const DGM='http://schemas.openxmlformats.org/drawingml/2006/diagram';
const fail=reason=>{throw new UnsupportedDocumentError(`diagram linear geometry with ${reason}`);};
const dimension=type=>type==='w'||type==='h';
const value=(xml,name,fallback)=>{const raw=xml.getAttribute(name);const number=raw===null?fallback:Number(raw);if(raw!==null&&!raw.trim()||!Number.isFinite(number))fail(`invalid ${name}`);return number;};
function matches(node,type){
 if(type==='all')return true;
 if(type==='node')return ['node','asst'].includes(node.point.type);
 if(type==='norm')return node.point.type==='node';
 if(type==='nonNorm')return node.point.type!=='node';
 if(type==='nonAsst')return node.point.type!=='asst';
 if(!['doc','asst','parTrans','pres','sibTrans'].includes(type))fail('unknown point filter');
 return node.point.type===type;
}
function select(context,xml,reference=false){
 const axis=xml.getAttribute(reference?'refFor':'for')||'self';
 const name=xml.getAttribute(reference?'refForName':'forName')||'';
 const type=xml.getAttribute(reference?'refPtType':'ptType')||'all';
 let nodes;
 if(axis==='self')nodes=[context];
 else if(axis==='ch')nodes=context.children;
 else fail('unsupported constraint axis');
 return nodes.filter(n=>(!name||n.name===name)&&matches(n,type));
}

// Resolve flat horizontal linear geometry only. Text/style/rule work is returned
// explicitly as pending: this result is not an editable-import capability claim.
export function solveDiagramLinearGeometry(tree,width,height){
 if(![width,height].every(n=>Number.isFinite(n)&&n>0))fail('invalid frame');
 if(tree.algorithm?.type!=='lin')fail('a non-linear root');
 const direction=tree.algorithm.params.linDir||'fromL';
 if(!['fromL','fromR'].includes(direction)||Object.keys(tree.algorithm.params).some(k=>k!=='linDir'))fail('unsupported linear parameters');
 if(!tree.children.length||tree.children.some(n=>n.children.length||!['tx','sp'].includes(n.algorithm?.type)||Object.keys(n.algorithm.params).length))fail('unsupported child algorithms');
 const nodes=[tree,...tree.children],equations=new Map(nodes.map(n=>[n,new Map()])),pending=[],equalities=[];
 for(const context of nodes){
  for(const xml of context.rules)pending.push({node:context,kind:'rule',xml});
  for(const xml of context.constraints){
   if(xml.namespaceURI!==DGM||xml.localName!=='constr'||xml.children.length)fail('unsupported constraint markup');
   const type=xml.getAttribute('type');
   if(!dimension(type)){pending.push({node:context,kind:'constraint',xml});continue;}
   const op=xml.getAttribute('op')||'none';if(!['none','equ'].includes(op))fail('unsupported constraint operator');
   const targets=select(context,xml),refType=xml.getAttribute('refType')||'none';
   if(!xml.hasAttribute('val')&&refType==='none'&&op==='equ'){equalities.push({targets,type});continue;}
   if(refType!=='none'&&!dimension(refType))fail('unsupported dimension reference');
   const refs=refType==='none'?[]:select(context,xml,true);
   if(refType!=='none'&&!refs.length)fail('unresolved reference');
   for(const target of targets){
    if(target===tree)fail('root dimension overrides');
    if(equations.get(target).has(type))fail('conflicting dimension constraints');
    equations.get(target).set(type,{refs,refType,factor:value(xml,'fact',1),literal:value(xml,'val',0)*72/25.4});
   }
  }
 }
 function evaluate(scale){
  const memo=new Map([[tree,new Map([['w',width],['h',height]])]]),active=new Map();
  function read(node,type){
   if(memo.get(node)?.has(type))return memo.get(node).get(type);
   if(active.get(node)?.has(type))fail('cyclic dimensions');
   if(!active.has(node))active.set(node,new Set());active.get(node).add(type);
   const equation=equations.get(node).get(type);let result;
   if(!equation){if(node.algorithm?.type==='sp')result=0;else fail(`missing ${type} constraint`);}
   else if(!equation.refs.length)result=equation.literal*(type==='w'?scale:1);
   else {
    const values=equation.refs.map(ref=>read(ref,equation.refType));
    if(values.some(v=>Math.abs(v-values[0])>1e-7))fail('unequal reference cohort');
    result=values[0]*equation.factor;
    // Width references rooted in the available frame are the independent
    // sizes fitted by the linear algorithm; dependent widths track them.
    if(type==='w'&&equation.refs.every(ref=>ref===tree))result*=scale;
   }
   if(!Number.isFinite(result)||node.algorithm?.type!=='sp'&&result<0)fail('invalid resolved size');
   active.get(node).delete(type);if(!memo.has(node))memo.set(node,new Map());memo.get(node).set(type,result);return result;
  }
  const sizes=tree.children.map(node=>({node,width:read(node,'w'),height:read(node,'h')}));
  for(const {targets,type}of equalities){const values=targets.map(n=>read(n,type));if(values.some(v=>Math.abs(v-values[0])>1e-7))fail('unsatisfied equal-size constraint');}
  return sizes;
 }
 let sizes=evaluate(1),occupied=sizes.reduce((sum,n)=>sum+n.width,0);
 if(!(occupied>0))fail('nonpositive occupied width');
 if(occupied>width){sizes=evaluate(width/occupied);occupied=sizes.reduce((sum,n)=>sum+n.width,0);if(Math.abs(occupied-width)>1e-6)fail('nonlinear width dependencies');}
 let cursor=direction==='fromL'?(width-occupied)/2:(width+occupied)/2;
 const boxes=sizes.map(({node,width:w,height:h})=>{
  const fittedHeight=Math.min(height,Math.max(0,h));
  if(direction==='fromR')cursor-=w;
  const box={node,x:cursor,y:(height-fittedHeight)/2,width:w,height:fittedHeight};
  if(direction==='fromL')cursor+=w;
  return box;
 });
 return {boxes,pending};
}
