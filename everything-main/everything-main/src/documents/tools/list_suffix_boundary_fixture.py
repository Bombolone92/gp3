from pathlib import Path
from docx import Document
from docx.shared import Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import json
out=Path(__file__).resolve().parents[1]/'tests/fixtures/list-suffix-boundary';out.mkdir(exist_ok=True)
def add(p,n,**a):
 e=OxmlElement('w:'+n)
 for k,v in a.items():e.set(qn('w:'+k),str(v))
 p.append(e);return e
d=Document();d.settings.element.find(qn('w:zoom')).set(qn('w:percent'),'100');normal=d.styles['Normal'];normal.font.name='Arial';normal.font.size=Pt(10);normal.paragraph_format.line_spacing=Pt(20);normal.paragraph_format.space_after=Pt(0)
for e in d.settings.element.iter(qn('w:compatSetting')):
 if e.get(qn('w:name'))=='compatibilityMode':e.set(qn('w:val'),'15')
r=d.part.numbering_part.element;cases=[]
for first in [0]:
 for align in ['left','center','right']:
  for indent in [0,288,720]:
   suffix='tab'
   i=len(cases)+1;aid=100+i;numid=100+i;a=OxmlElement('w:abstractNum');a.set(qn('w:abstractNumId'),str(aid));r.insert(0,a);l=add(a,'lvl',ilvl=0);add(l,'start',val=1);add(l,'numFmt',val='upperRoman');
   if suffix:add(l,'suff',val=suffix)
   add(l,'lvlText',val='%1.');add(l,'lvlJc',val=align);pp=add(l,'pPr');add(pp,'ind',left=indent,**({'hanging':-first} if first<0 else {'firstLine':first}));n=add(r,'num',numId=numid);add(n,'abstractNumId',val=aid)
   p=d.add_paragraph(f' Text{i}');np=add(p._p.get_or_add_pPr(),'numPr');add(np,'ilvl',val=0);add(np,'numId',val=numid);cases.append(dict(indent=indent,first=first,align=align,suffix=suffix,label=f'Text{i}'))
d.save(out/'control.docx');compat=d.settings.element.find(qn('w:compat'));flag=add(compat,'noTabHangInd');compat.remove(flag);compat.insert(0,flag);d.save(out/'nohang.docx');(out/'cases.json').write_text(json.dumps(cases,indent=2))
