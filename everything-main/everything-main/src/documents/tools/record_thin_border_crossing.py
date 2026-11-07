"""Measure original native thin crossing captures; no fitted viewer origin."""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def record(capture,folder):
    source=folder/'control.docx';owned=capture/'thin-border-crossing-native-20261003.docx'
    assert source.read_bytes()==owned.read_bytes(), 'Owned native source changed'
    cases=json.loads((folder/'cases.json').read_text());observations=[]
    # Paper outline observed directly in the same selected reference window.
    for zoom,origin in [(100,[439,260]),(200,[247,116])]:
        raw=capture/f'thin-crossing-screen-{zoom}.jpg';image=Image.open(raw).convert('RGB');scale=zoom/100
        assert image.size==(1280,752)
        for x,y in [(origin[0]+20,origin[1]),(origin[0],origin[1]+20)]:
            rgb=image.getpixel((x,y));assert max(rgb)-min(rgb)<=3 and 160<=min(rgb)<=220
        size=[round(384*scale),round(288*scale)];name=f'native-{zoom}.png'
        image.crop((*origin,origin[0]+size[0],origin[1]+size[1])).save(folder/name)
        pixels=np.asarray(Image.open(folder/name).convert('RGB')).astype(int);rows=[]
        for c in cases:
            bx=int((c['xTwips']/15+48)*scale)-4;by=int((c['yTwips']/15+24)*scale)-4
            xs=int((c['xTwips']/15+12)*scale);ys=int((c['yTwips']/15+12)*scale)
            regions=dict(vertical=[bx,ys,9,8],horizontal=[xs,by,8,9]);positions={}
            for axis,(x,y,w,h) in regions.items():
                sample=pixels[y:y+h,x:x+w];assert sample.shape==(h,w,3)
                profile=np.median(sample,axis=0 if axis=='vertical' else 1)
                ink=np.flatnonzero(profile@np.array([.299,.587,.114])<166)
                assert len(ink)==1, 'Each independent body is one pixel'
                base=x if axis=='vertical' else y;positions[axis]=[int(base+ink[0]),int(base+ink[0]+1)]
            x=positions['vertical'][0];y=positions['horizontal'][0];rgb=pixels[y,x].tolist()
            owner='vertical' if rgb[0]>rgb[2] else 'horizontal'
            assert owner==('vertical' if c['verticalSize']>c['horizontalSize'] else 'horizontal')
            rows.append(dict(id=c['id'],regions=regions,positions=positions,crossing=[x,y],rgb=rgb,owner=owner))
        observations.append(dict(zoom=zoom,origin=origin,crop=name,cropSize=size,cropSha256=sha(folder/name),rawSha256=sha(raw),rows=rows))
    result=dict(sourceSha256=sha(source),casesSha256=sha(folder/'cases.json'),ownedSourceSha256=sha(owned),
        nativeWindowId=1591106,nativeWindowTitle='thin-border-crossing-native-20261003 - Word',savedAtBothCaptures=True,
        provenance='Document-opening helper confirmed exact owned path; screen observation confirmed the unique visible title, Saved state and 100%/200% zoom. Blank paper corner cleared table handles; pointer moved off the page. Post-capture owned bytes equal the source.',
        scope='Twenty-four independently positioned thin crossings. Median source-positioned body samples use luminance <166; crossing R versus B identifies declared red/blue ownership. JPEG chroma does not certify exact RGB or opacity equivalence.',
        observations=observations)
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Recorded',sum(len(o['rows']) for o in observations),'native crossing positions and owners')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,default=ROOT/'tests/fixtures/thin-border-crossing')
    args=parser.parse_args();record(args.capture,args.output)
