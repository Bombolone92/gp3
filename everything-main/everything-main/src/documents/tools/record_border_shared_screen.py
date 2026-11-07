"""Record native shared-rule ink from inspected reference captures and metafiles."""
from pathlib import Path
from PIL import Image
import argparse, gzip, hashlib, json, struct

def sha(data): return hashlib.sha256(data).hexdigest()
def runs(values):
    out, start = [], None
    for i, value in enumerate(values+[False]):
        if value and start is None: start=i
        if not value and start is not None: out.append([start,i]);start=None
    return out

def record(capture, folder):
    meta_bytes=(capture/'native-capture.json').read_bytes()
    metadata=json.loads(meta_bytes.decode('utf-8-sig'))
    (folder/'native-capture.json').write_bytes(meta_bytes)
    result=dict(scope='Native reference 96-DPI screen ink and independent 600-DPI page records; no PDF projection.',
                threshold=128,referenceBuild='16.0.20326',captureSha256=sha(meta_bytes),sources=[])
    for owner in ['top','bottom']:
        meta=next(m for m in metadata if m['owner']==owner)
        assert meta['sourceSha256']==sha((folder/f'{owner}.docx').read_bytes())
        assert meta['sourceUnchanged'] and meta['savedAfter'] and meta['characters']==''
        assert meta['referenceBuild']==result['referenceBuild'] and [meta['pageWidthPt'],meta['pageHeightPt']]==[288,216]
        data=(capture/f'{owner}.emf').read_bytes();assert sha(data)==meta['emfSha256']
        at, rects=0,[]
        while at<len(data):
            kind,size=struct.unpack_from('<II',data,at);assert size>=8 and at+size<=len(data)
            assert kind not in [35,36,77,78,79,80,81], 'Unexpected transform or bitmap record'
            if kind==9: assert struct.unpack_from('<ii',data,at+8)==(2400,1800)
            if kind==76:
                assert size==100 and struct.unpack_from('<I',data,at+40)[0]==0xF00021
                assert struct.unpack_from('<IIII',data,at+84)==(0,0,0,0)
                rects.append(list(struct.unpack_from('<iiii',data,at+24)))
            at+=size
        assert at==len(data) and len(rects)==25
        zipped=gzip.compress(data,mtime=0);(folder/f'native-{owner}.emf.gz').write_bytes(zipped)
        source=dict(owner=owner,sourceSha256=meta['sourceSha256'],emfRawSha256=sha(data),emfSha256=sha(zipped),rectangles=rects,observations=[])
        for zoom,origin,offset,size in [(100,(272,202),(18,18),(96,90)),(200,(80,202),(42,36),(176,174))]:
            jpeg=(capture/f'{owner}-{zoom}.jpg').read_bytes();im=Image.open(capture/f'{owner}-{zoom}.jpg').convert('RGB')
            # The independently visible paper outline fixes the page origin.
            # Empty-document caret can blink at the exact page corner. Check
            # both outline segments away from that corner, without masking ink.
            for point in [(origin[0]+10,origin[1]),(origin[0],origin[1]+10)]:
                pixel=im.getpixel(point);assert max(pixel)-min(pixel)<=3 and 160<=min(pixel)<=220
            assert min(im.getpixel((origin[0]+10,origin[1]+3)))>=248
            z=zoom//100
            vertical=runs([max(im.getpixel((origin[0]+x,origin[1]+35*z)))<128 for x in range(115*z)])
            horizontal=runs([max(im.getpixel((origin[0]+35*z,origin[1]+y)))<128 for y in range(110*z)])
            assert len(vertical)==len(horizontal)==3
            x,y=origin[0]+offset[0],origin[1]+offset[1]
            crop=im.crop((x,y,x+size[0],y+size[1]));name=f'native-{owner}-{zoom}.png';crop.save(folder/name)
            # No selection handles, pointer halo, non-neutral background or masked pixels.
            assert all(max(p)-min(p)<=16 for p in crop.get_flattened_data())
            native=[vertical[0][0],horizontal[0][0],vertical[-1][1],horizontal[-1][1]]
            source['observations'].append(dict(zoom=zoom,origin=list(origin),crop=name,cropOffset=list(offset),cropSize=list(size),
                captureSha256=sha(jpeg),cropSha256=sha((folder/name).read_bytes()),vertical=vertical,horizontal=horizontal,native=native))
        result['sources'].append(source)
    assert result['sources'][0]['rectangles']==result['sources'][1]['rectangles']
    for i in range(2):
        assert result['sources'][0]['observations'][i]['native']==result['sources'][1]['observations'][i]['native']
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-shared-origin')
    args=parser.parse_args();record(args.capture,args.output)
