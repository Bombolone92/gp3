import {paragraph} from '../../src/engine/model.js';
import {RUN_FORMAT,PARAGRAPH_FORMAT} from '../../src/engine/formatting.js';

// Component model equivalent to the independent OOXML font-context fixture.
export function rtlFontControlParagraphs(cases){
  const base={...RUN_FORMAT,fontAscii:'Arial',fontHAnsi:'Arial',fontCs:'Arial',fontSize:10,fontSizeCs:10};
  return cases.flatMap(c=>{
    const label=paragraph('',{format:{...PARAGRAPH_FORMAT,lineRule:'exact',lineSpacing:12,spaceBefore:0,spaceAfter:6,pageBreakBefore:c.index>0&&c.index%7===0},markFormat:base});
    label.runs=[{...base,text:c.label}];
    const p=paragraph('',{format:{...PARAGRAPH_FORMAT,lineRule:'exact',lineSpacing:24,spaceBefore:0,spaceAfter:18},markFormat:base});
    const style={...base,fontHAnsi:'Times New Roman',fontCs:'Courier New',fontSizeCs:16,boldCs:true,rtl:c.flag!=='cs',cs:c.flag!=='rtl'};
    p.runs=[{...base,text:'Left [ '},...c.parts.map((text,i)=>({...style,text,color:i?'0000FF':'auto'})),{...base,text:' ] Right'}];
    return [label,p];
  });
}
