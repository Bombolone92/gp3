"""Original fine-detail WMF polygons, paired standard/placeable and cropped."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/wmf-crop-detail'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
P = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

def words(*values):
    return struct.pack('<' + 'h' * len(values), *values)

def record(kind, payload=b''):
    return struct.pack('<IH', 3 + len(payload)//2, kind) + payload

records = [record(0x020b, words(0, 0)), record(0x020c, words(450, 1000)),
           record(0x02fa, words(5, 0, 0) + struct.pack('<I', 0)), record(0x012d, words(0)),
           record(0x02fc, words(0) + struct.pack('<I', 0) + words(0)), record(0x012d, words(1))]

def polygon(points):
    records.append(record(0x0324, words(len(points)) + b''.join(words(*p) for p in points)))

for y in range(70, 210, 10):
    polygon([(100, y), (900, y), (900, y+2), (100, y+2)])
for x in range(100, 910, 30):
    polygon([(x, 260), (x+5, 260), (x+5, 400), (x, 400)])
polygon([(160, 220), (840, 220), (500, 250)])
records.append(record(0))
body = b''.join(records)
header = struct.pack('<HHHIHIH', 1, 9, 0x300, 9+len(body)//2, 2, max(len(r)//2 for r in records), 0)
placeable = struct.pack('<IHhhhhHI', 0x9ac6cdd7, 0, 0, 0, 1000, 450, 1000, 0)
checksum = 0
for n in struct.unpack('<10H', placeable):
    checksum ^= n
placeable += struct.pack('<H', checksum)

with ZipFile(ROOT / 'tests/fixtures/wmf-vectors/control.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
document = E.fromstring(parts['word/document.xml'])
for i, anchor in enumerate(document.iter('{'+WP+'}anchor')):
    parts[f'word/media/control{i}.wmf'] = (placeable if i % 2 else b'') + header + body
    fill = anchor.find('.//{'+P+'}blipFill')
    if i >= 2:
        crop = {'l':'10000', 't':'25000', 'r':'20000', 'b':'15000'} if i < 6 else {'l':'-20000', 't':'-15000', 'r':'10000', 'b':'5000'}
        fill.insert(1, E.Element('{'+A+'}srcRect', **crop))
    if i in (4, 5):
        anchor.find('.//{'+A+'}xfrm').set('flipH', '1')
parts['word/document.xml'] = E.tostring(document)
OUT.mkdir(exist_ok=True)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items():
        z.writestr(n, data)

for i, blip in enumerate(document.iter('{'+A+'}blip')):
    pairs = [('224466', 'EEDD99')]
    if i >= 4:
        pairs.append(('BB2233', '99DDEE'))
    for dark, light in pairs:
        effect = E.SubElement(blip, '{'+A+'}duotone')
        for color in (dark, light):
            E.SubElement(effect, '{'+A+'}srgbClr', val=color)
parts['word/document.xml'] = E.tostring(document)
with ZipFile(OUT / 'effects.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items():
        z.writestr(n, data)
