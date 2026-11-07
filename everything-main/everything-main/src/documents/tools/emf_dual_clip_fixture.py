"""Original EMF Dual envelopes and clipped Unicode text, from MS-EMF/EMFPLUS."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct, json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/emf-dual-clip'
OUT.mkdir(exist_ok=True)
def record(kind, payload=b''):
    return struct.pack('<II', kind, len(payload)+8)+payload
def plus(kind, flags=0, payload=b''):
    return struct.pack('<HHII', kind, flags, len(payload)+12, len(payload))+payload
def comment(payload):
    payload=b'EMF+'+payload
    return record(70, struct.pack('<I', len(payload))+payload)

cases = [
    dict(name='dual-unclipped-unused-font', source=0, dual=True, unusedFont=True),
    dict(name='plain-horizontal-clip', source=0, clip=[130,0,400,450]),
    dict(name='dual-horizontal-clip', source=0, dual=True, clip=[130,0,400,450]),
    dict(name='vertical-clip', source=0, dual=True, clip=[0,150,1000,180]),
    dict(name='two-axis-clip', source=6, dual=True, clip=[130,120,450,195]),
    dict(name='anisotropic-clip', source=7, dual=True, clip=[130,0,400,450]),
    dict(name='outside-clip', source=0, dual=True, clip=[700,0,900,450]),
    dict(name='empty-clip', source=0, dual=True, clip=[200,0,200,450]),
]
with ZipFile(ROOT/'tests/fixtures/emf-text/control.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
original = dict(parts)
for i, case in enumerate(cases):
    data=original[f'word/media/control{case["source"]}.emf']
    records=[]; at=0
    while at<len(data):
        kind,size=struct.unpack_from('<II',data,at)
        records.append(bytearray(data[at:at+size]));at+=size
    text=next(r for r in records if struct.unpack_from('<I',r)[0]==84)
    # A second, unclipped line detects clipping state leaking to later records.
    later=bytearray(text);struct.pack_into('<i',later,40,370)
    if 'clip' in case:
        options=struct.unpack_from('<I',text,52)[0]
        struct.pack_into('<I4i',text,52,options|4,*case['clip'])
    records.insert(records.index(text)+1,later)
    if case.get('unusedFont'):
        unused=bytearray(next(r for r in records if struct.unpack_from('<I',r)[0]==82))
        struct.pack_into('<ii',unused,12,16,7)
        records[-1:-1]=[unused,record(37,struct.pack('<I',1))]
    if case.get('dual'):
        header=plus(0x4001,1,struct.pack('<IIII',0xDBC01002,0,96,96))
        records.insert(1,comment(header+plus(0x4004)))
        records.insert(len(records)-1,comment(plus(0x4002)))
    struct.pack_into('<II',records[0],48,sum(map(len,records)),len(records))
    parts[f'word/media/control{i}.emf']=b''.join(records)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
