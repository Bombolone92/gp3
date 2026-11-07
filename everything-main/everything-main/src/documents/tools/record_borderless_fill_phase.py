"""Measure original native borderless fill captures using source-positioned regions."""
from pathlib import Path
import argparse,hashlib,json,math
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def color_bounds(pixels,region,color):
    x,y,w,h=region;a=pixels[y:y+h,x:x+w].astype(float)
    assert a.shape==(h,w,3)
    r,g,b=[a[:,:,i] for i in range(3)]
    neutral=.299*r+.587*g+.114*b<166
    mask=neutral & ((r>128)&(r>g+32)&(r>b+32) if color=='FF0000' else (b>128)&(b>r+32)&(b>g+32))
    ys,xs=np.where(mask);assert len(xs),'Missing authored fill'
    return [int(x+xs.min()),int(y+ys.min()),int(x+xs.max()+1),int(y+ys.max()+1)]

def record(capture,folder):
    source=folder/'control.docx';owned=capture/'borderless-fill-phase-native-20261003.docx'
    assert source.read_bytes()==owned.read_bytes(),'Owned source changed'
    cases=json.loads((folder/'cases.json').read_text());observations=[]
    for zoom,origin in [(100,[439,260]),(200,[247,116])]:
        raw=capture/f'screen-{zoom}.jpg';image=Image.open(raw).convert('RGB');assert image.size==(1280,752)
        for x,y in [(origin[0]+20,origin[1]),(origin[0],origin[1]+20)]:
            rgb=image.getpixel((x,y));assert max(rgb)-min(rgb)<=3 and 160<=min(rgb)<=220
        scale=zoom/100;size=[round(384*scale),round(288*scale)];crop=f'native-{zoom}.png'
        image.crop((*origin,origin[0]+size[0],origin[1]+size[1])).save(folder/crop)
        pixels=np.asarray(Image.open(folder/crop).convert('RGB'));rows=[]
        for case in cases:
            x=case['xTwips']/15*scale;y=case['yTwips']/15*scale
            region=[math.floor(x)-3,math.floor(y)-3,math.ceil(sum(case['widthsTwips'])/15*scale)+7,math.ceil(case['heightTwips']/15*scale)+7]
            for col,color in enumerate(case['colors']):
                bounds=color_bounds(pixels,region,color)
                rows.append(dict(id=case['id'],column=col,color=color,region=region,bounds=bounds))
        observations.append(dict(zoom=zoom,origin=origin,crop=crop,cropSize=size,cropSha256=sha(folder/crop),rawSha256=sha(raw),rows=rows))
    result=dict(sourceSha256=sha(source),casesSha256=sha(folder/'cases.json'),ownedSourceSha256=sha(owned),
       nativeWindowId=2901870,nativeWindowTitle='borderless-fill-phase-native-20261003 - Word',savedAtBothCaptures=True,
       provenance='Reference-application helper confirmed exact owned path. Sky observed Saved, page 1 of 1, and 100%/200%. Handles cleared and pointer outside paper. Origins from independent paper outline. Further zoom-dialog inputs did not visibly apply; no fractional-zoom capture is asserted.',
       scope='Sixty original floating borderless tables, 75 filled cells, all whole-twip origin phases, three sizes and unequal adjacent columns. Red/blue dominance and luminance midpoint classify threshold bounds; JPEG-derived colors are not an exact RGB/opacity oracle.',observations=observations)
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Recorded',sum(len(o['rows']) for o in observations),'native fill bounds')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture',type=Path)
    parser.add_argument('--folder',type=Path,default=ROOT/'tests/fixtures/borderless-fill-phase');args=parser.parse_args();record(args.capture,args.folder)
