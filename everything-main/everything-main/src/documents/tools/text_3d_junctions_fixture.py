"""Independent text bevel junction experiment; no corpus content is read."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import json
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/text-3d'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo/'tests/fixtures/text-3d/control.docx') as z:
 parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('{'+W+'}body')
original=list(body);section=deepcopy(original[-1]);body.clear();cases=[]
for font,bold in [('Arial',False),('Franklin Gothic Book',False),('Franklin Gothic Book',True)]:
 for text in ['Y','4']:
  block=[deepcopy(p) for p in original[15:18]]
  name=f'{font}, '+('bold' if bold else 'regular')+f', {text}'
  block[0].find('.//{'+W+'}t').text=name
  if not cases:
   pb=block[0].find('.//{'+W+'}pageBreakBefore');pb.getparent().remove(pb)
  rp=block[1].find('.//{'+W+'}rPr')
  rp.insert(0,E.Element('{'+W+'}rFonts',{'{'+W+'}ascii':font,'{'+W+'}hAnsi':font}))
  rp.find('{'+W+'}b').set('{'+W+'}val',str(int(bold)))
  rp.find('{'+W+'}sz').set('{'+W+'}val','650')
  block[1].find('.//{'+W+'}t').text=text
  body.extend(block);cases.append(dict(name=name,font=font,bold=bold,text=text,size=325))
body.append(section);parts['word/document.xml']=E.tostring(doc)
with ZipFile(root/'junctions.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(root/'junction-cases.json').write_text(json.dumps(cases,indent=2))

