"""Original DrawingML tile controls, constructed directly in an OPC package."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import struct,zlib,json,sys
from io import BytesIO
from PIL import Image
from canvas_group_fixture import NS,tag,add
ROOT=Path(__file__).resolve().parents[1]
A14='http://schemas.microsoft.com/office/drawing/2010/main'
CASES=[dict(name='Default tile'),dict(name='Scale',tile=dict(sx='50000',sy='150000')),dict(name='Signed offset',tile=dict(tx='127000',ty='-190500')),dict(name='Center',tile=dict(algn='ctr')),dict(name='Bottom right',tile=dict(algn='br')),dict(name='Flip X',tile=dict(flip='x')),dict(name='Flip Y',tile=dict(flip='y')),dict(name='Flip XY',tile=dict(flip='xy')),dict(name='Source inset',crop=dict(l='25000',t='25000')),dict(name='Source outset',crop=dict(l='-25000',t='-25000')),dict(name='Explicit DPI',dpi=144),dict(name='Embedded DPI',embedded=144),dict(name='Local DPI true',embedded=144,local='1'),dict(name='Local DPI false',embedded=144,local='0'),dict(name='Local DPI default',embedded=144,local=''),dict(name='Explicit DPI with local',embedded=144,local='1',dpi=72),dict(name='Source inset and scaled flip',crop=dict(l='25000'),tile=dict(sx='50000',flip='xy',algn='br')),dict(name='Negative scale',tile=dict(sx='-100000')),dict(name='Polygon',custom=True)]
EXTRA_CASES = [dict(name='JPEG JFIF DPI',media='jfif'),dict(name='JPEG EXIF DPI',media='exif'),dict(name='JPEG conflicting DPI',media='conflict'),dict(name='Anisotropic PNG DPI',media='anisotropic')]
REFERENCE='--reference' in sys.argv
if not REFERENCE:CASES += EXTRA_CASES
with ZipFile(ROOT/'public/fixtures/shape-picture-fills.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'));base=deepcopy(body.find('.//'+tag('w:drawing')));sect=deepcopy(body.find(tag('w:sectPr')));body.clear()
rels=E.fromstring(parts['word/_rels/document.xml.rels']);relbase=next(x for x in rels if x.get('Type').endswith('/image'));rid=relbase.get('Id');original=parts['word/'+relbase.get('Target')]
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
parts['word/media/tile-144.png']=original[:33]+chunk(b'pHYs',struct.pack('>IIB',5669,5669,1))+original[33:]
rel=deepcopy(relbase);rel.set('Id','tile144');rel.set('Target','media/tile-144.png');rels.append(rel)
for name in ([] if REFERENCE else ['jfif','exif','conflict','anisotropic']):
 if name=='anisotropic':data=original[:33]+chunk(b'pHYs',struct.pack('>IIB',5669,2835,1))+original[33:];ext='png'
 else:
  im=Image.open(BytesIO(original));out=BytesIO();exif=Image.Exif()
  if name!='jfif':exif[282]=144;exif[283]=144;exif[296]=2
  kwargs=dict(dpi=(144,144)) if name=='jfif' else dict(exif=exif) if name=='exif' else dict(dpi=(72,72),exif=exif)
  im.save(out,format='JPEG',quality=100,subsampling=0,**kwargs);data=out.getvalue();ext='jpeg'
 filename=f'media/tile-{name}.{ext}';parts['word/'+filename]=data;rel=deepcopy(relbase);rel.set('Id',name);rel.set('Target',filename);rels.append(rel)
# The original package already declares image/jpeg.
for i,case in enumerate(CASES):
 p=add(body,'w:p');pr=add(p,'w:pPr')
 if i:add(pr,'w:pageBreakBefore')
 add(add(p,'w:r'),'w:t',text=case['name'])
 drawing=deepcopy(base);frame=drawing[0];frame.tag=tag('wp:anchor')
 for k,v in dict(simplePos='0',relativeHeight=str(i),behindDoc='0',locked='0',layoutInCell='1',allowOverlap='1',distT='0',distB='0',distL='0',distR='0').items():frame.set(k,v)
 nodes=[];n=E.Element(tag('wp:simplePos'),x='0',y='0');nodes.append(n)
 for axis,value in [('H',457200),('V',1143000)]:n=E.Element(tag('wp:position'+axis),relativeFrom='page');add(n,'wp:posOffset',text=str(value));nodes.append(n)
 for j,n in enumerate(nodes):frame.insert(j,n)
 frame.insert(frame.index(frame.find(tag('wp:extent')))+1,E.Element(tag('wp:wrapNone')))
 frame.find(tag('wp:docPr')).set('id',str(i+1));fill=frame.find('.//'+tag('a:blipFill'));fill.set('dpi',str(case.get('dpi',0)))
 fill.find(tag('a:stretch')).getparent().remove(fill.find(tag('a:stretch')));fill.find(tag('a:srcRect')).attrib.update(case.get('crop',{}));add(fill,'a:tile',**case.get('tile',{}))
 blip=fill.find(tag('a:blip'))
 if case.get('embedded'):blip.set(tag('r:embed'),'tile144')
 if case.get('media'):blip.set(tag('r:embed'),case['media'])
 if 'local' in case:
  ext=add(add(blip,'a:extLst'),'a:ext',uri='{28A0092B-C50C-407E-A947-70E740481C1C}');n=E.SubElement(ext,'{'+A14+'}useLocalDpi',nsmap={'a14':A14})
  if case['local']:n.set('val',case['local'])
 if case.get('custom'):
  props=frame.find('.//'+tag('wps:spPr'));props.remove(props.find(tag('a:prstGeom')))
  geom=E.Element(tag('a:custGeom'));props.insert(1,geom)
  for name in ['avLst','gdLst','ahLst','cxnLst']:add(geom,'a:'+name)
  add(geom,'a:rect',l='l',t='t',r='r',b='b');path=add(add(geom,'a:pathLst'),'a:path',w=100,h=100)
  for op,x,y in [('moveTo',0,0),('lnTo',100,0),('lnTo',40,100),('lnTo',0,100)]:add(add(path,'a:'+op),'a:pt',x=x,y=y)
  add(path,'a:close')
 add(p,'w:r').append(drawing)
body.append(sect);parts['word/document.xml']=E.tostring(r);parts['word/_rels/document.xml.rels']=E.tostring(rels)
with ZipFile(ROOT/'public/fixtures'/('shape-picture-tiles-reference.docx' if REFERENCE else 'shape-picture-tiles-extended.docx'),'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
folder=ROOT/'tests/fixtures/picture-tiles';folder.mkdir(exist_ok=True);(folder/('reference-cases.json' if REFERENCE else 'cases.json')).write_text(json.dumps(CASES,indent=2)+'\n')
