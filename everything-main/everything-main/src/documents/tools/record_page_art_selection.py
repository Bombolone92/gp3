"""Record numeric/hash-only page-art metadata, never polygon points or tiles."""
from pathlib import Path
from hashlib import sha256
from copy import deepcopy
import argparse,json,struct

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/page-art-selection'

def polygons(data):
    at=0;rows=[];brushes={};other_objects=set();stack=[];eof=False;header=False
    state={'brush':None,'mapMode':None,'windowOrigin':[0,0],'windowExtent':None,
           'viewportOrigin':[0,0],'viewportExtent':None}
    while at<len(data):
        assert len(data)-at>=8 and not eof
        kind,size=struct.unpack_from('<II',data,at)
        assert size>=8 and size%4==0 and at+size<=len(data)
        if kind==1:
            assert at==0 and size>=88;header=True
        elif kind in [9,10,11,12]:
            assert size==16
            state[{9:'windowExtent',10:'windowOrigin',11:'viewportExtent',12:'viewportOrigin'}[kind]]=list(struct.unpack_from('<2i',data,at+8))
        elif kind==17:state['mapMode']=struct.unpack_from('<I',data,at+8)[0]
        elif kind==33:stack.append(deepcopy(state))
        elif kind==34:
            assert struct.unpack_from('<i',data,at+8)[0]==-1 and stack
            state=stack.pop()
        elif kind==39:
            handle,style,color,hatch=struct.unpack_from('<4I',data,at+8)
            assert style==hatch==0 and color>>24 in [0,2]
            brushes[handle]=color&0xffffff
        elif kind in [38,82]:other_objects.add(struct.unpack_from('<I',data,at+8)[0])
        elif kind==37:
            handle=struct.unpack_from('<I',data,at+8)[0]
            if handle in brushes:state['brush']=brushes[handle]
            elif 0x80000000<=handle<=0x80000005:
                state['brush']=[0xffffff,0xc0c0c0,0x808080,0x404040,0,None][handle-0x80000000]
            else:assert handle in other_objects or 0x80000000<=handle<=0x80000013
        elif kind==40:
            handle=struct.unpack_from('<I',data,at+8)[0];brushes.pop(handle,None);other_objects.discard(handle)
        elif kind==70:
            if data[at+12:at+16]==b'EMF+':
                pos=at+16
                # Header/end/GetDC and graphics-state records only. Actual
                # EMF+ paths, images, text or brushes need a separate recorder.
                state_only={0x4001,0x4002,0x4004,0x401e,0x4021,0x4022,0x4024,0x402a,0x4030}
                while pos<at+size:
                    assert at+size-pos>=12
                    record,flags,length,count=struct.unpack_from('<HHII',data,pos)
                    assert length>=12 and length%4==0 and pos+length<=at+size and count==length-12
                    assert record in state_only,'Nested EMF+ drawing commands require separate evidence'
                    pos+=length
        elif kind==86:
            count=struct.unpack_from('<I',data,at+24)[0]
            assert count>=2 and size==28+count*4 and state['brush'] is not None
            assert state['mapMode']==8 and all(state['windowExtent']) and state['viewportExtent'] is not None
            rows.append({'declaredBounds':list(struct.unpack_from('<4i',data,at+8)),
                         'pointCount':count,'pointBytesSha256':sha256(data[at+28:at+size]).hexdigest(),
                         'mapping':deepcopy(state)})
        elif kind==14:eof=True
        elif kind not in [18,19,22,24,84]:
            raise AssertionError(f'Unexpected record {kind}; account for it before making geometry claims')
        at+=size
    assert header and eof and not stack
    return rows

def record(capture_root,output):
    assert not output.exists(),'Refusing to replace existing evidence'
    source=(FOLDER/'control.docx').read_bytes();cases=(FOLDER/'cases.json').read_bytes()
    metadata=json.loads((capture_root/'metadata.json').read_text(encoding='utf-8-sig'))
    assert metadata['sourceSha256']==sha256(source).hexdigest()
    assert metadata['sourceUnchanged'] and metadata['savedBefore'] and metadata['savedAfter']
    authored=json.loads(cases);assert len(metadata['pages'])==len(authored)
    pages=[]
    for number,(case,entry) in enumerate(zip(authored,metadata['pages']),1):
        assert entry['page']==number,'Capture pages must be in authored order'
        data=(capture_root/f'page-{entry["page"]}.emf').read_bytes()
        assert sha256(data).hexdigest()==entry['sha256']
        assert [entry['widthPt'],entry['heightPt']]==[case['pageWidthPt'],case['pageHeightPt']]
        pages.append({'name':case['name'],'page':entry['page'],'metafileSha256':entry['sha256'],'polygons':polygons(data)})
    result={'sourceSha256':sha256(source).hexdigest(),'casesSha256':sha256(cases).hexdigest(),
            'captureMetadataSha256':sha256((capture_root/'metadata.json').read_bytes()).hexdigest(),
            'sourceUnchanged':True,'savedBefore':True,'savedAfter':True,'referenceBuild':metadata['referenceBuild'],
            'scope':'Numeric/hash-only EMR_POLYGON16 declarations and mapping snapshots; not raster equivalence or tile resources',
            'pages':pages}
    with output.open('x',encoding='utf8') as out:out.write(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'pages':len(pages),'polygonCounts':[len(p['polygons']) for p in pages]}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture_root',type=Path);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();record(args.capture_root,args.output)
