/** Cut moves the rule's paint domain; its statistical domain follows that move. */
import { mapFormulaRefs, sameSheetName } from './refs.js';
import { duplicateSourceAreas, duplicateSourceFormula } from './conditional-duplicates.js';
import { mapConditionalFormulas, conditionalPredicateField, rebaseConditionalPredicate } from './conditional-scale.js';
import { intersection, removeRangeRecords, compactRangeRecords } from './range-records.js';

const statistical = new Set(['dup', 'unique', 'top', 'bottom', 'scale', 'databar', 'icons']);
const inside = (a, b) => a.r1 >= b.r1 && a.r2 <= b.r2 && a.c1 >= b.c1 && a.c2 <= b.c2;
const same = (a, b) => ['r1','r2','c1','c2'].every(k => a[k] === b[k]);
const translated = (g, block) => ({ r1:g.r1+block.target.r1-block.source.r1, r2:g.r2+block.target.r1-block.source.r1,
  c1:g.c1+block.target.c1-block.source.c1, c2:g.c2+block.target.c1-block.source.c1 });
const compact = ranges => compactRangeRecords(ranges.map(range => ({range})), () => 0).map(x => x.range);
const covers = (ranges, coverage) => ranges.every(range => coverage.reduce((left, cut) => removeRangeRecords(left,cut),[{range}]).length === 0);

/** Packed visible cells are piecewise translations, without per-cell rules. */
export function conditionalMoveBlocks(rows, cols, r, c) {
  const runs = lines => {
    const out=[];
    for(let i=0;i<lines.length;i++) {
      const start=i; while(i+1<lines.length && lines[i+1]===lines[i]+1)i++;
      out.push({lo:lines[start],hi:lines[i],offset:start});
    }
    return out;
  };
  return runs(rows).flatMap(rr => runs(cols).map(cc => ({source:{r1:rr.lo,r2:rr.hi,c1:cc.lo,c2:cc.hi},
    target:{r1:r+rr.offset,r2:r+rr.offset+rr.hi-rr.lo,c1:c+cc.offset,c2:c+cc.offset+cc.hi-cc.lo}})));
}

/** A rule's references can enter the moved block at a different cell than its
 * paint range. Partition those boundaries before rebasing candidate formulas. */
function partitions(rule, owner, source, target, blocks) {
  const g=rule.range, rows=new Set([g.r1,g.r2+1]), cols=new Set([g.c1,g.c2+1]);
  const add=(set,n,lo,hi)=>{if(n>lo && n<=hi)set.add(n);};
  const edges=range=>{add(rows,range.r1,g.r1,g.r2);add(rows,range.r2+1,g.r1,g.r2);add(cols,range.c1,g.c1,g.c2);add(cols,range.c2+1,g.c1,g.c2);};
  for(const block of blocks) {
    if(owner===source && intersection(g,block.source))edges(block.source);
    if(owner===target && intersection(g,block.target))edges(block.target);
  }
  const predicate = conditionalPredicateField(rule);
  if(predicate)mapFormulaRefs(rule[predicate],ref=>{
    if(ref.sheetEnd || ['rows','cols'].includes(ref.kind) || !sameSheetName(ref.sheet || owner.name,source.name))return ref;
    for(const b of blocks) {
      const affected={...g};let possible=true;
      for(const axis of ['r','c'])for(const end of [1,2]) {
        const value=ref[`${axis}${end}`];
        if(ref[`abs${axis.toUpperCase()}${end}`]) {
          if(value<b.source[`${axis}1`] || value>b.source[`${axis}2`])possible=false;
        } else {
          const offset=value-g[`${axis}1`];
          affected[`${axis}1`]=Math.max(affected[`${axis}1`],b.source[`${axis}1`]-offset);
          affected[`${axis}2`]=Math.min(affected[`${axis}2`],b.source[`${axis}2`]-offset);
        }
      }
      if(possible && affected.r1<=affected.r2 && affected.c1<=affected.c2)edges(affected);
    }
    return ref;
  });
  const rr=[...rows].sort((a,b)=>a-b),cc=[...cols].sort((a,b)=>a-b),out=[];
  for(let r=0;r<rr.length-1;r++)for(let c=0;c<cc.length-1;c++)out.push({r1:rr[r],r2:rr[r+1]-1,c1:cc[c],c2:cc[c+1]-1});
  return out;
}

