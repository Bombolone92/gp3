"""Original mixed-cell controls with independently varied absolute-cell noWrap."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1]
source=root/'tests/fixtures/mixed-rounding-flexible'
out=root/'tests/fixtures/mixed-width-protection';out.mkdir(parents=True,exist_ok=True)
with ZipFile(source/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
base=json.loads((source/'cases.json').read_text())
w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
document=E.fromstring(parts['word/document.xml']);body=document.find(w+'body')
tables=body.findall(w+'tbl');section=deepcopy(body.find(w+'sectPr'));body.clear();cases=[]
for protection in ['first','second','neither']:
 for table,case in zip(tables,base):
  table=deepcopy(table)
  for row in table.findall(w+'tr')[:2]:
   for index,cell in enumerate(row.findall(w+'tc')[:2]):
    if protection==('first' if index==0 else 'second'):continue
    properties=cell.find(w+'tcPr');nowrap=properties.find(w+'noWrap')
    if nowrap is not None:properties.remove(nowrap)
  p=E.SubElement(body,w+'p');properties=E.SubElement(p,w+'pPr')
  if cases:E.SubElement(properties,w+'pageBreakBefore')
  run=E.SubElement(p,w+'r');E.SubElement(run,w+'t').text=f"{protection} {case['scope']} {case['automaticColumns']} {case['unequal']} {case['width']}"
  body.append(table);E.SubElement(body,w+'p');cases.append(dict(case,protection=protection))
body.append(section);parts['word/document.xml']=E.tostring(document)
with ZipFile(out/'control.docx','w') as z:
 for name,data in parts.items():
  info=ZipInfo(name,(2026,9,29,12,0,0));info.create_system=0;info.external_attr=0o600<<16
  z.writestr(info,data,compress_type=ZIP_DEFLATED)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
