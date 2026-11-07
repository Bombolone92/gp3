import { paragraph } from '../../src/engine/model.js';
import { RUN_FORMAT, PARAGRAPH_FORMAT } from '../../src/engine/formatting.js';

// Internal layout fixture. Strict DOCX editing stays guarded until caret and
// script-context font selection have their own native reference validation.
export function bidiControlParagraphs(cases) {
  const base={...RUN_FORMAT,fontAscii:'Arial',fontHAnsi:'Arial',fontCs:'Arial',fontSize:10,fontSizeCs:10};
  return cases.flatMap(c=>{
    const label=paragraph('',{format:{...PARAGRAPH_FORMAT,lineRule:'exact',lineSpacing:12,spaceBefore:0,spaceAfter:6,pageBreakBefore:c.index>0&&c.index%7===0},markFormat:base});
    label.runs=[{...base,text:c.label}];
    const p=paragraph('',{format:{...PARAGRAPH_FORMAT,lineRule:'exact',lineSpacing:24,spaceBefore:0,spaceAfter:18,indentRight:c.width?(468-c.width)*20:0},markFormat:base});
    p.runs=[{...base,text:'Left [ '},{...base,text:c.text,rtl:c.rtl},{...base,text:' ] Right'}];
    return [label,p];
  });
}
