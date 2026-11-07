"""Original outer/inner hyperlink precedence control; no third-party content."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import sys
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
with ZipFile(root/'public/fixtures/inline-images.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('{'+W+'}body')
drawing=deepcopy(doc.find('.//{'+W+'}drawing'));sect=deepcopy(body.find('{'+W+'}sectPr'))
for c in list(body):body.remove(c)
for i,(outer,inner) in enumerate([(True,False),(False,True),(True,True),(False,False)],1):
 p=E.SubElement(body,'{'+W+'}p');r=E.SubElement(p,'{'+W+'}r');E.SubElement(r,'{'+W+'}t').text=f'Control {i}: '
 r=E.SubElement(p,'{'+W+'}r');d=deepcopy(drawing);r.append(d)
 pr=d.find('.//{'+WP+'}docPr');pr.set('id',str(i));pr.set('name',f'Control {i}')
 for enabled,node,relid in [(outer,pr,'probeOuter'),(inner,d.find('.//{'+PIC+'}cNvPr'),'probeInner')]:
  if enabled:E.SubElement(node,'{'+A+'}hlinkClick',{'{'+R+'}id':relid,'tooltip':relid,'tgtFrame': ('"_blank"' if i==2 else 'namedFrame') if '--inner-frames' in sys.argv and relid=='probeInner' else '_blank'})
body.append(sect)
rels=E.fromstring(parts['word/_rels/document.xml.rels'])
for suffix in ['Outer','Inner']:E.SubElement(rels,'{'+REL+'}Relationship',Id='probe'+suffix,Type=R+'/hyperlink',Target='https://example.com/'+suffix.lower(),TargetMode='External')
parts['word/document.xml']=E.tostring(doc);parts['word/_rels/document.xml.rels']=E.tostring(rels)
with ZipFile(root/'tests/fixtures/drawing-hyperlinks'/('inner-frames.docx' if '--inner-frames' in sys.argv else 'precedence.docx'),'w',ZIP_DEFLATED) as z:
 for n,v in parts.items():z.writestr(n,v)
