"""Original fork outlines probing the native bevel smoothing boundary and weighting.

Font metadata is derived from bundled OFL-1.1 Source Sans Pro. Only original
outlines are used; temporary fonts are unregistered and deleted after export.
Pass --record on Windows to refresh the native reference PDF and sampled colors.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import ctypes as C
import hashlib, json, math, subprocess, sys
from lxml import etree as E
from record_text_bevel_geometry import create_controls

REPO=Path(__file__).resolve().parents[1]
ROOT=REPO/'tests/fixtures/text-3d'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
FAMILY='Bevel Smoothing Probe'
cases=[dict(name=f'angle {dx}/400',arm=400,dx=dx) for dx in [220,228,231,235,242]]
cases += [dict(name=f'arm length {arm}',arm=arm,dx=round(.55*arm)) for arm in [200,300,400,500,600]]
shapes=[]
for case in cases:
 dx,arm=case['dx'],case['arm']
 shapes.append([[(400,0,1),(600,0,1),(600,400,1),(600+dx,400+arm,1),
  (480+dx,400+arm,1),(500,540,1),(520-dx,400+arm,1),(400-dx,400+arm,1),(400,400,1)]])
 case['angleDegrees']=math.degrees(math.atan(dx/arm))
with ZipFile(ROOT/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('{'+W+'}body')
original=list(body);section=deepcopy(original[-1]);body.clear()
for index,case in enumerate(cases):
 block=[deepcopy(p) for p in original[15:18]]
 block[0].find('.//{'+W+'}t').text=case['name']
 if not index:
  pb=block[0].find('.//{'+W+'}pageBreakBefore');pb.getparent().remove(pb)
 rp=block[1].find('.//{'+W+'}rPr')
 rp.insert(0,E.Element('{'+W+'}rFonts',{'{'+W+'}ascii':FAMILY+' 1000','{'+W+'}hAnsi':FAMILY+' 1000'}))
 rp.find('{'+W+'}b').set('{'+W+'}val','0');rp.find('{'+W+'}sz').set('{'+W+'}val','650')
 block[1].find('.//{'+W+'}t').text=chr(65+index);body.extend(block)
body.append(section);parts['word/document.xml']=E.tostring(doc)
target=ROOT/'bevel-smoothing.docx';pdf=ROOT/'bevel-smoothing-native.pdf'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
with TemporaryDirectory(prefix='text-bevel-smoothing-') as name:
 folder=Path(name);create_controls(folder,shapes,FAMILY)
 outlines=json.loads((folder/'bevel-geometry-probe-1000.json').read_text())
 for case,contours in zip(cases,outlines):
  case['contour']=[dict(x=x,y=-y) for x,y,on in contours[0]]
 if '--record' in sys.argv:
  font=folder/'bevel-geometry-probe-1000.ttf'
  gdi=C.WinDLL('gdi32');gdi.AddFontResourceExW.argtypes=[C.c_wchar_p,C.c_uint,C.c_void_p]
  gdi.RemoveFontResourceExW.argtypes=gdi.AddFontResourceExW.argtypes
  assert gdi.AddFontResourceExW(str(font),0,None)
  try:
   subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(REPO/'tools/export-reference.ps1'),'-SourceFullPath',str(target),'-OutputPdf',str(pdf)],check=True)
  finally:assert gdi.RemoveFontResourceExW(str(font),0,None)
  import numpy as np
  import pypdfium2 as pdfium
  native=pdfium.PdfDocument(str(pdf));assert len(native)==len(cases)
  for index,case in enumerate(cases):
   pixels=np.asarray(native[index].render(scale=4).to_pil().convert('RGB'))
   mask=(pixels[:,:,0]>100)&(pixels[:,:,1]<100)&(pixels[:,:,2]<120)
   ys,xs=np.where(mask);bottom=ys.max()/4
   # Ensure the native export used the original outline, not a substitute letter font.
   assert abs((ys.max()-ys.min())/4-(400+case['arm'])*.325)<1
   assert abs((xs.max()-xs.min())/4-(200+2*case['dx'])*.325)<1
   case['samples']=[]
   for fraction in [.05,.25,.5,.75,.95]:
    y=bottom-130+130*fraction;row=pixels[round(y*4)]
    red=np.where((row[:,0]>100)&(row[:,1]<100)&(row[:,2]<120))[0];x=int(red.min()+8)
    case['samples'].append(dict(t=1-fraction,xPt=x/4,yPt=y,rgb=pixels[round(y*4),x].tolist()))
  reference=dict(sourceSha256=hashlib.sha256(target.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),records=cases)
  (ROOT/'bevel-smoothing-reference.json').write_text(json.dumps(reference,indent=2)+'\n')
  native.close()
