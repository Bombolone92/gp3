"""Original relative-size variants of the independently authored cell-anchor controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import sys
ROOT=Path(__file__).resolve().parents[1]
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WP14='http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
suffix='-legacy' if '--legacy' in sys.argv else ''
with ZipFile(ROOT/f'public/fixtures/table-global-anchors{suffix}.docx') as z:
 parts={n:z.read(n) for n in z.namelist()}
old=E.fromstring(parts['word/document.xml'])
root=E.Element(old.tag,nsmap={**old.nsmap,'wp14':WP14,'mc':MC})
root.attrib.update(old.attrib);root.set('{'+MC+'}Ignorable','wp14');root.extend(old)
for i,a in enumerate(root.iter('{'+WP+'}anchor')):
 base='margin' if i%4 in [1,3] else 'page'
 for axis,child,value in [('H','pctWidth',0 if i%4==3 else 25000),('V','pctHeight',0 if i%4==2 else 10000)]:
  node=E.SubElement(a,'{'+WP14+'}sizeRel'+axis,relativeFrom=base)
  E.SubElement(node,'{'+WP14+'}'+child).text=str(value)
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
path=ROOT/f'public/fixtures/table-relative-anchors{suffix}.docx'
with ZipFile(path,'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
print(path)
