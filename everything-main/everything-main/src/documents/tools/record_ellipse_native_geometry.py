"""Read authored reference EMF geometry; never infer display coverage from a PDF PNG."""
from pathlib import Path
from hashlib import sha256
import argparse, json, struct

def geometry(data):
    position=0;scale=1;stack=[];pen=None;paths=[];window=None
    while position<len(data):
        kind,size=struct.unpack_from('<II',data,position)
        assert size>=8 and position+size<=len(data)
        if kind==9:window=struct.unpack_from('<2i',data,position+8)
        elif kind==10:assert struct.unpack_from('<2i',data,position+8)==(0,0)
        elif kind in (11,12,35):raise AssertionError('Unsupported mapping/transform')
        elif kind==33:stack.append((scale,pen))
        elif kind==34:
            assert struct.unpack_from('<i',data,position+8)[0]==-1
            scale,pen=stack.pop()
        elif kind==36:
            a,b,c,d,e,f,mode=struct.unpack_from('<6fI',data,position+8)
            assert b==c==e==f==0 and a==d and mode==2
            scale*=a
        elif kind==95:
            style,width=struct.unpack_from('<II',data,position+28)
            assert style==66048
            pen=width*scale
        elif kind==85:
            count=struct.unpack_from('<I',data,position+24)[0]
            assert count==13 and size==28+4*count
            points=[tuple(v*scale for v in struct.unpack_from('<2h',data,position+28+4*i)) for i in range(count)]
            assert points[0]==points[-1] and pen is not None
            xs,ys=zip(*points)
            paths.append(dict(points=points,pen=pen,bounds=[min(xs),min(ys),max(xs),max(ys)]))
        elif kind in (2,3,4,5,6,7,8,42,43,44,45,46,47,54,55,56,83,86,87,88,89,90,91,92):
            raise AssertionError('Unsupported path record')
        position+=size
    assert not stack and window==(2400,1800) and len(paths)==16
    return dict(windowExtent=window,paths=paths)

def record(capture,fixture):
    meta=json.loads((capture/'page-capture.json').read_text(encoding='utf-8-sig'))
    source=fixture/'control.docx';native=(capture/'page-1.emf').read_bytes()
    digest=lambda b:sha256(b).hexdigest()
    assert meta['sourceUnchanged'] and meta['savedAfter'] and meta['savedBefore']
    assert meta['sourceSha256']==digest(source.read_bytes())
    assert meta['captures'][0]['sha256']==digest(native)
    result=geometry(native)
    result.update(sourceSha256=meta['sourceSha256'],nativeSha256=digest(native),referenceBuild=meta['referenceBuild'],
                  sourceUnchanged=True,captureReadOnly=True,
                  scope='Native page metafile geometry at its reference grid; not live screen pixels or a browser match.')
    (fixture/'native.emf').write_bytes(native)
    (fixture/'reference.json').write_bytes((json.dumps(result,indent=2)+'\n').encode())
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture',type=Path);parser.add_argument('fixture',type=Path)
    args=parser.parse_args();result=record(args.capture,args.fixture)
    print(json.dumps(dict(paths=len(result['paths']),sourceUnchanged=result['sourceUnchanged'],nativeSha256=result['nativeSha256'])))
