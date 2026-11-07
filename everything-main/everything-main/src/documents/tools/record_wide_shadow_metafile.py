from pathlib import Path
from PIL import Image, ImageChops
import struct,json,math,hashlib,zipfile,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]/'tests/fixtures/scaled-picture-shadows'
out=root/'metafile'; data=(out/'capture.emf').read_bytes(); expanded=(out/'expanded.emf').read_bytes()
viewport=json.loads((out/'viewport.json').read_text(encoding='utf-8-sig'))
assert data[:36]==expanded[:36] and data[40:]==expanded[40:]
assert struct.unpack_from('<i',expanded,36)[0]==round(struct.unpack_from('<i',data,36)[0]*viewport['factor'])
a=Image.open(out/'capture.png').convert('RGB'); b=Image.open(out/'expanded.png').convert('RGB')
assert b.size==(a.width,math.ceil(a.height*viewport['factor']))
assert ImageChops.difference(a,b.crop((0,0,a.width,a.height))).getbbox() is None
bounds=list(struct.unpack_from('<4i',data,8))
assert bounds[0]>=0 and bounds[1]>=0 and bounds[2]<b.width and bounds[3]<b.height
pos=0; transform=[1,0,0,1,0,0]; images=[]
while pos<len(data):
    kind,size=struct.unpack_from('<II',data,pos); assert size>=8
    if kind==70 and data[pos+12:pos+16]==b'EMF+':
        at=pos+16
        while at<pos+size:
            t,f,n,c=struct.unpack_from('<HHII',data,at); assert n>=12
            payload=data[at+12:at+12+c]
            if t==0x402a: transform=list(struct.unpack('<6f',payload))
            if t==0x4008 and (f>>8)&127==5:
                assert not f&0x8000
                assert struct.unpack_from('<I',payload,4)[0]==1 and payload[28:36]==b'\x89PNG\r\n\x1a\n'
                name=['shadow.png','picture.png'][len(images)]; (out/name).write_bytes(payload[28:])
                images.append(dict(id=f&255,file=name,size=list(Image.open(out/name).size),transform=transform))
            if t==0x401b:
                entry=next(i for i in images if i['id']==f&255)
                entry['draw']=dict(sourceRect=list(struct.unpack_from('<4f',payload,8)),points=list(struct.unpack_from('<6h',payload,28)))
            at+=n
    pos+=size
assert len(images)==2
ns={'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
with zipfile.ZipFile(root/'source.docx') as z: doc=ET.fromstring(z.read('word/document.xml'))
anchor=doc.findall('.//wp:anchor',ns)[13]
positions=[anchor.find('wp:position'+axis,ns) for axis in ('H','V')]
assert all(p.get('relativeFrom')=='page' for p in positions)
origin=[int(p.find('wp:posOffset',ns).text)/12700 for p in positions]
extent=anchor.find('wp:extent',ns); extent=[int(extent.get(k))/12700 for k in ('cx','cy')]
shadow,picture=images
assert picture['size']==extent
assert all(i['transform'][1:3]==[0,0] for i in images)
radius=math.ceil(max(shadow['transform'][0],shadow['transform'][3])+.375*max(picture['transform'][0],picture['transform'][3]))
ref=json.loads((root/'reference.json').read_text()); points=[s[:2] for s in ref['pages'][13]['samples']]
files=['source.docx','reference.json']+['metafile/'+n for n in ['capture.emf','expanded.emf','capture.png','expanded.png','shadow.png','picture.png','viewport.json']]
manifest=dict(provenance='Native reference Range.EnhMetaFileBits, played by Windows GDI+. Expanded viewport changes only rclFrame bottom; overlapping rendered pixels are identical. This is not a screen capture.',sha256={f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in files},nativeBounds=bounds,originalSize=list(a.size),expandedSize=list(b.size),images=images,anchorPt=origin,extentPt=extent,radiusPixels=radius,allowance=4,points=points)
(out/'reference.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:manifest[k] for k in ['nativeBounds','originalSize','expandedSize','anchorPt','radiusPixels']})); print(len(points),'sample positions; original overlap is pixel-identical')
