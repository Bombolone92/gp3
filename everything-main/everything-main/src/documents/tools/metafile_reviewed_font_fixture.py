"""Original EMF controls for reviewed fonts in isolated SVG images."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from struct import unpack_from
import hashlib,json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/metafile-reviewed-fonts';out.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/emf-text/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
for name,value in list(parts.items()):
    if not name.endswith('.emf'):continue
    data=bytearray(value);at=0
    while at<len(data):
        kind,size=unpack_from('<II',data,at)
        if kind==82:
            data[at+40:at+104]=b'\0'*64;family=('Karla\0').encode('utf-16-le');data[at+40:at+40+len(family)]=family
        at+=size
    parts[name]=bytes(data)
with ZipFile(out/'control.docx','w') as z:
    for name,data in parts.items():
        entry=ZipInfo(name,(2026,10,1,0,0,0));entry.compress_type=ZIP_DEFLATED;z.writestr(entry,data)
(out/'source-hashes.json').write_text(json.dumps({'control.docx':hashlib.sha256((out/'control.docx').read_bytes()).hexdigest()},indent=2)+'\n')
