"""Automatic rows containing only rotated cells; no horizontal height driver."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
repo=Path(__file__).resolve().parents[1];folder=repo/'tests/fixtures/cell-text-direction';W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(folder/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(W+'body');base=deepcopy(body.find(W+'tbl'));section=deepcopy(body[-1]);body.clear()
for i,(name,text,width) in enumerate([('short','Alpha beta',2160),('long','One two three four five six seven eight nine ten eleven twelve',2160),('narrow','One two three four five six seven eight nine ten eleven twelve',720),('many',' '.join('word'+str(i) for i in range(50)),2160)]):
 p=E.SubElement(body,W+'p');pr=E.SubElement(p,W+'pPr')
 if i:E.SubElement(pr,W+'pageBreakBefore')
 r=E.SubElement(p,W+'r');E.SubElement(r,W+'t').text=name
 table=deepcopy(base);row=table.find(W+'tr');row.remove(row.find(W+'trPr'));row.remove(row.findall(W+'tc')[0]);grid=table.find(W+'tblGrid');grid.remove(grid[0])
 table.find(W+'tblPr').find(W+'tblW').set(W+'w',str(width*2))
 for e in grid:e.set(W+'w',str(width))
 for cell in row.findall(W+'tc'):
  cell.find(W+'tcPr').find(W+'tcW').set(W+'w',str(width));cell.find('.//'+W+'t').text=text
 body.append(table)
 p=E.SubElement(body,W+'p');r=E.SubElement(p,W+'r');E.SubElement(r,W+'t').text='After table'
body.append(section);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'automatic.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
