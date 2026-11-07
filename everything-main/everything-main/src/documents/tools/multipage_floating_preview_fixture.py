"""Author paired rich multi-page controls; matched sources define only inline recovery."""
import hashlib
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as ET
from copy import deepcopy
root=Path(__file__).resolve().parents[1]; out=root/'tests/fixtures/multipage-floating-preview'; out.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'; q=lambda n:'{'+W+'}'+n
source=root/'tests/fixtures/floating-column-preview/before-unsupported.docx'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'fad1f7b0ba25cb95801862aa832e0e5b254f289d117a34c0e48f89f3d2dd66d0', 'Authored scaffold changed; review provenance before regenerating'
with ZipFile(source) as z: parts={n:z.read(n) for n in z.namelist()}
for mode in ('horizontal','vertical','multiple'):
 for matched in (False,True):
  body=ET.fromstring(parts['word/document.xml']); body.find('.//'+q('cols')).set(q('num'),'1')
  tables=body.findall('.//'+q('body')+'/'+q('tbl'))
  affected=[tables[0]] if mode!='multiple' else tables
  for ti,table in enumerate(affected):
   pr=table.find(q('tblPr')); pos=pr.find(q('tblpPr'))
   if pos is None: pos=ET.Element(q('tblpPr'),{q('horzAnchor'):'margin',q('vertAnchor'):'text',q('tblpX'):'240',q('tblpY'):'120'}); pr.insert(0,pos)
   if mode=='horizontal': pos.attrib.pop(q('tblpX'),None);pos.set(q('tblpXSpec'),'right')
   else: pos.attrib.pop(q('tblpY'),None);pos.set(q('tblpYSpec'),'top')
   row=deepcopy(table.findall(q('tr'))[-1])
   for old in table.findall(q('tr')): table.remove(old)
   for ri in range(24):
    new=deepcopy(row); trpr=ET.Element(q('trPr')); ET.SubElement(trpr,q('trHeight'),{q('val'):'720',q('hRule'):'exact'});new.insert(0,trpr)
    next(new.iter(q('t'))).text=f'Flow row {ti+1}.{ri+1}'
    table.append(new)
   if matched:
    pr.remove(pos)
    for name in ('jc','tblInd'):
     old=pr.find(q(name))
     if old is not None:pr.remove(old)
    # Match the disclosed ordinary-flow approximation with zero indent.
    pr.insert(list(pr).index(pr.find(q('tblW')))+1,ET.Element(q('tblInd'),{q('w'):'0',q('type'):'dxa'}))
  updated={**parts,'word/document.xml':ET.tostring(body,encoding='utf-8',xml_declaration=True)}
  with ZipFile(out/(mode+('-matched' if matched else '-unsupported')+'.docx'),'w') as z:
   for name,data in sorted(updated.items()):
    info=ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
print('Authored six paired multi-page rich controls')
