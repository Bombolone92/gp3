from pathlib import Path
from hashlib import sha256
import json,struct,sys,io
from PIL import Image
import numpy as np
repo=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(repo/'tools'))
from record_emf_range_bitmaps import extract
if len(sys.argv)<2: raise SystemExit('Supply one or more fixture folder names')
for name in sys.argv[1:]:
    folder=repo/'tests/fixtures'/name;data=(folder/'native.emf').read_bytes()
    meta=json.loads((folder/'native.emf.json').read_text(encoding='utf-8-sig'))
    assert sha256(data).hexdigest()==meta['captureSha256']
    assert sha256((folder/'control.docx').read_bytes()).hexdigest()==meta['sourceSha256']
    assert meta['sourceUnchanged']
    result=extract(data);assert len(result['images'])==4
    if (folder/'native.pdf').exists():result['pdfSha256']=sha256((folder/'native.pdf').read_bytes()).hexdigest()
    at=0;pngs=[]
    while at<len(data):
        kind,size=struct.unpack_from('<II',data,at)
        if kind==70 and data[at+12:at+16]==b'EMF+':
            end=at+12+struct.unpack_from('<I',data,at+8)[0];off=at+16
            while off<end:
                typ,flags,length,count=struct.unpack_from('<HHII',data,off)
                if typ==0x4008 and (flags>>8)&127==5:
                    payload=data[off+12:off+12+count]
                    if struct.unpack_from('<I',payload,4)[0]==1:pngs.append(payload[28:])
                off+=length
        at+=size
    assert len(pngs)==4
    for i,(png,entry) in enumerate(zip(pngs,result['images'])):
        assert sha256(png).hexdigest()==entry['pngSha256']
        (folder/f'native-{i}.png').write_bytes(png)
        rgba=np.array(Image.open(io.BytesIO(png)).convert('RGBA'));alpha=rgba[:,:,3];h,w=alpha.shape
        entry['maxAlpha']=int(alpha.max());entry['alphaThreshold']=entry['maxAlpha']*175//255
        ys,xs=np.where(alpha>entry['alphaThreshold']);entry['opaqueBounds']=[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]
        start=h//20;ys,xs=np.where(alpha[start:h//3,w//3:2*w//3]>entry['alphaThreshold'])
        entry['tipFirstOpaqueRow']=int(ys.min())+start if len(ys) else None
        print(name,i,entry['size'],entry['tipFirstOpaqueRow'])
    (folder/'native-reference.json').write_text(json.dumps(dict(provenance=meta,**result),indent=2)+'\n')
