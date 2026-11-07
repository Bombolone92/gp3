"""Reproduce the original-art-only native reference atlas from guarded private screenshots."""
from pathlib import Path
from hashlib import sha256
import argparse,json
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/raster-phase'
ORIGINS={('control',1,1):(84,96),('control',1,2):(84,106),
         ('holdout',1,1):(80,96),('holdout',1,2):(80,110),
         ('holdout',2,1):(40,112),('holdout',2,2):(40,153)}

def build(screens,output):
    reference=json.loads((FOLDER/'display-reference.json').read_text())
    rows=reference['observations'];atlas=Image.new('RGB',(max(r['box'][2] for r in rows),sum(r['box'][3] for r in rows)),'white')
    for row in rows:
        fixture,zoom,page=row['fixture'],row['zoom'],row['page']
        filename=(f'raster-phase-native-page{page}-screen-20261004.jpg' if fixture=='control' else
                  f'raster-holdout-native-page{page}-screen'+('200' if zoom==2 else '')+'-20261004.jpg')
        data=(screens/filename).read_bytes()
        if sha256(data).hexdigest()!=row['nativeScreenshotSha256']:raise ValueError('Screenshot hash mismatch: '+filename)
        source=FOLDER/('holdout' if fixture=='holdout' else '')/'control.docx'
        if sha256(source.read_bytes()).hexdigest()!=row['sourceSha256']:raise ValueError('Source hash mismatch')
        x,y,w,h=row['box'];ox,oy=ORIGINS[(fixture,zoom,page)];nx,ny,nw,nh=row['nativeBox']
        if (w,h)!=(nw,nh):raise ValueError('Atlas extent mismatch')
        with Image.open(screens/filename) as image:atlas.paste(image.convert('RGB').crop((x+ox,y+oy,x+ox+w,y+oy+h)),(nx,ny))
    atlas.save(output)
    if sha256(output.read_bytes()).hexdigest()!=reference['atlasSha256']:raise ValueError('Atlas hash mismatch')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('screens',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
    build(args.screens,args.output)
