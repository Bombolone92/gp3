from pathlib import Path
from hashlib import sha256
import sys, json, struct, io
import numpy as np
from PIL import Image
repo=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(repo/'tools'))
from record_emf_range_bitmaps import extract
for variant in ['a','b']:
    folder=repo/f'tests/fixtures/emf-miter-effects-{variant}'
    data=(folder/'native.emf').read_bytes()
    meta=json.loads((folder/'native.emf.json').read_text(encoding='utf-8-sig'))
    assert sha256(data).hexdigest()==meta['captureSha256']
    assert sha256((folder/'control.docx').read_bytes()).hexdigest()==meta['sourceSha256']
    result=extract(data); result['pdfSha256']=sha256((folder/'native.pdf').read_bytes()).hexdigest()
    assert len(result['images'])==4
    pos=0; images=[]
    while pos<len(data):
        kind,size=struct.unpack_from('<II',data,pos)
        if kind==70 and data[pos+12:pos+16]==b'EMF+':
            end=pos+12+struct.unpack_from('<I',data,pos+8)[0]; off=pos+16
            while off<end:
                typ,flags,length,count=struct.unpack_from('<HHII',data,off)
                if typ==0x4008 and (flags>>8)&127==5:
                    payload=data[off+12:off+12+count]
                    if struct.unpack_from('<I',payload,4)[0]==1: images.append(payload[28:])
                off+=length
        pos+=size
    for i,(png,entry) in enumerate(zip(images,result['images'])):
        assert sha256(png).hexdigest()==entry['pngSha256']
        (folder/f'native-{i}.png').write_bytes(png)
        alpha=np.array(Image.open(io.BytesIO(png)).convert('RGBA'))[:,:,3]
        # Isolate the central acute join, excluding the outer rectangle.
        start=alpha.shape[0]//20; region=alpha[start:alpha.shape[0]//3,alpha.shape[1]//3:2*alpha.shape[1]//3]
        ys,xs=np.where(region>175)
        entry['tipFirstOpaqueRow']=int(ys.min())+start
        print(variant,i,entry['size'],entry['tipFirstOpaqueRow'])
    (folder/'native-reference.json').write_text(json.dumps(dict(provenance=meta,**result),indent=2)+'\n')
