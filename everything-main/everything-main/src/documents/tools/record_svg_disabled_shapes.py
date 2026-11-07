"""Record the single native cached bitmap in the owned empty-shape control.

This is a read-only Range.EnhMetaFileBits reference, not PDF-derived pixels.
The caller must have confirmed the exact source visible and Saved in the reference application.
"""
from pathlib import Path
from hashlib import sha256
from io import BytesIO
import argparse,json,struct
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/svg-disabled-shapes'

def cached_png(capture):
    position=0;images=[]
    while position<len(capture):
        kind,size=struct.unpack_from('<II',capture,position)
        assert size>=8 and position+size<=len(capture)
        if kind==70 and capture[position+12:position+16]==b'EMF+':
            at=position+16
            while at<position+size:
                kind,flags,length,count=struct.unpack_from('<HHII',capture,at)
                assert length>=12 and at+length<=position+size and count<=length-12
                if kind==0x4008 and flags>>8&127==5:
                    assert not flags&0x8000,'Unexpected continued image'
                    payload=capture[at+12:at+12+count]
                    _,image_type=struct.unpack_from('<II',payload)
                    assert image_type==1 and payload[28:36]==b'\x89PNG\r\n\x1a\n'
                    images.append(payload[28:])
                at+=length
        position+=size
    assert len(images)==1
    return images[0]

def record(capture_root,folder):
    metadata_bytes=(capture_root/'capture.json').read_bytes()
    metadata=json.loads(metadata_bytes.decode('utf-8-sig'))
    capture=(capture_root/'capture.emf').read_bytes()
    source_hash=sha256((ROOT/'public/fixtures/svg-disabled-shapes.docx').read_bytes()).hexdigest()
    assert metadata['sourceSha256']==source_hash
    assert metadata['captureSha256']==sha256(capture).hexdigest()
    assert metadata['pictureIndex']==1
    assert all(metadata.get(key) is True for key in ['sourceUnchanged','savedBefore','savedAfter','captureReadOnly'])
    png=cached_png(capture);im=Image.open(BytesIO(png)).convert('RGBA')
    assert im.size==(900,600)
    boxes=[[0,(8+i*18)*6-6,900,(8+i*18)*6+18] for i in range(4)]
    crops=[im.crop(box).tobytes() for box in boxes]
    assert all(c==crops[0] for c in crops)
    assert any(v<255 for i,v in enumerate(crops[0]) if i%4!=3)
    record={'referenceBuild':metadata['referenceBuild'],'sourceSha256':source_hash,
            'captureSha256':sha256(capture).hexdigest(),'pngSha256':sha256(png).hexdigest(),
            'captureMetadataSha256':sha256(metadata_bytes).hexdigest(),
            'size':list(im.size),'rows':[{'box':b,'rgbaSha256':sha256(c).hexdigest()} for b,c in zip(boxes,crops)],
            'sourceUnchanged':True,'savedBefore':True,'savedAfter':True,'captureReadOnly':True,
            'method':'Exact visible Saved owned source; read-only first inline range metafile; native cached PNG extracted without raster conversion. No source save.'}
    # Preserve already captured evidence; use a fresh destination for recording.
    assert not folder.exists() or folder.is_dir() and not any(folder.iterdir()),'Use a fresh or empty output directory'
    folder.mkdir(parents=True,exist_ok=True)
    for name,data in [('capture.emf',capture),('capture.json',metadata_bytes),('native-cached.png',png),('reference.json',(json.dumps(record,indent=2)+'\n').encode())]:
        with (folder/name).open('xb') as out:out.write(data)
    print('Recorded four byte-identical native rows')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root',type=Path)
    parser.add_argument('--output-folder',type=Path,required=True)
    args=parser.parse_args();record(args.capture_root,args.output_folder)
