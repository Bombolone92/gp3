"""Measure flat authored picture swatches from hash-guarded reference EMF+ PNGs.

This is a front-face color oracle, not a page placement or screen/PDF oracle.
"""
import argparse,gzip,json
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from PIL import Image
from emfplus_image_objects import extract_png_objects,require


def digest(data):return sha256(data).hexdigest()


def measure(root):
    cases=json.loads((root/'cases.json').read_text(encoding='utf-8-sig'))
    capture=json.loads((root/'native/capture.json').read_text(encoding='utf-8-sig'))
    source=(root/'source.docx').read_bytes()
    require(capture['sourceUnchanged'] is True,'Native source changed')
    require(capture['savedBefore']==capture['savedAfter'],'Native Saved state changed')
    require(capture['viewBefore']==capture['viewAfter'],'Native view changed')
    require(digest(source)==capture['sourceSha256'],'Source hash mismatch')
    grid=cases['grid'];colors=cases['colors']
    require(grid in (8,16) and len(colors)==grid*grid,'Unexpected swatch grid')
    with ZipFile(BytesIO(source)) as archive:
        image=Image.open(BytesIO(archive.read('word/media/panel.png'))).convert('RGB')
        require(image.size==(grid*cases['tilePixels'],)*2,'Source image dimensions mismatch')
        tile=cases['tilePixels']
        for i,color in enumerate(colors):
            require(list(image.getpixel(((i%grid)*tile+tile//2,(i//grid)*tile+tile//2)))==color,'Source swatch mismatch')
    require(len(cases['cases'])==len(capture['captures'])==3,'Unexpected case count')
    measurements=[]
    for case,item in zip(cases['cases'],capture['captures'],strict=True):
        require(item['page']==case['id'],'Capture page mismatch')
        name=item['file'];require(name==f'page-{case["id"]}.emf','Unexpected capture filename')
        path=root/'native'/name
        data=path.read_bytes() if path.exists() else gzip.decompress(path.with_suffix('.emf.gz').read_bytes())
        require(digest(data)==item['sha256'],'Native metafile hash mismatch')
        objects=extract_png_objects(data);require(len(objects)==1,'Expected one native bitmap')
        obj=objects[0];image=Image.open(BytesIO(obj['png']));image.verify()
        image=Image.open(BytesIO(obj['png'])).convert('RGBA');native=[]
        for i in range(len(colors)):
            x=int((i%grid+.5)*image.width/grid);y=int((i//grid+.5)*image.height/grid)
            samples={image.getpixel((x+dx,y+dy)) for dx in range(-2,3) for dy in range(-2,3)}
            require(len(samples)==1 and next(iter(samples))[3]==255,'Swatch is not flat opaque native color')
            native.append(list(next(iter(samples)))[:3])
        measurements.append({'case':case,'image':{k:v for k,v in obj.items() if k!='png'},'colors':native})
    return {'scope':'Flat picture front-face RGB only; no geometry, screen, PDF or whole-template certification',
            'capture':capture,'input':cases,'measurements':measurements}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args()
    require(not args.output.exists(),'Refusing to overwrite evidence')
    result=measure(args.root)
    with args.output.open('x',encoding='utf-8') as stream:json.dump(result,stream,indent=2);stream.write('\n')
