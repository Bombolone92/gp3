"""Independent variants of our own vector controls; no corpus media is copied."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/wmf-standard'
with ZipFile(ROOT / 'tests/fixtures/wmf-vectors/control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}

def change(data, standard=False, flagged=False, comment=False):
    header = 22
    b = bytearray(data)
    at = 40
    while at < len(b):
        size, kind = struct.unpack_from('<IH', b, at)
        if flagged and kind == 0x02fc:
            b[at + 11] = 2
        at += size * 2
    if comment:
        text = b'Independent comment'
        payload = struct.pack('<HH', 15, len(text)) + text + b'\0' * (len(text) % 2)
        record = struct.pack('<IH', 3 + len(payload)//2, 0x0626) + payload
        b[40:40] = record
        struct.pack_into('<I', b, 28, (len(b)-22)//2)
        struct.pack_into('<I', b, 34, max(struct.unpack_from('<I', b, 34)[0], len(record)//2))
    return bytes(b[header:] if standard else b)

for i in range(7):
    source = parts[f'word/media/control{2 if i == 2 else 0}.wmf']
    parts[f'word/media/control{i}.wmf'] = change(source, standard=i in (1,2,3,5,6), flagged=i in (4,5,6), comment=i in (3,5))
# Both directions of the filename/content-type compatibility behavior.
with ZipFile(ROOT / 'public/fixtures/emf-paths.docx') as z:
    parts['word/media/control7.wmf'] = z.read('word/media/control0.emf')
parts['word/media/control5.emf'] = parts.pop('word/media/control5.wmf')
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
for rel in rels:
    if rel.get('Target') == 'media/control5.wmf':
        rel.set('Target', 'media/control5.emf')
parts['word/_rels/document.xml.rels'] = E.tostring(rels)
types = E.fromstring(parts['[Content_Types].xml'])
E.SubElement(types, '{'+E.QName(types).namespace+'}Default', Extension='emf', ContentType='image/x-emf')
parts['[Content_Types].xml'] = E.tostring(types)
OUT.mkdir(exist_ok=True)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
