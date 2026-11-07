"""Bind native JPEG observations and compare fixed, non-overlapping stroke regions."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from PIL import Image,JpegImagePlugin
import numpy as np,json,sys
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/outline-stroke-holdouts';work=Path(sys.argv[1])
digest=lambda p:sha256(p.read_bytes()).hexdigest()
ref=dict(baseline='bd0a22c6',date='2026-09-30',scope='Native JPEG screen observations, fixed page-edge origins; diagnostic errors are not exact antialias or opacity assertions.',sources={},observations=[])
for name in ['rotation-alpha','dash-compound','alpha-only']:
 source=OUT/(name+'.docx');native=work/('outline-'+name+'.docx')
 with ZipFile(source) as a,ZipFile(native) as b:
  assert set(a.namelist())==set(b.namelist()) and all(a.read(n)==b.read(n) for n in a.namelist())
  ref['sources'][name]=dict(sha256=digest(source),parts={n:sha256(a.read(n)).hexdigest() for n in a.namelist()})
 for zoom in [100,200]:
  file=work/f'stroke-{name}-{zoom}.jpg';raw=Image.open(file);assert raw.format=='JPEG';assert raw.size==(1280,752), 'Reobserve page origins for a changed viewport'
  ox,oy=(439,326) if zoom==100 else (247,212);scale=zoom//100
  crop=raw.crop((ox,oy,ox+384*scale,oy+256*scale));pixels=np.array(crop.convert('RGB'));regions=[]
  for i in range(8):
   row,col=divmod(i,4);x=(16+col*88)*scale;y=(8+row*88)*scale;w=88*scale;h=80*scale
   area=pixels[y:y+h,x:x+w];assert area.shape==(h,w,3)
   assert np.all(area[:,:,0]==area[:,:,1]) and np.all(area[:,:,1]==area[:,:,2]),(name,zoom,i,'colored overlay')
   regions.append([x,y,w,h])
  target=OUT/f'native-{name}-{zoom}.png';crop.save(target)
  ref['observations'].append(dict(fixture=name,zoom=zoom,origin=[ox,oy],sourceSha256=digest(file),sourceFormat=raw.format,sourceSize=raw.size,jpegSubsampling=JpegImagePlugin.get_sampling(raw),jpegQuantization=raw.quantization,crop=target.name,cropSha256=digest(target),regions=regions))
(OUT/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
if len(sys.argv)>2:
 candidate=Path(sys.argv[2]);results=json.loads((candidate/'results.json').read_text());comparisons=[]
 for observation in ref['observations']:
  name=observation['fixture'];zoom=observation['zoom'];native=np.array(Image.open(OUT/observation['crop']).convert('RGB'))[:,:,0].astype(float)
  for mode in ['baseline','adaptive','dash']:
   file=candidate/f'{name}-{mode}-{zoom}.png';app=np.array(Image.open(file).convert('RGB'))[:,:,0].astype(float);assert app.shape==native.shape
   errors=[float(np.abs(native[y:y+h,x:x+w]-app[y:y+h,x:x+w]).mean()) for x,y,w,h in observation['regions']]
   comparisons.append(dict(fixture=name,zoom=zoom,mode=mode,sha256=digest(file),unsupportedShapeIds=[7] if name=='dash-compound' else [],perShapeMeanAbsoluteRedError=errors))
 data=dict(baseline='bd0a22c6',scope=ref['scope'],browser=results,comparisons=comparisons)
 (ROOT/'docs/evidence/outline-stroke-holdouts-2026-09-30.json').write_text(json.dumps(data,indent=2)+'\n')
print('Bound 3 native packages and 48 neutral stroke regions across 6 JPEG captures.')
