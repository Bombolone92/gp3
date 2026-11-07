"""Original page geometry controls with an unsupported art border."""
from pathlib import Path
from docx import Document
from docx.shared import Inches,Pt
from docx.enum.section import WD_SECTION_START,WD_ORIENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/border-preview'
root.mkdir(parents=True,exist_ok=True)
doc=Document();doc.styles['Normal'].font.name='Arial';doc.styles['Normal'].font.size=Pt(11)
doc.settings.element.find(qn('w:zoom')).set(qn('w:percent'),'100')
cases=[]
for i,(w,h,left,right,top,bottom,columns) in enumerate([(6,8,.45,.65,.4,.6,1),(9,6,.7,.4,.55,.35,2)]):
 s=doc.sections[0] if i==0 else doc.add_section(WD_SECTION_START.NEW_PAGE)
 s.page_width=Inches(w);s.page_height=Inches(h);s.orientation=WD_ORIENT.PORTRAIT if w<h else WD_ORIENT.LANDSCAPE
 s.left_margin=Inches(left);s.right_margin=Inches(right);s.top_margin=Inches(top);s.bottom_margin=Inches(bottom)
 s.header_distance=Inches(.2);s.footer_distance=Inches(.2)
 cols=s._sectPr.find(qn('w:cols'));cols.set(qn('w:num'),str(columns));cols.set(qn('w:space'),'360')
 for n in list(s._sectPr.findall(qn('w:pgBorders'))):s._sectPr.remove(n)
 border=OxmlElement('w:pgBorders');border.set(qn('w:offsetFrom'),'page')
 for side in ['top','left','bottom','right']:
  n=OxmlElement('w:'+side)
  for key,value in {'val':'handmade1','sz':'8','space':'5','color':'0070C0'}.items():n.set(qn('w:'+key),value)
  border.append(n)
 s._sectPr.insert_element_before(border,'w:cols')
 for j in range(8):
  doc.add_paragraph(f'S{i} P{j}: Independent geometry survives unsupported decoration. This sentence checks wrapping across the authored writing area.')
 cases.append({'width':int(w*1440),'height':int(h*1440),'left':round(left*1440),'right':round(right*1440),'top':round(top*1440),'bottom':round(bottom*1440),'columns':columns})
doc.save(root/'control.docx')
for s in doc.sections:
 for n in list(s._sectPr.findall(qn('w:pgBorders'))):s._sectPr.remove(n)
doc.save(root/'plain.docx')
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
