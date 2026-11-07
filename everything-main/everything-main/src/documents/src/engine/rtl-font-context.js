// Native reference compatibility for numeric script items in w:rtl runs. Numbers
// retain bCs/iCs/szCs, but an ASCII numeric item outside preceding Latin context
// uses the ascii face. Non-ASCII numeric items retain cs. This differs from
// Part 1 17.3.2.30's unconditional cs-face rule; see rtl-font-context controls.
export function rtlFontCharacters(chars, classify) {
  const types=chars.map(c=>classify(c.text));
  const numeric=chars.map((c,i)=>!!c.style.rtl && (types[i]==='EN'||types[i]==='AN'));
  for(let i=1;i<chars.length-1;i++) {
    if(chars[i].style.rtl && ['ES','CS'].includes(types[i]) && chars[i].text!=='/' && numeric[i-1] && numeric[i+1]) numeric[i]=true;
  }
  for(let i=0;i<chars.length;i++) if(chars[i].style.rtl && types[i]==='ET') {
    const start=i;
    while(i+1<chars.length && chars[i+1].style.rtl && types[i+1]==='ET') i++;
    if(numeric[start-1]||numeric[i+1]) for(let j=start;j<=i;j++) numeric[j]=true;
  }
  const result=chars.slice();
  let rtl=false,strong='L';
  for(let i=0;i<chars.length;i++) {
    const c=chars[i],next=!!c.style.rtl;
    if(next!==rtl){rtl=next;strong=rtl?'R':'L';}
    if(!rtl) continue;
    if(['\t','\v','\f','\u000e'].includes(c.text)){strong='R';continue;}
    if(numeric[i]){
      const start=i;
      while(i+1<chars.length && numeric[i+1]) i++;
      const ascii=chars.slice(start,i+1).every(c=>/^[\x00-\x7f]+$/.test(c.text));
      if(ascii && strong!=='L') for(let j=start;j<=i;j++) result[j]={...chars[j],bidiType:'EN',style:{...chars[j].style,fontFamily:chars[j].style.fontAscii||'Noto Sans'}};
    } else {
      if(types[i]==='L') strong='L';
      else if(types[i]==='R'||types[i]==='AL') strong='R';
      // A slash is a directional separator under w:rtl, unlike
      // the decimal/grouping separators in a numeric item.
      if(c.text==='/' && strong!=='L') result[i]={...c,bidiType:'R'};
    }
  }
  return result;
}
