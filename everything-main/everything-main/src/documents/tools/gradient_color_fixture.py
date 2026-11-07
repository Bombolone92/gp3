"""Original color interpolation controls, without corpus content."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1];out=repo/'tests/fixtures/gradient-colors';out.mkdir(exist_ok=True);ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
cases=[['000000','FFFFFF'],['FF0000','0000FF'],['FF1571','FDC082'],['000000','C0C0C0'],['FF0000','00FF00','0000FF'],['FF1571','FE6B7A','FDC082'],['FF0000','00FF00'],['00FF00','0000FF'],['202020','808080'],['FF0000','FF8080'],['FF1571','FF1571','FDC082'],['FF1571','FDC082','FDC082']]
with ZipFile(repo/'tests/fixtures/shape-gradients/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
d=E.fromstring(parts['word/document.xml'])
for g,colors in zip(d.findall('.//a:gradFill',ns),cases):
 lst=g.find('a:gsLst',ns);lst.clear()
 for i,c in enumerate(colors):
  stop=E.SubElement(lst,'{'+ns['a']+'}gs',pos=str(round(100000*i/(len(colors)-1))))
  E.SubElement(stop,'{'+ns['a']+'}srgbClr',val=c)
 g.find('a:lin',ns).set('ang','0')
parts['word/document.xml']=E.tostring(d,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases),encoding='utf-8')
