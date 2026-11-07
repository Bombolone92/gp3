"""Record raw PATCOPY destinations from owned textless reference page metafiles.

These are reference-grid operations, not PDF or live-screen pixel coordinates.
No text, font programs, bitmap programs or source artwork is copied.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import struct
from zipfile import ZipFile
from xml.etree import ElementTree as ET


def rectangles(data, frame_count=1):
    assert isinstance(frame_count,int) and not isinstance(frame_count,bool) and frame_count>0
    position=0;brushes={};brush=None;stack=[];clips=[];fills=[];window=None
    bounds=None;frame=None
    while position<len(data):
        kind,size=struct.unpack_from('<II',data,position)
        assert size>=8 and size%4==0 and position+size<=len(data)
        if kind==1:
            assert position==0 and size>=88
            bounds=struct.unpack_from('<4i',data,position+8)
            frame=struct.unpack_from('<4i',data,position+24)
        elif kind==9: window=struct.unpack_from('<2i',data,position+8)
        elif kind==10: assert struct.unpack_from('<2i',data,position+8)==(0,0)
        elif kind in (11,12,35,36): raise AssertionError('Nonidentity mapping needs explicit recording')
        elif kind==33: stack.append((brush,list(clips)))
        elif kind==34:
            assert struct.unpack_from('<i',data,position+8)[0]==-1
            brush,clips=stack.pop()
        elif kind==30: clips.append(list(struct.unpack_from('<4i',data,position+8)))
        elif kind==39:
            handle,style,color,hatch=struct.unpack_from('<4I',data,position+8)
            assert style==hatch==0
            assert color>>24 in (0,2), 'Palette-index color needs explicit decoding'
            brushes[handle]=color&0xffffff
        elif kind==37:
            handle=struct.unpack_from('<I',data,position+8)[0]
            if handle in brushes: brush=brushes[handle]
            elif 0x80000000<=handle<=0x80000005: brush=None
        elif kind==40: brushes.pop(struct.unpack_from('<I',data,position+8)[0],None)
        elif kind==76:
            x,y,width,height,rop=struct.unpack_from('<4iI',data,position+24)
            assert rop==0x00f00021 and brush is not None and width>0 and height>0
            fills.append({'colorRef':brush,'destination':[x,y,width,height],'clips':list(clips)})
        # Record state/text are deliberately not a text or ink reference.
        elif kind not in (13,14,18,22,24,25,70,82,84):
            raise AssertionError(f'Unexpected record {kind}; account for it explicitly')
        position+=size
    assert not stack and bounds is not None and frame is not None and window is not None
    borders=[item for item in fills if item['colorRef']==0x917f6d]
    assert len(borders)==12*frame_count and all(not item['clips'] for item in borders)
    return {'windowExtent':window,'headerBounds':bounds,'frameHundredthsMm':frame,'fills':fills}


def record(capture,fixture,flowing=False):
    metadata=json.loads((capture/'metadata.json').read_text(encoding='utf-8-sig'))
    digest=lambda path:sha256(path.read_bytes()).hexdigest()
    source=fixture/'control.docx'
    assert metadata['sourceUnchanged'] and metadata['savedAfter']
    assert metadata['sourceSha256']==digest(source)
    with ZipFile(source) as package:
        document=ET.fromstring(package.read('word/document.xml'))
        assert all(not (node.text or '').strip() for node in document.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
    cases=json.loads((fixture/'cases.json').read_bytes())
    if flowing:
        assert len(metadata['pages'])==1
        w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        assert len(list(document.iter(w+'tbl')))==len(cases)
        sections=list(document.iter(w+'sectPr'))
        assert len(sections)==1
        size=sections[0].find(w+'pgSz')
        page_cases=[{'pageWidthPt':int(size.get(w+'w'))/20,
                     'pageHeightPt':int(size.get(w+'h'))/20}]
    else:
        assert len(cases)==len(metadata['pages'])
        page_cases=cases
        if any('pageWidthPt' not in case or 'pageHeightPt' not in case for case in cases):
            # Older exact-row controls keep paper dimensions in each authored
            # section rather than duplicating them in the case list.
            w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
            sections=list(document.iter(w+'sectPr'))
            assert len(sections)==len(cases)
            page_cases=[]
            for case,section in zip(cases,sections):
                size=section.find(w+'pgSz')
                dimensions={'pageWidthPt':int(size.get(w+'w'))/20,
                            'pageHeightPt':int(size.get(w+'h'))/20}
                assert all(key not in case or case[key]==value for key,value in dimensions.items())
                page_cases.append(dict(case,**dimensions))
    pages=[]
    for index,(case,page) in enumerate(zip(page_cases,metadata['pages'])):
        native=capture/f'page-{index+1}.emf'
        assert page['page']==index+1 and digest(native)==page['sha256']
        assert page['widthPt']==case['pageWidthPt'] and page['heightPt']==case['pageHeightPt']
        result=rectangles(native.read_bytes(),len(cases) if flowing else 1)
        assert all(abs(value/extent-.12)<1e-9 for value,extent in zip([case['pageWidthPt'],case['pageHeightPt']],result['windowExtent']))
        pages.append(dict(**page,**result))
    assert digest(source)==metadata['sourceSha256']
    reference={'sourceSha256':metadata['sourceSha256'],'casesSha256':digest(fixture/'cases.json'),
        'referenceBuild':metadata['referenceBuild'],'sourceUnchanged':True,
        'scope':'Raw native page metafile PATCOPY destinations and active rectangular clips at the 600dpi reference grid; not PDF or live-screen coordinates',
        'pages':pages}
    (fixture/'native-metafile-rectangles.json').write_bytes((json.dumps(reference,indent=2)+'\n').encode())
    return reference


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture',type=Path)
    parser.add_argument('fixture',type=Path)
    parser.add_argument('--flowing',action='store_true',help='One-page textless controls with twelve blue rectangles per table')
    args=parser.parse_args()
    result=record(args.capture,args.fixture,args.flowing)
    print(f"Recorded {len(result['pages'])} native page operation lists; source unchanged")
