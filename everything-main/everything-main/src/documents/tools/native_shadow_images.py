"""Read native reference EMF+ embedded PNG centers without invoking a renderer."""
import struct, hashlib
from io import BytesIO
from PIL import Image

def native_images(path, histogram=False):
    data=path.read_bytes(); pos=0; images=[]
    while pos<len(data):
        kind,size=struct.unpack_from('<II',data,pos)
        assert size>=8 and pos+size<=len(data)
        if kind==70 and data[pos+12:pos+16]==b'EMF+':
            at=pos+16
            while at<pos+size:
                t,flags,length,count=struct.unpack_from('<HHII',data,at)
                assert length>=12 and at+length<=pos+size and count<=length-12
                payload=data[at+12:at+12+count]
                if t==0x4008 and (flags>>8)&127==5:
                    assert not flags&0x8000
                    assert struct.unpack_from('<I',payload,4)[0]==1
                    assert payload[28:36]==b'\x89PNG\r\n\x1a\n'
                    image=Image.open(BytesIO(payload[28:])).convert('RGBA')
                    images.append(dict(size=list(image.size),centerRgba=list(image.getpixel((image.width//2,image.height//2))),
                        pngSha256=hashlib.sha256(payload[28:]).hexdigest()))
                    if histogram:images[-1]['histogram']=[dict(count=n,rgba=list(rgba)) for n,rgba in sorted(image.getcolors(image.width*image.height),key=lambda item:item[1])]
                at+=length
        pos+=size
    assert len(images)==2
    return images
