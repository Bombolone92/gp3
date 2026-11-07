// Display text occupies logical positions, but a retained reference mark is
// indivisible. Replacement removes it; formatting preserves the XML element.
export function noteMarkRanges(paragraphs) {
  const ranges=[];let at=0;
  for(const p of paragraphs){
    for(const run of p.runs){if(run.noteMark)ranges.push({start:at,end:at+run.text.length});at+=run.text.length;}
    at++;
  }
  return ranges;
}
export function noteMarkSelection(paragraphs,start,end){
  for(const r of noteMarkRanges(paragraphs))if(start===end?r.start<start&&start<r.end:start<r.end&&end>r.start){start=Math.min(start,r.start);end=Math.max(end,r.end);}
  return [start,end];
}
