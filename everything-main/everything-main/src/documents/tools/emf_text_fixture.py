"""Original MS-EMF logical-font and Unicode text records; no rendering engine."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import struct,json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/emf-text';OUT.mkdir(exist_ok=True)
def ints(*v):return struct.pack('<'+'i'*len(v),*v)
def record(t,p=b''):return struct.pack('<II',t,len(p)+8)+p
cases=[dict(name=n,align=a,weight=w,italic=i,pdy=pdy,scale=scale) for n,a,w,i,pdy,scale in [
 ('baseline',24,400,0,False,1),('bold',24,700,0,False,1),
 ('italic',24,400,1,False,1),('center',30,400,0,False,1),
 ('right',26,400,0,False,1),('top',0,400,0,False,1),
 ('two-axis-advances',24,400,0,True,1),('anisotropic',24,400,0,False,.7)]]
def emf(case):
 font=bytearray(320)
 struct.pack_into('<5i8B',font,0,-120,0,0,0,case['weight'],case['italic'],0,0,0,0,0,0,0)
 font[28:28+12]='Arial\0'.encode('utf-16-le')
 r=[record(17,ints(8)),record(9,ints(1000,450)),record(11,ints(200,90)),
    record(18,ints(1)),record(22,ints(case['align'])),record(24,ints(0x804020)),
    record(82,ints(1)+font),record(37,ints(1))]
 if case['scale']!=1:r.append(record(35,struct.pack('<6f',case['scale'],0,0,1,0,0)))
 text='Ab &Ω';data=text.encode('utf-16-le');n=len(data)//2
 offset=76;dxoffset=(offset+len(data)+3)//4*4
 x=500 if case['align']&6 else 100;y=200
 advance=[90,80,70,110,100]
 dx=[v for pair in zip(advance,[0,20,-20,10,0]) for v in pair] if case['pdy'] else advance
 payload=ints(0,0,999,449,1)+struct.pack('<2f',1,1)+ints(x,y,n,offset,8192 if case['pdy'] else 0,0,0,0,0,dxoffset)
 payload+=data+b'\0'*(dxoffset-offset-len(data))+ints(*dx)
 r.extend([record(84,payload),record(37,struct.pack('<I',0x8000000d)),record(40,ints(1)),record(14,ints(0,0,20))])
 total=88+sum(map(len,r));head=struct.pack('<II4i4iIIIIHHIII4i',1,88,0,0,199,89,0,0,5292,2381,0x464d4520,0x10000,total,len(r)+1,2,0,0,0,0,1280,720,339,190)
 return head+b''.join(r)
with ZipFile(ROOT/'public/fixtures/emf-paths.docx') as z:parts={n:z.read(n) for n in z.namelist()}
for i,case in enumerate(cases):parts[f'word/media/control{i}.emf']=emf(case)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
