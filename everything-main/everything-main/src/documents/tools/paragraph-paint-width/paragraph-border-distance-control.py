from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
base=Path(__file__).resolve().parents[2]/'public/fixtures';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda n:'{'+W+'}'+n
with ZipFile(base/'paragraph-border-width-control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(q('body'));original=[deepcopy(n) for n in list(body)[:4]];sect=deepcopy(body[-1]);body.clear()
for i,(space,size) in enumerate([(0,2),(1,2),(3,2),(10,2),(20,2),(10,8),(10,16),(10,32)]):
 group=[deepcopy(n) for n in original]
 if i:group[0].find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
 for n in group:
  for t in n.iter(q('t')):t.text=t.text.replace('Case0',f'S{space}W{size}')
  for borders in n.iter(q('pBdr')):
   for border in borders:border.set(q('sz'),str(size));border.set(q('space'),str(space))
  body.append(n)
body.append(sect);parts['word/document.xml']=E.tostring(root)
with ZipFile(base/'paragraph-border-distance-control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
