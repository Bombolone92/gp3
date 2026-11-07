"""Original high-record-count controls derived from our authored EMF paths."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/emf-record-count'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT/'public/fixtures/emf-paths-float-miter.docx') as z:
 parts={n:z.read(n) for n in z.namelist()}
for name,original in list(parts.items()):
 if not name.endswith('.emf'): continue
 # Independent state records do not paint; end with the initial even/odd mode.
 states=b''.join(struct.pack('<III',19,12,2 if i%2==0 else 1) for i in range(12000))
 header_size=struct.unpack_from('<I',original,4)[0]
 b=bytearray(original[:header_size]+states+original[header_size:])
 struct.pack_into('<I',b,48,len(b))
 struct.pack_into('<I',b,52,struct.unpack_from('<I',original,52)[0]+12000)
 parts[name]=b
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items(): z.writestr(n,b)