export function moveConditionalFormats(sheets, source, target, blocks, newId, bandOrdinal) {
  const across=source!==target, groups=new Map(), memberships=new Map();
  // Native/shared statistical scopes are recognized by coverage, not file IDs.
  for(const owner of sheets)for(const [index,rule]of owner.rules.entries())if(statistical.has(rule.type)) {
    const domain=rule.statisticsRange || (['dup','unique'].includes(rule.type) ? rule.duplicateRange : null);
    const {id,range,...settings}=rule;
    const key=JSON.stringify([owner.id,domain?settings:index]);
    if(!groups.has(key))groups.set(key,{owner,rules:[],domain,paint:[]});
    groups.get(key).rules.push(rule);groups.get(key).paint.push(rule.range);
  }
  for(const group of groups.values()) {
    const areas=group.domain?duplicateSourceAreas(group.domain):group.paint;
    if(!areas?.length || areas.some(g=>g.sheet && !sameSheetName(g.sheet,group.owner.name)))continue;
    if(!covers(areas,group.paint)||!covers(group.paint,areas))continue;
    for(const rule of group.rules)memberships.set(rule,group);
  }
  const follow=(formula,owner,moving)=>mapFormulaRefs(formula,ref=>{
    if(ref.sheetEnd||['rows','cols'].includes(ref.kind)||!sameSheetName(ref.sheet||owner.name,source.name))return ref;
    const block=blocks.find(b=>inside(ref,b.source));if(!block)return ref;
    const next={...ref,...translated(ref,block)};
    // A cross-sheet cut keeps unqualified outside references local.
    // References from rules staying behind must explicitly name the new sheet.
    if(ref.sheet!=null || across&&!moving)next.sheet=target.name;
    return next;
  });
  const output=new Map(sheets.map(s=>[s,[]])), domainPieces=new Map();
  for(const owner of sheets)for(const [priority,rule]of owner.rules.entries()) {
    const group=memberships.get(rule);
    let retainedId=false;
    for(const old of partitions(rule,owner,source,target,blocks)) {
      const block=owner===source?blocks.find(b=>inside(old,b.source)):null;
      if(!block && owner===target && blocks.some(b=>inside(old,b.target)))continue;
      const destination=block?target:owner,range=block?translated(old,block):old;
      let next=rebaseConditionalPredicate(rule,old.r1-rule.range.r1,old.c1-rule.range.c1);
      next=mapConditionalFormulas(next,(formula,key)=>group&&['statisticsRange','duplicateRange'].includes(key)?formula:follow(formula,owner,!!block));
      if(rule.type==='bands' && (!same(old,rule.range)||block)) {
        const origin=duplicateSourceAreas(rule.bandOrigin || '')?.[0] || rule.range;
        if(block) {
          const ordinal=bandOrdinal(owner,origin,old.r1),header=rule.header!==false&&ordinal===0;
          const swap=(ordinal-(rule.header!==false?1:0))%2!==0;
          next={...next,header,bandOrigin:duplicateSourceFormula([range]),...(!header&&swap?{color1:rule.color2,color2:rule.color1}:{})};
        } else next={...next,bandOrigin:rule.bandOrigin||duplicateSourceFormula([rule.range])};
      }
      next={...next,range,id:retainedId?newId():rule.id};retainedId=true;
      const item={rule:next,original:rule,priority,moved:!!block,owner};output.get(destination).push(item);
      if(group) {
        if(!domainPieces.has(group))domainPieces.set(group,new Map());
        const bySheet=domainPieces.get(group);if(!bySheet.has(destination))bySheet.set(destination,[]);bySheet.get(destination).push(item);
      }
    }
  }
  for(const bySheet of domainPieces.values())for(const items of bySheet.values()) {
    const domain=duplicateSourceFormula(compact(items.map(x=>x.rule.range)));
    for(const item of items) {
      const original=item.original;
      if(items.length>1 || original.statisticsRange || !same(item.rule.range,original.range))item.rule.statisticsRange=domain;
      if(['dup','unique'].includes(original.type)&&original.duplicateRange)item.rule.duplicateRange=domain;
    }
  }
  return new Map([...output].map(([owner,items])=>{
    if(across && owner===target)items.sort((a,b)=>Number(b.moved)-Number(a.moved)||a.priority-b.priority);
    const rules=items.map(x=>x.rule);
    return [owner,rules.length===owner.rules.length&&rules.every((rule,i)=>same(rule.range,owner.rules[i].range)&&Object.keys(rule).every(key=>key==='range'||rule[key]===owner.rules[i][key]))?owner.rules:rules];
  }));
}
