"""Original table-origin phase controls; identical rotated text at twip offsets."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1]
out=repo/'tests/fixtures/cell-text-direction/origin-phase';out.mkdir(exist_ok=True)
w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(repo/'tests/fixtures/cell-text-direction/origins.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(w+'body')
section=deepcopy(body[-1]);table=deepcopy(body.find(w+'tbl'));body.clear()
cases=[]
for twips in [0,1,2,3,4,5,10,20]:
 p=E.SubElement(body,w+'p');pr=E.SubElement(p,w+'pPr')
 if cases:E.SubElement(pr,w+'pageBreakBefore')
 E.SubElement(E.SubElement(p,w+'r'),w+'t').text='Table offset '+str(twips)+' twips'
 t=deepcopy(table);pr=t.find(w+'tblPr');pr.insert(1,E.Element(w+'tblInd',{w+'w':str(twips),w+'type':'dxa'}));body.append(t)
 cases.append(dict(twips=twips))
body.append(section);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(out/'cases.json').write_text(json.dumps(cases))
print(out/'control.docx')
