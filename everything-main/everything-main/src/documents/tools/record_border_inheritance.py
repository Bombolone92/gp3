"""Bind observed 100% reference screenshots and PATCOPY geometry to original controls."""
from pathlib import Path
from PIL import Image
import argparse, gzip, hashlib, json, struct

def sha(data):return hashlib.sha256(data).hexdigest()
def runs(values):
    out=[];start=None
    for i,value in enumerate(values+[False]):
        if value and start is None:start=i
        if not value and start is not None:out.append([start,i]);start=None
    return out
def record(capture,folder):
    cases=json.loads((folder/'cases.json').read_text());sources=[]
    metadata_bytes=(capture/'cell-capture.json').read_bytes()
    metadata=json.loads(metadata_bytes.decode('utf-8-sig'))
    assert metadata['savedBefore'] and metadata['savedAfter'] and metadata['characters']==''
    assert metadata['zoom']==100 and [metadata['pageWidthPt'],metadata['pageHeightPt']]==[288,216]
    # The capture concatenated Version and Build; the reference Build already includes Version.
    assert metadata['referenceBuild']=='16.0.16.0.20326'
    (folder/'cell-capture.json').write_bytes(metadata_bytes)
    for owner in ['table','cell']:
        data=(folder/f'{owner}.docx').read_bytes()
        assert data==(capture/f'border-inheritance-{owner}-owned-20261002.docx').read_bytes(),'Source changed'
        raw=(capture/f'{owner}.emf').read_bytes();rects=[];at=0
        while at<len(raw):
            kind,size=struct.unpack_from('<II',raw,at);assert size>=8 and at+size<=len(raw)
            assert kind not in [35,36,77,78,79,80,81],'Unexpected transform or bitmap'
            if kind==9:assert struct.unpack_from('<ii',raw,at+8)==(2400,1800)
            if kind==76:
                assert size==100 and struct.unpack_from('<I',raw,at+40)[0]==0xF00021
                assert struct.unpack_from('<IIII',raw,at+84)==(0,0,0,0)
                rects.append(list(struct.unpack_from('<iiii',raw,at+24)))
            at+=size
        assert len(rects)>0
        zipped=gzip.compress(raw,mtime=0);(folder/f'native-{owner}.emf.gz').write_bytes(zipped)
        image=Image.open(capture/f'{owner}-100.jpg').convert('RGB');origin=(272,202)
        for point in [(282,202),(272,212)]:
            p=image.getpixel(point);assert max(p)-min(p)<=3 and 160<=min(p)<=220
        assert min(image.getpixel((282,205)))>=248
        ink=lambda x,y:max(image.getpixel((origin[0]+x,origin[1]+y)))<128
        observations=[]
        for c in cases:
            x,y=c['xTwips']/15,c['yTwips']/15
            offset=[int(x)-5,int(y)-5];size=[75,92]
            # Scan away from empty paragraph caret, table handles and junctions.
            vertical=runs([ink(offset[0]+dx,int(y)+10) for dx in range(size[0])])
            horizontal=runs([ink(int(x)+10,offset[1]+dy) for dy in range(size[1])])
            vertical=[[a+offset[0],b+offset[0]] for a,b in vertical]
            horizontal=[[a+offset[1],b+offset[1]] for a,b in horizontal]
            assert len(vertical)==c['columns']+1 and len(horizontal)==c['rows']+1
            file=f'native-{owner}-{c["id"]}-100.png';ox,oy=origin
            image.crop((ox+offset[0],oy+offset[1],ox+offset[0]+size[0],oy+offset[1]+size[1])).save(folder/file)
            observations.append(dict(id=c['id'],vertical=vertical,horizontal=horizontal,crop=file,cropOffset=offset,cropSize=size,cropSha256=sha((folder/file).read_bytes())))
        sources.append(dict(owner=owner,sourceSha256=sha(data),sourceUnchanged=True,emfRawSha256=sha(raw),emfSha256=sha(zipped),captureSha256=sha((capture/f'{owner}-100.jpg').read_bytes()),rectangles=rects,observations=observations))
    assert sources[0]['rectangles']==sources[1]['rectangles'],'Native border inheritance changes geometry'
    for a,b in zip(sources[0]['observations'],sources[1]['observations']):
        assert a['vertical']==b['vertical'] and a['horizontal']==b['horizontal']
    result=dict(referenceBuild='16.0.20326',zoom=100,origin=[272,202],threshold=128,casesSha256=sha((folder/'cases.json').read_bytes()),
        cellCaptureSha256=sha(metadata_bytes),
        scope='Eight topologies per source; native border cross-sections and page-metafile rectangles. Not a full RGB/whole-document match.',
        limits=['First table crops can include editor caret/handles; cross-sections avoid them.','Only 100% zoom captured.','Table capture metadata serialization failed on the open-file hash; source hashes verified after exact unsaved close. No savedAfter claim for that capture.'],sources=sources)
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps([dict(owner=s['owner'],rectangles=len(s['rectangles']),observations=[dict(id=o['id'],vertical=o['vertical'],horizontal=o['horizontal']) for o in s['observations']]) for s in sources]))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('capture',type=Path);parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-inheritance')
    args=parser.parse_args();record(args.capture,args.output)
