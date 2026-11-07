"""Measure exact native LOGFONTs with process-private diagnostic fonts. Windows only."""
import ctypes as C,struct,json,hashlib,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
if len(sys.argv)!=3:raise SystemExit('Usage: check-legacy-gdi-advances.py FONT_DIRECTORY OUTPUT_JSON')
work=Path(sys.argv[1]);output=Path(sys.argv[2])
ref=json.loads((repo/'tests/fixtures/legacy-continuation/reference.json').read_text())
for name,expected in ref['hashes'].items():assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==expected
hashes=json.loads((repo/'tests/fixtures/empty-gpos-kerning/diagnostic-fonts.json').read_text())['sha256']
data=(repo/'tests/fixtures/legacy-continuation/native.emf').read_bytes();fonts={};p=0
while p<len(data):
 kind,size=struct.unpack_from('<II',data,p)
 if kind==82:
  raw=data[p+12:p+104];face=raw[28:].decode('utf-16le').split('\0')[0];weight=struct.unpack_from('<i',raw,16)[0]
  if face=='Open Sans':fonts[weight]=raw
 p+=size
gdi=C.WinDLL('gdi32',use_last_error=True)
def api(name,args,result):
 f=getattr(gdi,name);f.argtypes=args;f.restype=result;return f
ptr=C.c_void_p;u=C.c_uint32;i=C.c_int32
add=api('AddFontMemResourceEx',[ptr,u,ptr,C.POINTER(u)],ptr);remove=api('RemoveFontMemResourceEx',[ptr],i)
dcnew=api('CreateCompatibleDC',[ptr],ptr);dcdel=api('DeleteDC',[ptr],i)
fontdata=api('GetFontData',[ptr,u,u,ptr,u],u)
fontnew=api('CreateFontIndirectW',[ptr],ptr);objdel=api('DeleteObject',[ptr],i);select=api('SelectObject',[ptr,ptr],ptr)
class Size(C.Structure):_fields_=[('cx',i),('cy',i)]
measure=api('GetTextExtentExPointW',[ptr,C.c_wchar_p,i,i,C.POINTER(i),C.POINTER(i),C.POINTER(Size)],i)
rows=[]
for pair in ref['pairs']:
 name='OpenSans-1.10-'+('Regular' if pair['style']=='regular' else 'Bold')+'.ttf';fontbytes=(work/name).read_bytes();assert hashlib.sha256(fontbytes).hexdigest()==hashes[name]
 blob=C.create_string_buffer(fontbytes);count=u();resource=add(blob,len(fontbytes),None,C.byref(count));assert resource and count.value
 dc=dcnew(None);font=None;old=None
 try:
  raw=fonts[400 if pair['style']=='regular' else 700];lf=C.create_string_buffer(raw);font=fontnew(lf);assert font;old=select(dc,font)
  tables={fontbytes[q:q+4]:(struct.unpack_from('>I',fontbytes,q+8)[0],struct.unpack_from('>I',fontbytes,q+12)[0]) for q in range(12,12+16*struct.unpack_from('>H',fontbytes,4)[0],16)}
  verified={}
  for tag in [b'name',b'head',b'hmtx',b'cmap',b'kern']:
   offset,length=tables[tag];buffer=C.create_string_buffer(length)
   assert fontdata(dc,int.from_bytes(tag,'little'),0,buffer,length)==length
   assert buffer.raw==fontbytes[offset:offset+length],tag
   verified[tag.decode()]=hashlib.sha256(buffer.raw).hexdigest()
  text=pair['text'];dx=(i*len(text))();fit=i();size=Size();assert measure(dc,text,len(text),2147483647,C.byref(fit),dx,C.byref(size))
  advances=[dx[k]-(dx[k-1] if k else 0) for k in range(len(text))]
  origins=[0]+list(dx)[:-1];native=[];x=0
  for a in pair['wrappedAdvances']:native.append(x);x+=a
  rows.append(dict(style=pair['style'],privateFontSha256=hashes[name],fontDescription=pair['font'],verifiedSelectedTables=verified,gdiAdvances=advances,nativeAdvances=pair['wrappedAdvances'],maxOriginErrorLogical=max(abs(a-b) for a,b in zip(origins,native))))
 finally:
  if old:select(dc,old)
  if font:objdel(font)
  dcdel(dc);remove(resource)
output.write_text(json.dumps(rows,indent=2)+'\n');print([(r['style'],r['maxOriginErrorLogical']) for r in rows])
