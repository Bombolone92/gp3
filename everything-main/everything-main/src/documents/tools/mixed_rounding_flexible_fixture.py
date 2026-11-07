"""Original controls for mixed rounding across flexible column counts and content."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
r=Path(__file__).resolve().parents[1];out=r/'tests/fixtures/mixed-rounding-flexible';out.mkdir(parents=True,exist_ok=True)
with ZipFile(r/'tests/fixtures/mixed-cell-width-content/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}';root=E.fromstring(parts['word/document.xml']);body=root.find(W+'body');section=deepcopy(body.find(W+'sectPr'));tables=body.findall(W+'tbl');prototypes=[deepcopy(tables[i]) for i in [1,9]];body.clear();cases=[]
for scope,prototype in zip(['body','all'],prototypes):
 for count,unequal in [(2,False),(3,False),(4,False),(3,True)]:
  for width in [6000,6001]:
   p=E.SubElement(body,W+'p');pr=E.SubElement(p,W+'pPr')
   if cases:E.SubElement(pr,W+'pageBreakBefore')
   run=E.SubElement(p,W+'r');E.SubElement(run,W+'t').text=f'{scope} {count} {unequal} {width}'
   t=deepcopy(prototype);rows=t.findall(W+'tr')
   for row in rows:t.remove(row)
   grid=t.find(W+'tblGrid');grid.clear()
   for value in [3000,1800]+[1200//count]*count:E.SubElement(grid,W+'gridCol').set(W+'w',str(value))
   t.find(W+'tblPr').find(W+'tblW').set(W+'w',str(width))
   for row in rows[2:4]:
    cells=row.findall(W+'tc');auto=deepcopy(cells[2]);row.remove(cells[2]);row.remove(cells[3])
    for i in range(count):
     c=deepcopy(auto)
     if unequal:c.find('.//'+W+'t').text='C'+'0'*(i+1)
     row.append(c)
    t.append(row)
   footer=rows[4];pref=footer.find(W+'tc').find(W+'tcPr');pref.find(W+'tcW').set(W+'w',str(width));pref.find(W+'gridSpan').set(W+'val',str(count+2));t.append(footer)
   body.append(t);E.SubElement(body,W+'p');cases.append(dict(scope=scope,width=width,automaticColumns=count,unequal=unequal,bodyRow=1,columns=count+2))
body.append(section);parts['word/document.xml']=E.tostring(root)
with ZipFile(out/'control.docx','w') as z:
 for n,b in parts.items():
  i=ZipInfo(n,(2026,9,29,12,0,0));i.create_system=0;i.external_attr=0o600<<16;z.writestr(i,b,compress_type=ZIP_DEFLATED)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
