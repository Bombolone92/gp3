"""Original partial-span counterparts of the mixed-protection controls."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];source=root/'tests/fixtures/mixed-width-protection'
out=root/'tests/fixtures/mixed-pressure-partial';out.mkdir(parents=True,exist_ok=True)
with ZipFile(source/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
cases=json.loads((source/'cases.json').read_text());w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
document=E.fromstring(parts['word/document.xml']);body=document.find(w+'body');tables=body.findall(w+'tbl');section=deepcopy(body.find(w+'sectPr'));body.clear();selected=[]
for table,case in zip(tables,cases):
 if case['scope']!='all' or case['unequal'] or case['automaticColumns'] not in [2,3]:continue
 table=deepcopy(table);footer=table.findall(w+'tr')[-1];properties=footer.find(w+'tc').find(w+'tcPr')
 properties.find(w+'gridSpan').set(w+'val',str(case['columns']-1));properties.find(w+'tcW').set(w+'w','5000')
 footer.append(deepcopy(table.findall(w+'tr')[0].findall(w+'tc')[-1]))
 p=E.SubElement(body,w+'p');properties=E.SubElement(p,w+'pPr')
 if selected:E.SubElement(properties,w+'pageBreakBefore')
 run=E.SubElement(p,w+'r');E.SubElement(run,w+'t').text=f"Partial {case['protection']} {case['automaticColumns']} {case['width']}"
 body.append(table);E.SubElement(body,w+'p');selected.append(dict(case,mergedPreference=5000,mergedColumns=case['columns']-1))
body.append(section);parts['word/document.xml']=E.tostring(document)
with ZipFile(out/'control.docx','w') as z:
 for name,data in parts.items():
  info=ZipInfo(name,(2026,9,29,12,0,0));info.create_system=0;info.external_attr=0o600<<16
  z.writestr(info,data,compress_type=ZIP_DEFLATED)
(out/'cases.json').write_text(json.dumps(selected,indent=2)+'\n')
