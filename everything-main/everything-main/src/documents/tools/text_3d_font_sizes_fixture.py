"""Original paired plain/bevel text controls; reads no corpus or font data."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import json
repo=Path(__file__).resolve().parents[1];root=repo/'tests/fixtures/text-3d';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo/'tests/fixtures/text-3d/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find('{'+W+'}body');ps=list(body);sect=deepcopy(ps[-1]);body.clear();cases=[]
for font in ['Arial','Franklin Gothic Book']:
 for size in [24,144]:
  for bold in [False,True]:
   block=[deepcopy(p) for p in ps[15:18]];name=f'{font} {size} '+('bold' if bold else 'regular');block[0].find('.//{'+W+'}t').text=name
   if not cases:
    pb=block[0].find('.//{'+W+'}pageBreakBefore');pb.getparent().remove(pb)
   rp=block[1].find('.//{'+W+'}rPr');rf=E.Element('{'+W+'}rFonts',{'{'+W+'}ascii':font,'{'+W+'}hAnsi':font});rp.insert(0,rf);rp.find('{'+W+'}b').set('{'+W+'}val',str(int(bold)));rp.find('{'+W+'}sz').set('{'+W+'}val',str(size*2));body.extend(block);cases.append({'name':name,'font':font,'size':size,'bold':bold})
body.append(sect);parts['word/document.xml']=E.tostring(r)
with ZipFile(root/'font-sizes.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(root/'font-sizes-cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
for node in r.findall('.//{http://schemas.microsoft.com/office/word/2010/wordml}props3d'): node.getparent().remove(node)
parts['word/document.xml']=E.tostring(r)
with ZipFile(root/'font-sizes-plain.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
