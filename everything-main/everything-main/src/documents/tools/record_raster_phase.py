"""Bounded numeric image-command evidence for the original raster-phase control."""
from pathlib import Path
from hashlib import sha256
import argparse,json,struct
import math
from record_emf_range_bitmaps import extract,require

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/raster-phase'

def commands(data):
    # extract validates every record length/count and reads only image objects.
    extract(data)
    at=0;matrix=None;interpolation=None;offset=None;rows=[];window=None
    while at<len(data):
        kind,size=struct.unpack_from('<II',data,at)
        if kind==9:
            value=list(struct.unpack_from('<2i',data,at+8))
            require(window is None or value==window,'Changing logical window unsupported')
            window=value
        if kind==70 and data[at+12:at+16]==b'EMF+':
            end=at+12+struct.unpack_from('<I',data,at+8)[0];pos=at+16
            while pos<end:
                record,flags,length,count=struct.unpack_from('<HHII',data,pos)
                if record==0x402a:
                    require(count==24,'Invalid transform')
                    matrix=list(struct.unpack_from('<6f',data,pos+12))
                elif record in [0x402b,0x402c,0x402d,0x402e,0x402f,0x4025,0x4026]:
                    matrix=None  # Must see an explicit matrix before a draw.
                elif record==0x4021:interpolation=flags
                elif record==0x4022:offset=flags
                elif record==0x401b:
                    require(matrix is not None and matrix[1]==matrix[2]==0,'Explicit axis-aligned transform required')
                    require(not flags&0x800 and count==(40 if flags&0x4000 else 52),'Unsupported point encoding')
                    require(struct.unpack_from('<I',data,pos+16)[0]==2,'Pixel source units required')
                    require(struct.unpack_from('<I',data,pos+36)[0]==3,'Three points required')
                    points=list(struct.unpack_from('<6h' if flags&0x4000 else '<6f',data,pos+40))
                    require(points==[0,0,625,0,0,300],'Unexpected original-art destination points')
                    rows.append(dict(matrix=matrix,sourceRect=list(struct.unpack_from('<4f',data,pos+20)),interpolation=interpolation,pixelOffset=offset))
                pos+=length
        at+=size
    require(window==[4800,3500],'Unexpected logical page mapping')
    return rows

def record(capture_root, fixture=FOLDER):
    cases=json.loads((fixture/'cases.json').read_text())
    require(sha256((fixture/'control.docx').read_bytes()).hexdigest()==cases['sourceSha256'],'Fixture source differs')
    metadata=json.loads((capture_root/'capture.json').read_text(encoding='utf-8-sig'))
    require(metadata['sourceSha256']==cases['sourceSha256'] and all(metadata[k] for k in ['sourceUnchanged','savedBefore','savedAfter']),'Unverified source state')
    require(len(metadata['captures'])==2,'Two captured pages required')
    pages=[]
    for number,entry in enumerate(metadata['captures'],1):
        require(entry['page']==number and entry['widthPt']==576 and entry['heightPt']==420,'Wrong page geometry')
        data=(capture_root/entry['file']).read_bytes()
        require(sha256(data).hexdigest()==entry['sha256'] and data==(capture_root/f'repeat-{number}.emf').read_bytes(),'Capture/repeat mismatch')
        images=extract(data)['images'];require(len(images)==2,'Expected paired image objects')
        for image in images:
            require(image['size']==[625,300] and image['rgbaSha256']==cases['sourceRgbaSha256'] and len(image['draws'])==5,'Unexpected bitmap input')
        draws=commands(data);require(len(draws)==10,'Ten image draws required')
        unmatched=[c for c in cases['cases'] if c['page']==number];recorded=[]
        for draw in draws:
            a,_,_,d,x,y=draw['matrix'];box=[x/6.25,y/6.25,a*625/6.25,d*300/6.25]
            offset=lambda value:math.trunc(round(value*9525)/635)/15
            matches=[c for c in unmatched if abs(offset(c['x'])-box[0])<.081 and abs(offset(c['y'])-box[1])<.081]
            require(len(matches)==1,'Position does not identify one declared control')
            case=matches[0];unmatched.remove(case)
            require(abs(case['width']-box[2])<.161 and abs(case['height']-box[3])<.161,'Extent differs by more than one capture-grid unit')
            recorded.append(dict(name=case['name'],logicalDeviceBoxCssPx=box,**draw))
        pages.append(dict(page=number,captureSha256=entry['sha256'],repeatIdentical=True,imageRgbaSha256=images[0]['rgbaSha256'],draws=sorted(recorded,key=lambda r:r['name'])))
    return dict(sourceSha256=cases['sourceSha256'],referenceBuild=metadata['referenceBuild'],sourceUnchanged=True,savedBefore=True,savedAfter=True,pages=pages,
        scope='Page.EnhMetaFileBits image inputs and explicit transforms on the captured 4800x3500 logical grid. The 0.16 CSS-pixel grid is not established as a physical-screen or universal layout rule.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture_root',type=Path);parser.add_argument('--fixture',type=Path,default=FOLDER);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    result=record(args.capture_root,args.fixture)
    with args.output.open('x',encoding='utf8') as out:out.write(json.dumps(result,indent=2)+'\n')
    print('Verified twenty native image draws and byte-identical repeat captures')
