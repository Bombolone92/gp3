"""Record native rasters of the six independently authored cubic groups."""
import argparse
import hashlib
import json
import struct
from io import BytesIO
from pathlib import Path
from PIL import Image
from extract_svg_viewport_metafiles import extract

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'tests/fixtures/svg-group-cubic'


def sha(data):return hashlib.sha256(data).hexdigest()


def record(capture_root,fixture=FIXTURE,expected_images=6):
    metadata=json.loads((capture_root/'capture.json').read_text(encoding='utf-8-sig'))
    source=(fixture/'control.docx').read_bytes()
    capture=(capture_root/'capture.emf').read_bytes()
    assert metadata['sourceSha256']==sha(source) and metadata['captureSha256']==sha(capture)
    assert metadata['sourceUnchanged'] and metadata['savedAfter']
    assert metadata['readOnly'] or (metadata.get('captureReadOnly') and metadata.get('savedBefore'))
    assert metadata['pictureIndex']==1
    native=extract(capture)
    (fixture/'capture.emf').write_bytes(capture)
    (fixture/'capture.json').write_bytes((capture_root/'capture.json').read_bytes())
    (fixture/'native.emf').write_bytes(native)
    images=[];transform=[1,0,0,1,0,0];position=0
    while position<len(native):
        kind,size=struct.unpack_from('<II',native,position)
        # The EMF+ stream also carries a GDI bitmap fallback with saved DC
        # state. Extract embedded PNG layers, not fallback bitmap placement.
        assert kind in (1,14,33,34,70,76,98) and size>=8 and position+size<=len(native)
        if kind==70:
            assert native[position+12:position+16]==b'EMF+'
            offset=position+16
            while offset<position+size:
                typ,flags,length,count=struct.unpack_from('<HHII',native,offset)
                assert length>=12 and offset+length<=position+size and count<=length-12
                assert typ in (0x4001,0x4002,0x4008,0x401b,0x401e,0x4021,0x4022,0x402a,0x4030,0x4032,0x4034)
                payload=native[offset+12:offset+12+count]
                if typ==0x402a:transform=list(struct.unpack('<6f',payload))
                elif typ==0x4008:
                    object_type=(flags>>8)&127
                    assert object_type in (1,2,3,4,5,8), 'Unexpected object, including font descriptors'
                    assert not flags&0x8000
                    if object_type==5:
                        assert struct.unpack_from('<II',payload)[1]==1
                        assert payload[28:36]==b'\x89PNG\r\n\x1a\n'
                        png=payload[28:];image=Image.open(BytesIO(png)).convert('RGBA')
                        name=f'native-group-{len(images)+1}.png';(fixture/name).write_bytes(png)
                        images.append(dict(path=name,sha256=sha(png),size=list(image.size),transform=transform))
                offset+=length
        position+=size
    assert len(images)==expected_images
    result=dict(referenceBuild=metadata['referenceBuild'],sourceSha256=sha(source),casesSha256=sha((fixture/'cases.json').read_bytes()),captureSha256=sha(capture),captureMetadataSha256=sha((capture_root/'capture.json').read_bytes()),nativeSha256=sha(native),images=images)
    (fixture/'metafile-reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('capture_root',type=Path)
    parser.add_argument('--fixture',choices=['svg-group-cubic','svg-group-cubic-holdouts','svg-group-opacity-precision','svg-group-opacity-precision-holdouts','svg-group-opacity-precision-cascade','svg-paint-opacity-precision','svg-cubic-terminal-rounding','svg-cubic-step-changes','svg-cubic-step-split','svg-cubic-phase'],default='svg-group-cubic')
    args=parser.parse_args()
    fixture=ROOT/'tests/fixtures'/args.fixture
    print(json.dumps(record(args.capture_root,fixture,len(json.loads((fixture/'cases.json').read_text()))),indent=2))
