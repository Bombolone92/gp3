/** SpreadsheetML header/footer runs. Raw strings remain the interchange format. */
import { DEFAULT_COLOR_PALETTE, tintRgb } from './font-color.js';

const tokens = { P:'Page', N:'Pages', D:'Date', T:'Time', A:'Tab', F:'File', Z:'Path' };
// Excel serializes localized font-style names (MS-XLS Header). These are style
// names, not font families; keep the family independent of the language.
const boldNames = new Set('bold|fett|gras|grassetto|negrita|negrito|pogrubiony|pogrubiona|vet|fed|fet|lihavoitu|tučné|tučný|félkövér|kalın|полужирный|жирный|太字|粗体|粗體|굵게'.split('|'));
const italicNames = new Set('italic|italics|kursiv|italique|corsivo|cursiva|itálico|italico|kursywa|pochyły|pochylony|cursief|kursyvoitu|kurzíva|dőlt|italik|курсив|斜体|斜體|기울임꼴'.split('|'));
function fontStyle(text) {
  const words=String(text).toLowerCase().split(/[\s,]+/);
  return { bold:words.some(w=>boldNames.has(w)), italic:words.some(w=>italicNames.has(w)) };
}
export function hasHeaderFormatting(text) {
  return /&(?:"[^"\r\n]*"|\d|K(?:[\da-fA-F]{6}|\d{2}[+-]\d{3})|[BIESUXYOH])/.test(String(text||'').replace(/&&/g,''));
}
export function parsePrintHeader(text, palette) {
  const sections={left:[],center:[],right:[]}, states={left:{},center:{},right:{}};
  let side='center',src=String(text||''),i=0;
  const push=part=>{const runs=sections[side],style={...states[side]},prev=runs.at(-1);
    if(part.text!=null&&prev?.text!=null&&JSON.stringify(prev.style)===JSON.stringify(style))prev.text+=part.text;
    else runs.push({...part,style});};
  while(i<src.length){
    if(src[i]!=='&'){const end=src.indexOf('&',i);push({text:src.slice(i,end<0?src.length:end)});i=end<0?src.length:end;continue}
    const tail=src.slice(i),code=src[i+1],style=states[side];let m;
    if(code==='&'){push({text:'&'});i+=2;continue}
    if('LCR'.includes(code||'\0')){side={L:'left',C:'center',R:'right'}[code];i+=2;continue}
    if((m=/^&\[(Page|Pages|Date|Time|Tab|File|Path)\]/i.exec(tail))){push({token:m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()});i+=m[0].length;continue}
    if(tokens[code]){push({token:tokens[code]});i+=2;continue}
    if((m=/^&"([^"\r\n]*)"/.exec(tail))){const comma=m[1].lastIndexOf(','),name=comma<0?m[1]:m[1].slice(0,comma);if(name&&name!=='-')style.font=name;
      if(comma>=0)Object.assign(style,fontStyle(m[1].slice(comma+1)));i+=m[0].length;continue}
    if((m=/^&(\d{1,3}(?:\.\d+)?)/.exec(tail))){style.size=Math.max(1,Math.min(409,Number(m[1])));i+=m[0].length;continue}
    if((m=/^&K(\d{2})([+-])(\d{3})/.exec(tail))){const n=Math.min(11,Number(m[1])),base=palette?.theme?.[n]||DEFAULT_COLOR_PALETTE.theme[n],tint=Math.min(100,Number(m[3]))/100*(m[2]==='-'?-1:1);style.color='#'+tintRgb(base.slice(1),tint);i+=m[0].length;continue}
    if((m=/^&K([\da-f]{6})/i.exec(tail))){style.color='#'+m[1].toLowerCase();i+=m[0].length;continue}
    const key={B:'bold',I:'italic',U:'underline',E:'doubleUnderline',S:'strike',O:'outline',H:'shadow'}[code];
    if(key){style[key]=!style[key];i+=2;continue}
    if(code==='X'||code==='Y'){const key=code==='X'?'super':'sub',other=code==='X'?'sub':'super';if(!style[other])style[key]=!style[key];i+=2;continue}
    // Keep unsupported/malformed constructs visible rather than discarding data
    // (notably picture fields, whose drawing payload needs a separate renderer).
    push({text:'&'});i++;
  }
  return sections;
}
