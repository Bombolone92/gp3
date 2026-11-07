"""Extract native control edits from an explicitly supplied scratch directory."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from lxml import etree as E
import json,sys,shutil
root=Path(__file__).resolve().parents[1]/'tests/fixtures/picture-controls'
if '--placeholders' in sys.argv:root=root/'placeholders'
native=Path(sys.argv[1]).resolve();results=json.loads((native/'results.json').read_text(encoding='utf-8-sig'))
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
cases=[]
for result in results:
 name=result['name']
 with ZipFile(native/(name+'-native.docx')) as z:data=z.read('word/document.xml')
 r=E.fromstring(data);control=r.xpath('//w:sdt[w:sdtPr/w:alias/@w:val=$name]',namespaces=ns,name=name)
 (root/(name+'-native.xml')).write_bytes(data)
 cases.append(dict(name=name,error=result['error'],controls=result['controls'],pictures=result['pictures'],retained=bool(control),
                   insidePictures=len(control[0].findall('.//w:drawing',ns)) if control else 0,
                   placeholder=bool(control and control[0].find('w:sdtPr/w:showingPlcHdr',ns) is not None),
                   extents=[dict(e.attrib) for c in control for e in c.findall('.//wp:extent',ns)],xmlSha256=sha256(data).hexdigest()))
shutil.copyfile(native/'native.pdf',root/'native.pdf')
(root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=sha256((root/'control.docx').read_bytes()).hexdigest(),pdfSha256=sha256((root/'native.pdf').read_bytes()).hexdigest(),cases=cases),indent=2)+'\n')
