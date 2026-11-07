"""Measure Windows native HLS conversion against independent reference colors. Windows only."""
import sys,ctypes,json,math
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
from importlib import import_module
rows=import_module('check-theme-conversion-stages').read_cases()
lib=ctypes.WinDLL('shlwapi');lib.ColorRGBToHLS.argtypes=[ctypes.c_uint32,*([ctypes.POINTER(ctypes.c_ushort)]*3)];lib.ColorRGBToHLS.restype=None
lib.ColorHLSToRGB.argtypes=[ctypes.c_ushort]*3;lib.ColorHLSToRGB.restype=ctypes.c_uint32
for color,light in [(0,0),(0xffffff,240),(0x0000ff,120)]:
 h,l,s=[ctypes.c_ushort() for _ in range(3)]
 lib.ColorRGBToHLS(color,ctypes.byref(h),ctypes.byref(l),ctypes.byref(s))
 assert l.value==light and lib.ColorHLSToRGB(h.value,l.value,s.value)==color
records=[]
for rgb,mode,value,native in rows:
 h,l,s=[ctypes.c_ushort() for _ in range(3)];lib.ColorRGBToHLS(rgb[0]|rgb[1]<<8|rgb[2]<<16,ctypes.byref(h),ctypes.byref(l),ctypes.byref(s))
 results={}
 for rounding in ['floor','nearest']:
  n=l.value*value/255 if mode=='shade' else 240-(240-l.value)*value/255
  light=math.floor(n+(.5 if rounding=='nearest' else 0));color=lib.ColorHLSToRGB(h.value,light,s.value)
  results[rounding]=[color&255,(color>>8)&255,(color>>16)&255]
 records.append(dict(rgb=rgb,mode=mode,value=value,native=native,hls=[h.value,l.value,s.value],results=results))
summary={k:sum(r['results'][k]==r['native'] for r in records) for k in ['floor','nearest']}
result=dict(cases=len(records),matches=summary,scope='Windows shlwapi HLS with transformed integer lightness at scale 240; not an implementation of any application internals.')
if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(dict(**result,records=records),indent=2)+'\n')
print(json.dumps(result,indent=2))
