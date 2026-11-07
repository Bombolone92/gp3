"""Author original WMF records directly; reuse only our own DOCX test layout."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/wmf-vectors'
OUT.mkdir(parents=True, exist_ok=True)
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

def words(*values):
    return struct.pack('<' + 'h' * len(values), *values)

def record(function, payload=b''):
    assert len(payload) % 2 == 0
    return struct.pack('<IH', 3 + len(payload) // 2, function) + payload

def metafile(case):
    # Two pairs isolate implicit/explicit mapping and ordinary/padded pens.
    origin = (120, -240) if case in (2, 3) else (0, 0)
    reverse = case in (2, 3)
    r = []
    if case in (1, 3):
        r.append(record(0x0103, words(8)))
    r += [record(0x020b, words(origin[1], origin[0])),
          record(0x020c, words(-450 if reverse else 450, 1000))]
    # Null pen, blue solid brush; pad one pen with an arbitrary nonzero word.
    r += [record(0x02fa, words(5, 0, 0) + struct.pack('<I', 0) + (words(1234) if case == 5 else b'')),
          record(0x012d, words(0)),
          record(0x02fc, words(0) + struct.pack('<I', 0xbe5014) + words(0)),
          record(0x012d, words(1)), record(0x0104, words(13)),
          record(0x0106, words(2 if case == 7 else 1))]
    def polygon(points):
        ps = [(x + origin[0], origin[1] - y if reverse else y + origin[1]) for x, y in points]
        return record(0x0324, words(len(ps)) + b''.join(words(*p) for p in ps))
    if case in (6, 7):
        # Same-orientation nested loops: alternate has a hole, winding does not.
        ps = [(100, 50), (900, 50), (900, 400), (100, 400), (100, 50),
              (300, 150), (700, 150), (700, 300), (300, 300), (300, 150), (100, 50)]
    else:
        ps = [(100, 50), (900, 50), (600, 225), (900, 400), (100, 400), (300, 225)]
    r += [polygon(ps), record(0)]
    body = b''.join(r)
    header = struct.pack('<HHHIHIH', 1, 9, 0x300, 9 + len(body) // 2, 2, max(len(x) // 2 for x in r), 0)
    placeable = struct.pack('<IHhhhhHI', 0x9ac6cdd7, 0, 0, 0, 1000, 450, 1000, 0)
    checksum = 0
    for value in struct.unpack('<10H', placeable):
        checksum ^= value
    return placeable + struct.pack('<H', checksum) + header + body

with ZipFile(ROOT / 'public/fixtures/shape-defaults.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
for i, anchor in enumerate(root.iter('{' + WP + '}anchor')):
    data = anchor.find('{' + A + '}graphic/{' + A + '}graphicData')
    data.clear(); data.set('uri', P)
    pic = E.SubElement(data, '{' + P + '}pic', nsmap={'pic': P})
    nv = E.SubElement(pic, '{' + P + '}nvPicPr')
    E.SubElement(nv, '{' + P + '}cNvPr', id='0', name=f'Original WMF {i}')
    E.SubElement(nv, '{' + P + '}cNvPicPr')
    fill = E.SubElement(pic, '{' + P + '}blipFill')
    E.SubElement(fill, '{' + A + '}blip', {'{' + R + '}embed': f'wmf{i}'})
    E.SubElement(E.SubElement(fill, '{' + A + '}stretch'), '{' + A + '}fillRect')
    pr = E.SubElement(pic, '{' + P + '}spPr')
    x = E.SubElement(pr, '{' + A + '}xfrm')
    E.SubElement(x, '{' + A + '}off', x='0', y='0')
    E.SubElement(x, '{' + A + '}ext', **anchor.find('{' + WP + '}extent').attrib)
    E.SubElement(E.SubElement(pr, '{' + A + '}prstGeom', prst='rect'), '{' + A + '}avLst')
    E.SubElement(rels, '{' + E.QName(rels).namespace + '}Relationship', Id=f'wmf{i}', Type=R + '/image', Target=f'media/control{i}.wmf')
    parts[f'word/media/control{i}.wmf'] = metafile(i)
parts['word/document.xml'] = E.tostring(root)
parts['word/_rels/document.xml.rels'] = E.tostring(rels)
types = E.fromstring(parts['[Content_Types].xml'])
E.SubElement(types, '{' + E.QName(types).namespace + '}Default', Extension='wmf', ContentType='image/x-wmf')
parts['[Content_Types].xml'] = E.tostring(types)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
print(OUT / 'control.docx')
