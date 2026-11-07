from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
p=Path(__file__).resolve().parents[1]/'public/fixtures'
with ZipFile(p/'compound-border-controls.docx') as z: parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']); w=root.nsmap['w']; tag=lambda n:'{'+w+'}'+n
names=['double','triple','unequal-double','mixed-two-strokes']
for context in ['pBdr','tblBorders']:
 for i,borders in enumerate(root.iter(tag(context))):
  for edge in borders:
   side=E.QName(edge).localname
   style='double' if i in [0,2] else 'triple' if i==1 else 'thinThickLargeGap' if side in ['top','right'] else 'double'
   size=8 if i<2 else {'top':8,'left':16,'bottom':24,'right':32}[side] if i==2 else 24 if style=='thinThickLargeGap' else 8
   edge.set(tag('val'),style);edge.set(tag('sz'),str(size))
labels=[n for n in root.iter(tag('t')) if (n.text or '').startswith(('paragraph:','table:'))]
for i,n in enumerate(labels):n.text=('Paragraph' if i<4 else 'Table')+' corner: '+names[i%4]
if '--mixed-counts' in __import__('sys').argv:
 for context in ['pBdr','tblBorders']:list(root.iter(tag(context)))[-1].find(tag('left')).set(tag('val'),'triple')
if '--colors' in __import__('sys').argv:
 for parent in root.iter():
  if E.QName(parent).localname in ['pBdr','tblBorders']:
   for edge in parent:edge.set(tag('color'),{'left':'CC3300','right':'0066CC','bottom':'009900','top':'000000'}[E.QName(edge).localname])
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(p/('border-corner-mixed-counts.docx' if '--mixed-counts' in __import__('sys').argv else 'border-corner-colors.docx' if '--colors' in __import__('sys').argv else 'border-corner-controls.docx'),'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
