"""Measure Windows DirectWrite GDI-compatible metrics from exact private font files.

API signatures/vtable order: Microsoft win32metadata dwrite.h;
https://learn.microsoft.com/windows/win32/api/dwrite/nf-dwrite-idwritefontface-getgdicompatibleglyphmetrics
No font installation, system collection substitution, or shaping implementation.
"""
import ctypes as C,uuid,json,hashlib,struct,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
if len(sys.argv)!=3:raise SystemExit('Usage: check-legacy-dwrite-metrics.py FONT_DIRECTORY OUTPUT_JSON')
work=Path(sys.argv[1]);output=Path(sys.argv[2])
ptr=C.c_void_p;u=C.c_uint32;i=C.c_int32;w=C.c_uint16;f=C.c_float
class Metric(C.Structure):_fields_=[('left',i),('advance',u),('right',i),('top',i),('advanceHeight',u),('bottom',i),('verticalOrigin',i)]
def call(p,index,result,*args):
 address=C.cast(p,C.POINTER(C.POINTER(ptr))).contents[index]
 fn=C.WINFUNCTYPE(result,ptr,*args)(address)
 return lambda *values:fn(p,*values)
def check(hr):
 if hr<0:raise OSError(hex(hr&0xffffffff))
factory=ptr();guid=C.create_string_buffer(uuid.UUID('b859ee5a-d838-4b5b-a2e8-1adc7d93db48').bytes_le)
create=C.WinDLL('dwrite').DWriteCreateFactory;create.argtypes=[i,ptr,C.POINTER(ptr)];create.restype=i;check(create(0,guid,C.byref(factory)))
ref=json.loads((repo/'tests/fixtures/legacy-continuation/reference.json').read_text());hashes=json.loads((repo/'tests/fixtures/empty-gpos-kerning/diagnostic-fonts.json').read_text())['sha256'];rows=[]
for name,expected in ref['hashes'].items():assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==expected
try:
 for pair in ref['pairs']:
  path=work/('OpenSans-1.10-'+('Regular' if pair['style']=='regular' else 'Bold')+'.ttf');data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==hashes[path.name]
  table=next(struct.unpack_from('>I',data,q+8)[0] for q in range(12,12+16*struct.unpack_from('>H',data,4)[0],16) if data[q:q+4]==b'head');em=struct.unpack_from('>H',data,table+18)[0]
  file=ptr();face=ptr()
  try:
   check(call(factory,7,i,C.c_wchar_p,ptr,C.POINTER(ptr))(str(path),None,C.byref(file)))
   supported=i();filetype=i();facetype=i();count=u();check(call(file,5,i,C.POINTER(i),C.POINTER(i),C.POINTER(i),C.POINTER(u))(C.byref(supported),C.byref(filetype),C.byref(facetype),C.byref(count)));assert supported.value and count.value==1
   check(call(factory,9,i,i,u,C.POINTER(ptr),u,i,C.POINTER(ptr))(facetype.value,1,C.byref(file),0,0,C.byref(face)))
   n=len(pair['text']);codepoints=(u*n)(*map(ord,pair['text']));glyphs=(w*n)();check(call(face,11,i,C.POINTER(u),u,C.POINTER(w))(codepoints,n,glyphs))
   native=[];x=0
   for a in pair['wrappedAdvances']:native.append(x*.12);x+=a
   for dpi in [96,120,600]:
    for natural in [False,True]:
     metrics=(Metric*n)();check(call(face,17,i,f,f,ptr,i,C.POINTER(w),u,C.POINTER(Metric),i)(14*4/3,dpi/96,None,natural,glyphs,n,metrics,0))
     x=0;origins=[]
     for m in metrics:origins.append(x);x+=m.advance/em*14
     rows.append(dict(style=pair['style'],dpi=dpi,natural=natural,advances=[m.advance for m in metrics],unitsPerEm=em,maxOriginErrorPt=max(abs(a-b) for a,b in zip(origins,native))))
  finally:
   if face:call(face,2,u)()
   if file:call(file,2,u)()
finally:call(factory,2,u)()
output.write_text(json.dumps(rows,indent=2)+'\n');print([(r['style'],r['dpi'],r['natural'],round(r['maxOriginErrorPt'],6)) for r in rows])
