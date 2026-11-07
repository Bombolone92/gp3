"""Measure complete native screen body bands, separately from outer table bounds.

Uses existing independently captured reference PNGs and their fixed authored control
regions. No browser image, fitted registration, new capture or renderer is used.
"""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/border-axis-phase'

def record():
    cases=json.loads((FOLDER/'cases.json').read_text());observations=[]
    for zoom,name in [(100,'screen-reference.json'),(200,'screen-reference-200.json')]:
        ref=json.loads((FOLDER/name).read_text());scale=zoom/100;offset=ref['cropOffset']
        for page in ref['observations']:
            capture=FOLDER/page['crop'];assert hashlib.sha256(capture.read_bytes()).hexdigest()==page['cropSha256']
            pixels=np.asarray(Image.open(capture).convert('RGB'));bands=[]
            for old in page['comparisons']:
                c=next(c for c in cases if c['page']==page['page'] and c['id']==old['id'])
                # Source-positioned interior cross-sections, away from all caps.
                sample_x=round((c['xTwips']+c['widthTwips']/2)/15*scale)
                sample_y=round((c['yTwips']+c['heightTwips']/2)/15*scale)
                x,y,w,h=old['region']
                for axis,region in [('h',[sample_x-4,y,8,h]),('v',[x,sample_y-4,w,8])]:
                    rx,ry,rw,rh=region
                    sample=pixels[ry-offset[1]:ry-offset[1]+rh,rx-offset[0]:rx-offset[0]+rw]
                    assert rx>=offset[0] and ry>=offset[1] and sample.shape==(rh,rw,3), 'Complete interior sample must lie inside the native crop'
                    profile=np.median(sample,axis=1 if axis=='h' else 0).astype(int)
                    ink=profile.max(axis=1)<128;runs=[];start=None
                    for at,active in enumerate([*ink,False]):
                        if active and start is None:start=at
                        if not active and start is not None:runs.append([start,at]);start=None
                    assert len(runs)==2, 'Two independently visible opposite body bands required'
                    base=ry if axis=='h' else rx
                    bands.append(dict(id=c['id'],borderSize=c['size'],axis=axis,region=region,
                        positions=[[a+base,b+base] for a,b in runs],widths=[b-a for a,b in runs]))
            observations.append(dict(zoom=zoom,page=page['page'],crop=page['crop'],cropSha256=page['cropSha256'],bands=bands))
    result=dict(sourceSha256=hashlib.sha256((FOLDER/'control.docx').read_bytes()).hexdigest(),
        scope='Native reference straight bodies only, measured from original neutral JPEG-derived PNGs at threshold 128. Source-positioned samples exclude caps. Positions retained; no fitted origins or viewer equivalence asserted.',observations=observations)
    (FOLDER/'screen-body-bands.json').write_text(json.dumps(result,indent=2)+'\n')
    for zoom in [100,200]:
        for size in [2,18]:
            for axis in ['h','v']:
                selected=[b for o in observations if o['zoom']==zoom for b in o['bands'] if b['borderSize']==size and b['axis']==axis]
                print(zoom,size,axis,'leading',sorted({b['widths'][0] for b in selected}),'trailing',sorted({b['widths'][1] for b in selected}))
    print('Recorded',sum(len(o['bands'])*2 for o in observations),'native straight-body bands')

if __name__=='__main__':record()
