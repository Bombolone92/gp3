"""Reproduce original glyph geometry references with Windows GetGlyphOutlineW.

Generated test fonts use only independently drawn outlines, with metadata
headers from bundled Source Sans Pro (SIL OFL 1.1). Renamed font files remain
in a temporary directory; FR_PRIVATE registration is confined to this process.
No application font files or extracted proprietary outlines are published.
"""
from pathlib import Path
import struct as s
import struct
import math
import json
import ctypes as C
from ctypes import wintypes as W
from tempfile import TemporaryDirectory
import platform

def create_controls(directory, shapes=None, family_prefix='Bevel Geometry Probe', normalize_metrics=False):
    repo=Path(__file__).resolve().parents[1];source=(repo/'public/fonts/SourceSansPro-Regular.ttf').read_bytes();ts={}
    for i in range(s.unpack_from('>H',source,4)[0]):
     tag,_,off,n=s.unpack_from('>4sIII',source,12+i*16);ts[tag]=source[off:off+n]
    # Independently drawn rectangle, concave polygon and quadratic ring.
    if shapes is None:
     shapes=[ [[(80,0,1),(520,0,1),(520,700,1),(80,700,1)]], [[(80,0,1),(480,0,1),(480,300,1),(300,300,1),(300,700,1),(80,700,1)]], [[(100,350,1),(100,0,0),(500,0,1),(900,0,0),(900,350,1),(900,700,0),(500,700,1),(100,700,0)],[(300,350,1),(300,530,0),(500,530,1),(700,530,0),(700,350,1),(700,170,0),(500,170,1),(300,170,0)]] ]
     shapes.extend([ [[(80,0,1),(920,0,1),(500,800,1)],[(390,250,1),(500,530,1),(610,250,1)]], [[(100,350,1),(100,0,0),(300,0,0),(500,0,1),(900,0,0),(900,350,1),(900,700,0),(500,700,1),(100,700,0)]] ])
    shapes=[[list(contour) for contour in glyph] for glyph in shapes]
    # TrueType requires the filled region to the right in its upward-y coordinates.
    for glyph in shapes:
     for i,contour in enumerate(glyph):
      points=list(reversed(contour));start=next(j for j,p in enumerate(points) if p[2]);glyph[i]=points[start:]+points[:start]
    def checksum(b):
     b+=b'\0'*((-len(b))%4);return sum(s.unpack('>'+str(len(b)//4)+'I',b))&0xffffffff
    for upem in [1000,2048]:
     name=f'{family_prefix} {upem}';t={k:bytearray(ts[k]) for k in [b'head',b'hhea',b'maxp',b'OS/2']};glyphs=[b''];coords=[]
     for contours in shapes:
      cs=[[(round(x*upem/1000),round(y*upem/1000),on) for x,y,on in c] for c in contours];p=[p for c in cs for p in c];coords.append(cs);ends=[];n=0
      for c in cs:n+=len(c);ends.append(n-1)
      g=s.pack('>5h',len(cs),min(x for x,y,on in p),min(y for x,y,on in p),max(x for x,y,on in p),max(y for x,y,on in p))+s.pack('>'+str(len(ends))+'H',*ends)+s.pack('>H',0)+bytes(on for x,y,on in p)
      for axis in [0,1]:
       prev=0
       for v in p:g+=s.pack('>h',v[axis]-prev);prev=v[axis]
      glyphs.append(g+b'\0'*((-len(g))%4))
     loc=[0]
     for g in glyphs:loc.append(loc[-1]+len(g))
     t[b'glyf']=b''.join(glyphs);t[b'loca']=s.pack('>'+str(len(loc))+'I',*loc);s.pack_into('>I',t[b'head'],8,0);s.pack_into('>H',t[b'head'],18,upem);s.pack_into('>h',t[b'head'],50,1);s.pack_into('>H',t[b'maxp'],4,len(glyphs));s.pack_into('>H',t[b'hhea'],34,len(glyphs))
     points=[p for glyph in coords for contour in glyph for p in contour]
     s.pack_into('>4h',t[b'head'],36,min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points))
     s.pack_into('>3h',t[b'hhea'],4,upem,0,0);s.pack_into('>H',t[b'hhea'],10,upem)
     if normalize_metrics:
      # The reference text-effect surface uses Windows ascent/descent for clipping.
      # The inherited 1000-unit headers must match a generated 2048-unit font.
      s.pack_into('>3h',t[b'OS/2'],68,upem,0,0)
      s.pack_into('>2H',t[b'OS/2'],74,upem,0)
     t[b'hmtx']=b''.join(s.pack('>Hh',upem,x) for x in [0]+[min(p[0] for c in glyph for p in c) for glyph in coords]);t[b'post']=s.pack('>I',0x30000)+b'\0'*28
     # Windows Unicode format 4: consecutive letters starting at A.
     fmt=s.pack('>7H',4,32,0,4,4,1,0)+s.pack('>2H',64+len(shapes),65535)+s.pack('>H',0)+s.pack('>2H',65,65535)+s.pack('>2h',-64,1)+s.pack('>2H',0,0)
     t[b'cmap']=s.pack('>HHHHI',0,1,3,1,12)+fmt
     data=b'';records=[]
     for key,value in [(0,'Headers derived from Source Sans Pro; SIL Open Font License 1.1. Outlines independently authored.'),(1,name),(2,'Regular'),(3,name.replace(' ','')),(4,name),(6,name.replace(' ','')),(16,name),(17,'Regular')]:
      b=value.encode('utf-16-be');records.append(s.pack('>6H',3,1,0x409,key,len(b),len(data)));data+=b
     t[b'name']=s.pack('>3H',0,len(records),6+12*len(records))+b''.join(records)+data
     entries=sorted(t.items());n=len(entries);pow=int(math.log2(n));off=12+16*n;records=[];data=b'';head=0
     for tag,b in entries:
      b=bytes(b);records.append(s.pack('>4sIII',tag,checksum(b),off,len(b)))
      if tag==b'head':head=off
      padded=b+b'\0'*((-len(b))%4);data+=padded;off+=len(padded)
     b=bytearray(s.pack('>I4H',0x10000,n,16*2**pow,pow,n*16-16*2**pow)+b''.join(records)+data);s.pack_into('>I',b,head+8,(0xb1b0afba-checksum(b))&0xffffffff)
     (directory/f'bevel-geometry-probe-{upem}.ttf').write_bytes(b);(directory/f'bevel-geometry-probe-{upem}.json').write_text(json.dumps(coords))


def capture(directory,upem):
    G=C.WinDLL('gdi32',use_last_error=True)
    fontpath=str((directory/f'bevel-geometry-probe-{upem}.ttf').resolve());G.AddFontResourceExW.argtypes=[W.LPCWSTR,W.DWORD,C.c_void_p];assert G.AddFontResourceExW(fontpath,16,None)
    class POINT(C.Structure):_fields_=[('x',C.c_long),('y',C.c_long)]
    class METRICS(C.Structure):_fields_=[('width',W.UINT),('height',W.UINT),('origin',POINT),('advanceX',C.c_short),('advanceY',C.c_short)]
    G.CreateCompatibleDC.argtypes=[W.HDC];G.CreateCompatibleDC.restype=W.HDC
    G.CreateFontW.argtypes=[C.c_int]*5+[W.DWORD]*8+[W.LPCWSTR];G.CreateFontW.restype=W.HFONT
    G.SelectObject.argtypes=[W.HDC,W.HGDIOBJ];G.SelectObject.restype=W.HGDIOBJ
    G.GetGlyphOutlineW.argtypes=[W.HDC,W.UINT,W.UINT,C.POINTER(METRICS),W.DWORD,C.c_void_p,C.c_void_p];G.GetGlyphOutlineW.restype=W.DWORD
    G.DeleteObject.argtypes=[W.HGDIOBJ];G.DeleteDC.argtypes=[W.HDC]
    mat=C.create_string_buffer(struct.pack('<hhhhhhhh',0,1,0,0,0,0,0,1));dc=G.CreateCompatibleDC(None);cases=[]
    for bold in [False,True]:
     font=G.CreateFontW(-upem,0,0,0,700 if bold else 400,0,0,0,1,0,0,0,0,f'Bevel Geometry Probe {upem}');old=G.SelectObject(dc,font);glyphs=[]
     for ch in 'ABCDE':
      metrics=METRICS();length=G.GetGlyphOutlineW(dc,ord(ch),258,C.byref(metrics),0,None,mat);assert length!=0xffffffff,C.get_last_error();buf=C.create_string_buffer(length);G.GetGlyphOutlineW(dc,ord(ch),258,C.byref(metrics),length,buf,mat);b=buf.raw;commands=[];pos=0
      def point(pos):
       fx,x,fy,y=struct.unpack_from('<HhHh',b,pos);return (x+fx/65536,-(y+fy/65536))
      while pos<len(b):
       size,typ=struct.unpack_from('<II',b,pos);end=pos+size;x,y=point(pos+8);commands.append({'type':'M','x':x,'y':y});pos+=16
       while pos<end:
        typ,n=struct.unpack_from('<HH',b,pos);pos+=4;pts=[point(pos+j*8) for j in range(n)];pos+=n*8
        if typ==1:
         commands.extend({'type':'L','x':x,'y':y} for x,y in pts)
        elif typ==2:
         for j in range(n-1):
          q=pts[j];e=pts[j+1] if j==n-2 else tuple((a+b)/2 for a,b in zip(q,pts[j+1]));commands.append({'type':'Q','x1':q[0],'y1':q[1],'x':e[0],'y':e[1]})
        else:raise Exception(typ)
       commands.append({'type':'Z'})
      glyphs.append({'char':ch,'metrics':[metrics.width,metrics.height,metrics.origin.x,metrics.origin.y,metrics.advanceX],'commands':commands})
     G.SelectObject(dc,old);G.DeleteObject(font);cases.append({'bold':bold,'glyphs':glyphs})
    G.DeleteDC(dc)
    G.RemoveFontResourceExW.argtypes=[W.LPCWSTR,W.DWORD,C.c_void_p]
    assert G.RemoveFontResourceExW(fontpath,16,None)
    return cases


def record(directory):
    records=[]
    for upem in [1000,2048]:
     source=json.loads((directory/f'bevel-geometry-probe-{upem}.json').read_text());native=capture(directory,upem)
     for contours,g in zip(source,native[1]['glyphs']):
      expanded=[];c=[]
      for v in g['commands']:
       if v['type']=='Z':
        if c[-1]['x']==c[0]['x'] and c[-1]['y']==c[0]['y']:c.pop()
        expanded.append(c);c=[]
       elif v['type']=='Q':c.extend([{'x':v['x1'],'y':v['y1'],'onCurve':False},{'x':v['x'],'y':v['y'],'onCurve':True}])
       else:c.append({'x':v['x'],'y':v['y'],'onCurve':True})
      expected=[]
      for original,nativepoints in zip(contours,expanded):
       current=[];j=0
       for x,y,on in original:
        if not on and nativepoints[j]['onCurve']:j+=1
        assert nativepoints[j]['onCurve']==bool(on);current.append(nativepoints[j]);j+=1
       expected.append(current)
      records.append({'unitsPerEm':upem,'name':{'A':'rectangle','B':'concave step','C':'quadratic ring','D':'triangle with hole','E':'implied curve midpoint'}[g['char']],'input':[[{'x':x,'y':-y,'onCurve':bool(on)} for x,y,on in c] for c in contours],'expected':expected})
    return records

if __name__ == '__main__':
    with TemporaryDirectory(prefix='text-bevel-reference-') as folder:
        directory = Path(folder)
        create_controls(directory)
        reference = {'api': 'GetGlyphOutlineW(GGO_NATIVE | GGO_UNHINTED)',
                     'windowsVersion': platform.version(), 'records': record(directory)}
    target = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-3d/outline-reference.json'
    target.write_text(json.dumps(reference, indent=2)+'\n', encoding='utf-8')
    print('Recorded', len(reference['records']), 'original glyph controls:', target)
