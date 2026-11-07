from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
base=Path(__file__).resolve().parents[2]/'public/fixtures';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda n:'{'+W+'}'+n
with ZipFile(base/'paragraph-border-width-control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(q('body'));original=[deepcopy(n) for n in list(body)[:4]];sect=deepcopy(body[-1]);body.clear()
for i,name in enumerate(['Plain','Top','Bottom','Left','Right','TopBottom','None','Zero']):
 group=[deepcopy(n) for n in original]
 if i:group[0].find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
 for n in group:
  for t in n.iter(q('t')):t.text=t.text.replace('Case0',name)
  for borders in list(n.iter(q('pBdr'))):
   for b in list(borders):
    side=E.QName(b).localname
    if name=='Plain' or name in ['Top','Bottom','Left','Right','TopBottom'] and side.title() not in name:borders.remove(b)
    elif name=='None':b.set(q('val'),'none')
    elif name=='Zero':b.set(q('sz'),'0')
   if name=='Plain':borders.getparent().remove(borders)
  body.append(n)
body.append(sect);parts['word/document.xml']=E.tostring(root)
with ZipFile(base/'paragraph-border-sides-control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
