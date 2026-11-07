"""Windows-only 128x480 grayscale to 16x60 native control probe.
Usage: python diagnose-wic-mask-resampling.py source.png word-mask.png output-dir
Calls the installed Windows API; contains no third-party renderer implementation.
"""
import ctypes as C,uuid,json,sys
from pathlib import Path
from PIL import Image
source=Path(sys.argv[1]).resolve();reference=Path(sys.argv[2]);output=Path(sys.argv[3]);output.mkdir(parents=True,exist_ok=True)
P=C.c_void_p;U=C.c_uint32
def guid(s):return (C.c_ubyte*16).from_buffer_copy(uuid.UUID(s).bytes_le)
def call(obj,index,types,*args):
    table=C.cast(obj,C.POINTER(C.POINTER(P))).contents
    result=C.WINFUNCTYPE(C.c_long,P,*types)(table[index])(obj,*args)
    if result<0:raise OSError(hex(result & 0xffffffff))
def release(obj):
    if obj:call(obj,2,[])
C.windll.ole32.CoInitialize(None)
factory=P();decoder=P();frame=P()
hr=C.windll.ole32.CoCreateInstance(guid('cacaf262-9370-4615-a13b-9f5539da4c0a'),None,1,guid('ec5ec8a9-c395-4314-9c77-54d7a935ff70'),C.byref(factory))
if hr<0:raise OSError(hr)
try:
    call(factory,3,[C.c_wchar_p,P,U,U,C.POINTER(P)],str(source),None,0x80000000,0,C.byref(decoder))
    call(decoder,13,[U,C.POINTER(P)],0,C.byref(frame))
    fmt=(C.c_ubyte*16)();call(frame,4,[P],fmt);assert str(uuid.UUID(bytes_le=bytes(fmt))) == '6fddc324-4e03-4bfe-b185-3d77768dc90c', 'Requires the authored 24bpp BGR grayscale source'
    native=Image.open(reference).getchannel('A').crop((1,1,17,61))
    results=[]
    for mode in range(5):
        scaler=P()
        try:
            call(factory,11,[C.POINTER(P)],C.byref(scaler))
            call(scaler,8,[P,U,U,U],frame,16,60,mode)
            pixels=(C.c_ubyte*(16*3*60))()
            call(scaler,7,[P,U,U,P],None,48,len(pixels),pixels)
            im=Image.frombytes('RGB',(16,60),bytes(pixels));im.save(output/f'WIC-{mode}.png')
            diff=[abs(a-b) for a,b in zip(im.getchannel('R').getdata(),native.getdata())]
            results.append({'mode':mode,'max':max(diff),'sum':sum(diff),'changed':sum(v!=0 for v in diff)})
        finally:release(scaler)
    (output/'comparison.json').write_text(json.dumps(results,indent=2));print(results)
finally:
    release(frame);release(decoder);release(factory);C.windll.ole32.CoUninitialize()
