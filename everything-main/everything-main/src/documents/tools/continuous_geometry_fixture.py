"""Original native controls for continuous section geometry changes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_anchor_position_fixture import make,W
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/continuous-geometry'
root.mkdir(exist_ok=True)
def section(kind='nextPage',width=12240,height=15840,left=1440,right=1440,top=1440,bottom=1440,header=0,footer=0):
 return f'<w:sectPr><w:type w:val="{kind}"/><w:pgSz w:w="{width}" w:h="{height}"/><w:pgMar w:top="{top}" w:left="{left}" w:right="{right}" w:bottom="{bottom}" w:header="{header}" w:footer="{footer}" w:gutter="0"/></w:sectPr>'
cases=[]
for name,change in [('left',dict(left=2880)),('top',dict(top=2880)),('bottom',dict(bottom=7200)),('width',dict(width=10080)),('height',dict(height=10080)),('header',dict(header=1440))]:
 parts=make(15);body=[]
 for i in range(3):
  for j in range(3 if i!=1 else 52):
   end=section(**(dict(kind='continuous',**change) if i==1 else {})) if i<2 and j==(2 if i==0 else 51) else ''
   body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>{end}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>S{i} R{j:02d} text</w:t></w:r></w:p>')
 body.append(section(kind='continuous'))
 parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
 with ZipFile(root/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for path,value in parts.items():z.writestr(path,value)
 cases.append(dict(name=name,change=change))
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
