"""Original short/long-word controls for text flowing beside a floating table."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import sys,json

from page_vertical_alignment_fixture import node,paragraph,section,W,FOLDER
out=Path(__file__).resolve().parents[1]/'tests/fixtures/table-overlap'
with ZipFile(FOLDER/'floating.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);template=doc.find('.//{'+W+'}tbl');body=doc.find('{'+W+'}body');body.clear();cases=[]
for width in [8000,7200]:
 for text in ['A A A A A A','Anchor 2','Longunbrokenword','Longunbrokenword'*10]:
  cases.append(dict(width=width,text=text))
  table=deepcopy(template);pr=table.find('{'+W+'}tblPr');pos=pr.find('{'+W+'}tblpPr')
  pos.set('{'+W+'}vertAnchor','margin');pos.set('{'+W+'}tblpY','400');pos.set('{'+W+'}rightFromText','720')
  pr.find('{'+W+'}tblW').set('{'+W+'}w',str(width));table.find('.//{'+W+'}gridCol').set('{'+W+'}w',str(width))
  for c in table.findall('.//{'+W+'}tcW'):c.set('{'+W+'}w',str(width))
  body.append(paragraph('Before'));body.append(table);last=paragraph(text);body.append(last);last.find('{'+W+'}pPr').append(section('top'))
pr=body[-1].find('{'+W+'}pPr');pr.remove(pr.find('{'+W+'}sectPr'));body.append(section('top'))
parts['word/document.xml']=E.tostring(doc)
with ZipFile(out/'words.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'words-cases.json').write_text(json.dumps(cases,indent=2))
