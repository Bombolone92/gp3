from pathlib import Path
from PIL import Image
import json,hashlib,sys
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/svg-external-backdrop'
ref=json.loads((folder/'native-colors.json').read_text(encoding='utf-8-sig'))
backgrounds=['FFFFFF','F2F2F2','808080','202020']
images=[]
for bg in backgrounds:
 p=folder/(bg+'.png');assert hashlib.sha256(p.read_bytes()).hexdigest()==ref['hashes'][p.name]
 im=Image.open(p).convert('RGBA');assert im.size==(1200,900)
 images.append(list(im.get_flattened_data() if hasattr(im,'get_flattened_data') else im.getdata()))
tuples={}
for i,colors in enumerate(zip(*images)):
 assert all(c[3]==255 for c in colors)
 key=tuple(c[:3] for c in colors)
 if key not in tuples:tuples[key]={'pixels':0,'first':[i%1200,i//1200],'bounds':[i%1200,i//1200,i%1200,i//1200]}
 r=tuples[key];r['pixels']+=1;r['bounds'][0]=min(r['bounds'][0],i%1200);r['bounds'][1]=min(r['bounds'][1],i//1200);r['bounds'][2]=max(r['bounds'][2],i%1200);r['bounds'][3]=max(r['bounds'][3],i//1200)
rgb=[[int(bg[k:k+2],16) for k in (0,2,4)] for bg in backgrounds]
rows=[]
for colors,location in tuples.items():
 solutions=[]
 for alpha in range(256):
  channels=[[colors[b][c]-(rgb[b][c]*(255-alpha)+127)//255 for b in range(4)] for c in range(3)]
  if all(all(v==values[0] for v in values) and 0<=values[0]<=alpha for values in channels):solutions.append({'alpha':alpha,'premultiplied':[v[0] for v in channels]})
 rows.append({'colors':colors,**location,'solutions':solutions})
out={'hashes':{k:ref['hashes'][k+'.png'] for k in backgrounds},'width':1200,'height':900,'tuples':rows}
Path(sys.argv[1] if len(sys.argv)>1 else '.private-svg-edge-inverse.json').write_text(json.dumps(out,indent=2)+'\n')
bad=[r for r in rows if not r['solutions']]
print(json.dumps({'uniqueTuples':len(rows),'nonRepresentableTuples':len(bad),'nonRepresentablePixels':sum(r['pixels'] for r in bad),'examples':bad[:5]},indent=2))
