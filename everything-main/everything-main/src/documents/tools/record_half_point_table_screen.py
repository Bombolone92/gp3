"""Record fixed, source-positioned strips from independently observed reference JPEGs.

This separates rule contrast/thickness from unresolved screen placement. It never
uses a PDF resampling as a screen reference or registers origins to table ink.
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/half-point-table-screen'

def record(captures):
    source=(FOLDER/'control.docx').read_bytes()
    assert (captures/'half-point-table-screen-native-20261003.docx').read_bytes()==source
    cases=json.loads((FOLDER/'cases.json').read_text());observations=[]
    for zoom,origin in [(100,(439,260)),(200,(247,116))]:
        image=Image.open(captures/f'screen-{zoom}.jpg');assert image.format=='JPEG' and image.size==(1280,752)
        rgb=image.convert('RGB');scale=zoom/100
        for point in [(origin[0]+10,origin[1]),(origin[0],origin[1]+10)]:
            pixel=rgb.getpixel(point);assert max(pixel)-min(pixel)<=3 and 160<=min(pixel)<=220
        crop=rgb.crop((*origin,int(origin[0]+384*scale),int(origin[1]+288*scale)))
        name=f'native-screen-{zoom}.png';crop.save(FOLDER/name);pixels=np.asarray(crop);profiles=[]
        for case in cases:
            x=case['xTwips']/15*scale;y=case['yTwips']/15*scale
            w=case['widthTwips']/15*scale;h=case['rowHeightTwips']*case['rows']/15*scale
            for axis in ['h','v']:
                for line in ([1] if case['color']=='FFFFFF' else [0,1,2]):
                    box=[round(x+w/4)-8,round(y+h*line/2)-4,16,9] if axis=='h' else [round(x+w*line/2)-4,round(y+h/4)-8,9,16]
                    px,py,pw,ph=box
                    profile=np.median(pixels[py:py+ph,px:px+pw],axis=1 if axis=='h' else 0).astype(int)
                    strength=profile[:,1] if case['color']=='FFFFFF' else 255-profile[:,2] if case['color']=='FFC000' else 255-profile.max(axis=1)
                    threshold=200 if case['color']=='FFFFFF' else 127
                    ink=np.flatnonzero(strength>threshold);assert len(ink)==1, 'Native half-point rule must be one pixel in these controls'
                    offset=py if axis=='h' else px
                    strongest=profile[int(np.argmax(strength))].tolist()
                    if case['color']=='auto':assert max(strongest)<=1, 'Neutral native black is full contrast, not antialiased gray'
                    profiles.append(dict(id=case['id'],color=case['color'],axis=axis,line=line,region=box,
                        threshold=threshold,nativeBounds=[int(offset+ink[0]),int(offset+ink[-1]+1)],nativeStrongest=strongest,rgb=profile.tolist()))
        observations.append(dict(zoom=zoom,origin=origin,deviceScaleFactor=1,captureFormat=image.format,
            captureSha256=hashlib.sha256((captures/f'screen-{zoom}.jpg').read_bytes()).hexdigest(),
            crop=name,cropSha256=hashlib.sha256((FOLDER/name).read_bytes()).hexdigest(),profiles=profiles))
    result=dict(sourceSha256=hashlib.sha256(source).hexdigest(),
        provenance='Document-opening helper opened exact authored copy. Unique matching reference title, visible Saved status and 100%/200% zoom observed on screen. Table handles and pointer halos cleared. Paper-edge registration; source copy unchanged.',
        scope='One-pixel contrast/thickness only. Profile positions are retained independently; no viewer spatial equivalence is asserted. JPEG chroma subsampling alters narrow colored rule RGB; neutral black contrast is reliable. White profiles cover internal rules only because exterior white meets the white page.',observations=observations)
    (FOLDER/'native-screen-reference.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Recorded',sum(len(o['profiles']) for o in observations),'native strips')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('captures',type=Path);record(parser.parse_args().captures)
