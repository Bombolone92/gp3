import { parsePrintHeader } from '../core/print-header.js';
import { el } from './dom.js';
import { fontKeyFor, fontStack, getLocale } from '../core/format.js';

export function richHeaderSections(text, info = {}, scale = 1) {
  const parts=parsePrintHeader(text,info.palette),now=info.now||new Date();
  const values={Page:info.page??'',Pages:info.pages??'',Tab:info.tab||'',File:info.file||'',Path:info.path||'',
    Date:now.toLocaleDateString(getLocale()),Time:now.toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})};
  return Object.entries(parts).map(([side,runs])=>el('span.print-header-section',{style:{position:'absolute',left:'0',right:'0',textAlign:side,whiteSpace:'pre',lineHeight:'normal'}},
    ...runs.map(run=>{
      const s=run.style,deco=[(s.underline||s.doubleUnderline)&&'underline',s.strike&&'line-through'].filter(Boolean).join(' ');
      return el('span',{style:{fontFamily:fontStack(fontKeyFor(s.font||info.normalFont?.name||'Arial',{literal:true})),
        fontSize:`${(s.size||info.normalFont?.sz||11)*scale*(s.super||s.sub?0.75:1)}pt`,
        fontWeight:s.bold?'700':'400',fontStyle:s.italic?'italic':'normal',color:s.color||'#000000',
        textDecorationLine:deco||'none',textDecorationStyle:s.doubleUnderline?'double':'solid',
        verticalAlign:s.super?'super':s.sub?'sub':'baseline',
        ...(s.outline?{webkitTextStroke:'0.5px currentColor',webkitTextFillColor:'transparent'}:{}),
        ...(s.shadow?{textShadow:'1px 1px currentColor'}:{})}},run.token?String(values[run.token]??''):run.text);
    })));
}
