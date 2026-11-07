from pathlib import Path
from docx import Document
from docx.shared import Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import json
out=Path(__file__).resolve().parents[1]/'tests/fixtures/symbol-cs-numbering';out.mkdir(exist_ok=True)
def add(p,n,**a):
 e=OxmlElement('w:'+n)
 for k,v in a.items():e.set(qn('w:'+k),str(v))
 p.append(e);return e
d=Document();d.settings.element.find(qn('w:zoom')).set(qn('w:percent'),'100');normal=d.styles['Normal'];normal.font.name='Arial';normal.font.size=Pt(11);normal.paragraph_format.line_spacing=Pt(24);normal.paragraph_format.space_after=Pt(0)
for e in d.settings.element.iter(qn('w:compatSetting')):
 if e.get(qn('w:name'))=='compatibilityMode':e.set(qn('w:val'),'15')
r=d.part.numbering_part.element;cases=[]
for font,glyph in [('Symbol','\uf0b7'),('Wingdings','\uf0a7')]:
 for extra in [None,'bCs','iCs','szCs']:
  i=len(cases)+1;aid=100+i;a=OxmlElement('w:abstractNum');a.set(qn('w:abstractNumId'),str(aid));r.insert(0,a);l=add(a,'lvl',ilvl=0);add(l,'start',val=1);add(l,'numFmt',val='bullet');add(l,'lvlText',val=glyph);add(l,'lvlJc',val='left');pp=add(l,'pPr');add(pp,'ind',left=720,hanging=360);rp=add(l,'rPr');add(rp,'rFonts',ascii=font,hAnsi=font);add(rp,'sz',val=22)
  if extra:
   e=add(rp,extra,val=96 if extra=='szCs' else 1)
   if extra!='szCs':rp.remove(e);rp.insert(1,e)
  n=add(r,'num',numId=aid);add(n,'abstractNumId',val=aid);p=d.add_paragraph('Text'+str(i));np=add(p._p.get_or_add_pPr(),'numPr');add(np,'ilvl',val=0);add(np,'numId',val=aid);cases.append(dict(font=font,glyph=glyph,extra=extra,label='Text'+str(i)))
d.save(out/'control.docx');(out/'cases.json').write_text(json.dumps(cases,indent=2))
