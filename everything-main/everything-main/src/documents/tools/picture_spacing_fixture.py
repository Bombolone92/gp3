from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
out=root/'public/fixtures/picture-spacing.docx'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
q=lambda n:'{'+W+'}'+n
with ZipFile(root/'public/fixtures/picture-ellipse.docx') as z: parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(q('body'));sect=deepcopy(body.find(q('sectPr')))
inline=deepcopy(doc.find('.//{'+WP+'}inline'))
body.clear()
for i,spacing in enumerate([0,200,-200,1000,-1000]):
 p=E.SubElement(body,q('p'));pr=E.SubElement(p,q('pPr'));E.SubElement(pr,q('spacing'),{q('after'):'200'})
 r=E.SubElement(p,q('r'));rp=E.SubElement(r,q('rPr'));E.SubElement(rp,q('spacing'),{q('val'):str(spacing)});drawing=E.SubElement(r,q('drawing'));pic=deepcopy(inline);pic.find('{'+WP+'}docPr').set('id',str(i+1));drawing.append(pic)
 r=E.SubElement(p,q('r'));E.SubElement(r,q('t')).text='NEXT'+str(i)
body.append(sect)
parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
print(out)
