import { paragraphRunStyle, resolveCharacterRun } from './styles.js';

// TOC's built-in Hyperlink-style suppression is positional, not a permanent
// character property. Recompute it after edits so it cannot leak past a removed
// field or suppress a different character style selected by the user.
export function synchronizeTocFormatting(paragraphs, ranges, styles) {
  const events=ranges.filter(r=>r.field.type==='TOC').flatMap(r=>[{at:r.start,delta:1},{at:r.end,delta:-1}]).sort((a,b)=>a.at-b.at);
  let at=0,index=0,depth=0;
  const advance=position=>{while(index<events.length&&events[index].at<=position)depth+=events[index++].delta;};
  for(const p of paragraphs){
    const output=[];let changed=false,inherited;
    for(const run of p.runs){
      let from=0;
      while(from<run.text.length){
        advance(at+from);
        const end=Math.min(run.text.length,events[index]?events[index].at-at:run.text.length);
        const style=styles.definitions?.[run.styleId||styles.defaultCharacter];
        const suppressed=depth>0&&style?.type==='character'&&style.name.toLowerCase()==='hyperlink';
        if(from===0&&end===run.text.length&&!!run.tocHyperlink===suppressed)output.push(run);
        else {
          const next={...run,text:run.text.slice(from,end)};
          if(suppressed)next.tocHyperlink=true;else delete next.tocHyperlink;
          if(!!run.tocHyperlink!==suppressed){inherited??=paragraphRunStyle(p,styles);resolveCharacterRun(next,styles,inherited);}
          output.push(next);changed=true;
        }
        from=end;
      }
      at+=run.text.length;
    }
    if(changed)p.runs=output;
    at++;
  }
}
