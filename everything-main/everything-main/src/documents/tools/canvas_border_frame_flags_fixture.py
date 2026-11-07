"""Original controls isolating left/right frame flags on compound borders."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]/'public/fixtures'
with ZipFile(root/'compound-border-frame.docx') as z:parts={n:z.read(n) for n in z.namelist()}
for side in ['top','left','bottom','right']:
 doc=E.fromstring(parts['word/document.xml']);w='{'+doc.nsmap['w']+'}'
 for edge in doc.iter():
  if edge.get(w+'val')=='thinThickLargeGap':edge.set(w+'frame','1' if E.QName(edge).localname==side else '0')
 out=dict(parts);out['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
 with ZipFile(root/f'border-frame-only-{side}.docx','w',ZIP_DEFLATED) as z:
  for name,data in out.items():z.writestr(name,data)
