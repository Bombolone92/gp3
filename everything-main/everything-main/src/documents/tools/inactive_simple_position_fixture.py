"""Original controls for inactive simple-position coordinates on floating pictures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/inactive-simple-position';out.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/mixed-cell-anchors/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[('0','0','0'),('false','914400','1828800'),('false','-914400','-1828800'),('0','20116800','-20116800')]
r=E.fromstring(parts['word/document.xml'])
for i,(a,(flag,x,y)) in enumerate(zip(r.findall('.//{'+wp+'}anchor'),cases)):
 a.set('behindDoc','0')
 table=next(n for n in a.iterancestors() if E.QName(n).localname=='tbl')
 table.getprevious().find('.//{'+w+'}t').text=f'Inactive simple position: flag={flag}, x={x}, y={y}'
 if flag is None:a.attrib.pop('simplePos')
 else:a.set('simplePos',flag)
 a.find('{'+wp+'}simplePos').attrib.update({'x':x,'y':y})
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='utf-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
# Schema-valid omitted-flag control: the installed reference application refuses to open this variant.
r.find('.//{'+wp+'}anchor').attrib.pop('simplePos')
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='utf-8',standalone=True)
with ZipFile(out/'omitted-flag.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
