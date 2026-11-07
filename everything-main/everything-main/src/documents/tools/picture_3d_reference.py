"""Independent native reference measurements for the pending 3D picture renderer."""
from pathlib import Path
import hashlib,json,sys
import pypdfium2 as pdf
ROOT=Path(__file__).resolve().parents[1];name=sys.argv[1] if len(sys.argv)>1 else 'picture-3d'
assert name in ['picture-3d','picture-3d-outlines','picture-lighting']
folder=ROOT/'tests/fixtures'/name
lines=json.loads((folder/'lines.json').read_text()) if (folder/'lines.json').exists() else None
cases=json.loads((folder/'cases.json').read_text());d=pdf.PdfDocument(folder/'native.pdf');assert len(d)==len(cases)
results=[]
for i,(name,camera,depth,contour,geom,w,h) in enumerate(cases):
 im=d[i].render(scale=4).to_pil().convert('RGB');px=im.load();rows=[]
 for dy in [-10,0,10,h/4,h/2,3*h/4,h-10,h,h+10]:
  y=round((140+dy)*4);xs=[x for x in range(60*4,round((140+w)*4)) if min(px[x,y])<240]
  rows.append(dict(y=y/4,interval=[min(xs)/4,(max(xs)+1)/4] if xs else None))
 samples=[]
 for dx,dy in [(w/4,h/4),(3*w/4,h/4),(w/4,3*h/4),(3*w/4,3*h/4)]:
  x=100+dx;y=140+dy;samples.append(dict(x=x,y=y,rgb=list(px[round(x*4),round(y*4)])))
 # Interior side-wall samples, away from antialiasing and quadrant boundaries.
 # These coordinates are selected from the native reference, not the renderer.
 side_samples=[]
 if geom=='rect' and depth and not contour:
  x=244 if camera=='perspectiveLeft' else 100
  for y in [140+h/4,140+3*h/4]:
   side_samples.append(dict(x=x,y=y,rgb=list(px[round(x*4),round(y*4)])))
 contour_samples=[]
 if contour:
  right=244 if camera=='orthographicFront' else 237.5
  left=100 if camera=='orthographicFront' else 101
  for x,y in [(172,140),(172,248),(left,194),(right,194)]:
   contour_samples.append(dict(x=x,y=y,rgb=list(px[round(x*4),round(y*4)])))
 outline=[]
 for y in range(120*4,round((160+h)*4),2):
  xs=[x for x in range(60*4,round((140+w)*4)) if min(px[x,y])<240]
  if xs:outline.extend([[min(xs)/4,y/4],[(max(xs)+1)/4,y/4]])
 for x in range(60*4,round((140+w)*4),2):
  ys=[y for y in range(120*4,round((160+h)*4)) if min(px[x,y])<240]
  if ys:outline.extend([[x/4,min(ys)/4],[x/4,(max(ys)+1)/4]])
 line_samples=[]
 if lines and lines[i].get('widthPt',0)>=4 and not lines[i].get('noFill'):
  x=100+w/2;y=140-lines[i]['widthPt']/2 if not depth and not contour else 140
  line_samples.append(dict(x=x,y=y,rgb=list(px[round(x*4),round(y*4)])))
 results.append(dict(name=name,camera=camera,extrusionPt=depth,contourPt=contour,geometry=geom,widthPt=w,heightPt=h,rows=rows,samples=samples,sideSamples=side_samples,contourSamples=contour_samples,outline=outline,outlineSamples=line_samples))
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((ROOT/'public/fixtures'/f'{folder.name}.docx').read_bytes()).hexdigest(),cases=results),indent=2)+'\n',encoding='utf-8')
