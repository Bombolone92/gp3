"""Original overlapping-edge reference controls. Requires the installed reference application and a running app.

Temporary fonts use original outlines and OFL-1.1 Source Sans Pro metadata.
Fonts are unregistered in finally and deleted; no font binary is shipped.
"""
from pathlib import Path
import sys,ctypes as C,subprocess
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
repo=Path(__file__).resolve().parents[1];sys.path.insert(0,str(repo/'tools'))
from record_text_bevel_geometry import create_controls
import argparse
from tempfile import TemporaryDirectory
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=repo/'tests/fixtures/text-3d-overlap');parser.add_argument('--url',default='http://127.0.0.1:5173/playground.html');args=parser.parse_args()
p=args.output.resolve();p.mkdir(parents=True,exist_ok=True)

shapes=[ [[(100,0,1),(900,0,1),(900,800,1),(600,800,1),(600,500,1),(600-d,502,1),(602,520,1),(400,520,1),(400,800,1),(100,800,1)]] for d in [0,1,2,4,8] ]
with TemporaryDirectory(prefix='overlap-bevel-native-') as temporary:
 fontdir=Path(temporary)
 create_controls(fontdir,shapes+[[[(100,0,1),(700,0,1),(700,800,1),(100,800,1)]]]*(126-65+1-len(shapes)),'Overlap Bevel Probe');W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
 with ZipFile(repo/'tests/fixtures/text-3d/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 doc=E.fromstring(parts['word/document.xml']);body=doc.find('{'+W+'}body');old=list(body);section=deepcopy(old[-1]);body.clear()
 for i in range(5):
  block=[deepcopy(x) for x in old[15:18]];block[0].find('.//{'+W+'}t').text='Original overlap bevel '+str([0,1,2,4,8][i])
  if i==0:
   node=block[0].find('.//{'+W+'}pageBreakBefore');node.getparent().remove(node)
  rp=block[1].find('.//{'+W+'}rPr');rp.insert(0,E.Element('{'+W+'}rFonts',{'{'+W+'}ascii':'Overlap Bevel Probe 1000','{'+W+'}hAnsi':'Overlap Bevel Probe 1000'}));rp.find('{'+W+'}b').set('{'+W+'}val','0');rp.find('{'+W+'}sz').set('{'+W+'}val','650');block[1].find('.//{'+W+'}t').text=chr(65+i);body.extend(block)
 body.append(section);parts['word/document.xml']=E.tostring(doc)
 with ZipFile(p/'control.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
 font=fontdir/'bevel-geometry-probe-1000.ttf';gdi=C.WinDLL('gdi32');gdi.AddFontResourceExW.argtypes=[C.c_wchar_p,C.c_uint,C.c_void_p];gdi.RemoveFontResourceExW.argtypes=gdi.AddFontResourceExW.argtypes
 assert gdi.AddFontResourceExW(str(font),0,None)
 try:
  subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(repo/'tools/export-reference.ps1'),'-SourceFullPath',str(p/'control.docx'),'-OutputPdf',str(p/'native.pdf')],check=True)
  subprocess.run(['node',str(repo/'tools/capture-text3d-shallow-joins.mjs'),str(p),args.url,'Overlap Bevel Probe 1000'],check=True)
 finally:assert gdi.RemoveFontResourceExW(str(font),0,None)
