// A HYPERLINK field is an authored envelope with the same navigation behavior
// as w:hyperlink. Result text edits keep it. An explicit link edit converts that
// envelope to paragraph-local hyperlinks so changing only part remains possible.
export function unwrapEditedFieldHyperlinks(paragraphs,ranges,start,end){
  const changed=ranges.filter(r=>r.field.type==='HYPERLINK'&&r.start<end&&start<r.end);
  if(!changed.length)return;
  const ids=new Set(changed.map(r=>r.field.id));let at=0;
  for(const p of paragraphs){
    if(p.fieldMarkers)p.fieldMarkers=p.fieldMarkers.filter(m=>!ids.has(m.field.id)).map(m=>{
      if(m.link)return m;
      const owner=changed.findLast(r=>r.start<=at+m.offset&&at+m.offset<=r.end);
      if(!owner)return m;
      const link={...owner.field.resultLink};delete link.fieldId;return {...m,link};
    });
    for(const run of p.runs)if(ids.has(run.link?.fieldId)){run.link={...run.link};delete run.link.fieldId;}
    at+=p.runs.reduce((n,r)=>n+r.text.length,0)+1;
  }
}

export function synchronizeFieldHyperlinks(paragraphs,ranges){
  const events=ranges.filter(r=>r.field.type==='HYPERLINK').flatMap(r=>[{at:r.start,order:r.startOrder,link:r.field.resultLink},{at:r.end,order:r.endOrder,end:true}]).sort((a,b)=>a.at-b.at||a.order-b.order);
  let at=0,index=0;const stack=[];
  const advance=position=>{while(index<events.length&&events[index].at<=position){const event=events[index++];if(event.end)stack.pop();else stack.push(event.link);}};
  for(const p of paragraphs){
    const output=[];let changed=false;
    for(const run of p.runs){
      let from=0;
      while(from<run.text.length){
        advance(at+from);const end=Math.min(run.text.length,events[index]?events[index].at-at:run.text.length);
        let link=run.link;
        if(!link||link.fieldId){
          if(stack.length)link=stack.at(-1);
          else if(link?.fieldId){link={...link};delete link.fieldId;}
        }
        if(from===0&&end===run.text.length&&link===run.link)output.push(run);
        else {const next={...run,text:run.text.slice(from,end)};if(link)next.link=link;else delete next.link;output.push(next);changed=true;}
        from=end;
      }
      at+=run.text.length;
    }
    if(changed)p.runs=output;at++;
  }
}
