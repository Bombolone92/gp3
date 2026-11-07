"""Original empty continuation-cell style controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-row-context'
p=folder/'control.docx';w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(p) as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(w+'body');t=body.findall(w+'tbl')[9];section=deepcopy(body.find(w+'sectPr'));body.clear()
for i,style in enumerate(['Shared','']):
 h=E.SubElement(body,w+'p');pr=E.SubElement(h,w+'pPr')
 if i:E.SubElement(pr,w+'pageBreakBefore')
 run=E.SubElement(h,w+'r');E.SubElement(run,w+'t').text=f'Merge {i}'
 table=deepcopy(t)
 for j,row in enumerate(table.findall(w+'tr')):
  cell=row.find(w+'tc');pr=cell.find(w+'tcPr');v=E.SubElement(pr,w+'vMerge')
  if j==0:v.set(w+'val','restart')
  else:
   p=cell.find(w+'p');p.clear()
   if style:E.SubElement(E.SubElement(p,w+'pPr'),w+'pStyle').set(w+'val',style)
  # vMerge precedes vAlign in the schema.
  pr[:]=sorted(pr,key=lambda n:['tcW','vMerge','vAlign'].index(E.QName(n).localname))
 body.append(table)
E.SubElement(body,w+'p');body.append(section);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'merge.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
