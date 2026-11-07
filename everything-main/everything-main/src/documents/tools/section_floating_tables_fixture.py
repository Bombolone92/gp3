"""Original section-composition controls, using an authored numeric float case."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'; q=lambda n:'{'+W+'}'+n
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/section-floating-tables';folder.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/multipage-floating/text-480-15.docx') as z: parts={n:z.read(n) for n in z.namelist()}
original=E.fromstring(parts['word/document.xml']);body=original.find(q('body'));section=deepcopy(body.find(q('sectPr')));blocks=[deepcopy(n) for n in body if n.tag!=q('sectPr')]
for name,kind in [('separate','nextPage'),('continuous','continuous'),('same','same')]:
 doc=deepcopy(original);target=doc.find(q('body'))
 for n in list(target):target.remove(n)
 first=[deepcopy(n) for n in blocks]
 if kind!='same':
  props=first[-1].find(q('pPr'))
  if props is None:props=E.Element(q('pPr'));first[-1].insert(0,props)
  own=deepcopy(section);start=E.Element(q('type'));start.set(q('val'),'nextPage');own.insert(0,start);props.append(own)
 for n in first+deepcopy(blocks):target.append(n)
 last=deepcopy(section)
 if kind!='same':start=E.Element(q('type'));start.set(q('val'),kind);last.insert(0,start)
 target.append(last);package={**parts,'word/document.xml':E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)}
 with ZipFile(folder/(name+'.docx'),'w') as z:
  for n,b in package.items():
   info=ZipInfo(n,(2026,10,5,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,b)
 print(folder/(name+'.docx'))
