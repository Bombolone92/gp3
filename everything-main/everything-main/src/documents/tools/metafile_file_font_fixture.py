"""Original metafile controls using the reviewed, renamed OFL font family."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from struct import unpack_from
import json, hashlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/metafile-file-fonts'
OUT.mkdir(exist_ok=True)
FAMILY = 'Corpus File Font'
with ZipFile(ROOT / 'tests/fixtures/emf-text/control.docx') as z:
    parts = {name: z.read(name) for name in z.namelist()}
for name, value in list(parts.items()):
    if not name.endswith('.emf'):
        continue
    data = bytearray(value)
    at = 0
    while at < len(data):
        kind, size = unpack_from('<II', data, at)
        if kind == 82:
            data[at+40:at+104] = b'\0' * 64
            text = (FAMILY + '\0').encode('utf-16-le')
            data[at+40:at+40+len(text)] = text
        at += size
    parts[name] = bytes(data)

def save(name, package):
    with ZipFile(OUT / name, 'w') as z:
        for part, data in package.items():
            entry = ZipInfo(part, (2026, 9, 30, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            z.writestr(entry, data)

save('control.docx', parts)
(OUT / 'source-hashes.json').write_text(json.dumps({'control.docx': hashlib.sha256((OUT/'control.docx').read_bytes()).hexdigest()}, indent=2)+'\n')
