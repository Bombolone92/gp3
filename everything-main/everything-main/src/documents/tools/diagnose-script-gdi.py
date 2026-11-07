"""Read installed-font GDI recommendations; no font copying or registration."""
import ctypes as C
from ctypes import wintypes as W
import json,argparse
from pathlib import Path
class Point(C.Structure):
    _fields_=[('x',W.LONG),('y',W.LONG)]
class TM(C.Structure):
    _fields_=[(n,W.LONG) for n in ['height','ascent','descent','internalLeading','externalLeading','aveWidth','maxWidth','weight','overhang','aspectX','aspectY']]+[(n,W.WCHAR) for n in ['first','last','default','breakChar']]+[(n,W.BYTE) for n in ['italic','underlined','struckOut','pitch','charset']]
class OTM(C.Structure):
    _fields_=[('size',W.UINT),('tm',TM),('filler',W.BYTE),('panose',W.BYTE*10)]+[(n,W.UINT) for n in ['selection','type']]+[(n,W.INT) for n in ['slopeRise','slopeRun','italicAngle']]+[('em',W.UINT),('ascent',W.INT),('descent',W.INT),('lineGap',W.UINT),('capHeight',W.UINT),('xHeight',W.UINT),('box',W.RECT),('macAscent',W.INT),('macDescent',W.INT),('macLineGap',W.UINT),('minimumPPEM',W.UINT)]+[(n,Point) for n in ['subSize','subOffset','superSize','superOffset']]+[('strikeSize',W.UINT),('strikePosition',W.INT),('underscoreSize',W.INT),('underscorePosition',W.INT)]+[(n,C.c_void_p) for n in ['family','face','style','full']]
g=C.WinDLL('gdi32',use_last_error=True)
g.CreateCompatibleDC.argtypes=[W.HDC];g.CreateCompatibleDC.restype=W.HDC
g.CreateFontW.argtypes=[W.INT]*5+[W.DWORD]*8+[W.LPCWSTR];g.CreateFontW.restype=W.HFONT
g.SelectObject.argtypes=[W.HDC,W.HGDIOBJ];g.SelectObject.restype=W.HGDIOBJ
g.GetOutlineTextMetricsW.argtypes=[W.HDC,W.UINT,C.c_void_p];g.GetOutlineTextMetricsW.restype=W.UINT
g.GetTextFaceW.argtypes=[W.HDC,W.INT,W.LPWSTR]
g.DeleteObject.argtypes=[W.HGDIOBJ];g.DeleteDC.argtypes=[W.HDC]
rows=[];dc=g.CreateCompatibleDC(None)
try:
 for family in ['Garamond','Arial','Times New Roman']:
  for face in ['regular','bold','italic']:
   for dpi in [96,600]:
    for size in [8,10,11,12,16,20]:
     height=round(size*dpi/72)
     font=g.CreateFontW(-height,0,0,0,700 if face=='bold' else 400,face=='italic',0,0,1,0,0,0,0,family)
     if not font:raise C.WinError(C.get_last_error())
     old=g.SelectObject(dc,font)
     try:
      count=g.GetOutlineTextMetricsW(dc,0,None)
      if not count:raise C.WinError(C.get_last_error())
      buf=C.create_string_buffer(count);assert g.GetOutlineTextMetricsW(dc,count,buf)==count
      m=OTM.from_buffer(buf);name=C.create_unicode_buffer(128);g.GetTextFaceW(dc,128,name)
      assert name.value==family,(family,name.value)
      rows.append(dict(family=family,face=face,pointSize=size,dpi=dpi,pixelHeight=height,actualFamily=name.value,tmHeight=m.tm.height,tmInternalLeading=m.tm.internalLeading,em=m.em,**{n:[getattr(m,n).x,getattr(m,n).y] for n in ['subSize','subOffset','superSize','superOffset']}))
     finally:g.SelectObject(dc,old);g.DeleteObject(font)
finally:g.DeleteDC(dc)
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);args=parser.parse_args()
out=args.output;out.write_text(json.dumps(rows,indent=2)+'\n')
ref=json.loads((Path(__file__).resolve().parents[1]/'tests/fixtures/script-size/reference.json').read_text())
for family in ['Garamond','Arial','Times New Roman']:
 native=next(c for c in ref['cases'] if c['family']==family and c['face']=='regular')
 for dpi in [96,600]:
  selected=[r for r in rows if r['family']==family and r['face']=='regular' and r['dpi']==dpi]
  print(family,dpi,[(r['pointSize'],round(r['superSize'][1]*72/dpi,3),next(n['nativeSize'] for n in native['rows'] if n['size']==r['pointSize'] and n['script']=='superscript')) for r in selected])
print('Saved',len(rows),'rows to',out)
