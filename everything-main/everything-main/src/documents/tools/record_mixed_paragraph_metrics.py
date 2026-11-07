"""Verify native transition controls and compare their bounded text baselines."""
from pathlib import Path
import argparse, hashlib, json, math, struct
from inspect_emf_text_records import inspect

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'tests/fixtures/mixed-paragraph-metrics'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def page_mapping(data):
    # These picture controls add clipping, raster playback and saved DCs. None
    # changes the GDI text coordinate mapping. EMF+ graphics are not interpreted
    # as text origins; the text reference uses only EMR_EXTTEXTOUTW records.
    allowed={1,9,10,14,18,21,22,24,30,33,34,37,40,70,76,81,82,84,98}
    offset=0;extent=None;depth=0;header=False
    while offset<len(data):
        kind,size=struct.unpack_from('<II',data,offset)
        assert kind in allowed and size>=8 and size%4==0 and offset+size<=len(data)
        record=data[offset:offset+size]
        if kind==9:
            value=struct.unpack_from('<2i',record,8)
            assert value==(5100,6600) and (extent is None or extent==value)
            extent=value
        elif kind==10:assert struct.unpack_from('<2i',record,8)==(0,0)
        elif kind==22:assert struct.unpack_from('<I',record,8)[0]==24
        elif kind==33:depth+=1
        elif kind==34:
            assert struct.unpack_from('<i',record,8)[0]==-1 and depth>0
            depth-=1
        elif kind==70:
            assert record[12:16]==b'EMF+'
            position=16
            while position<size:
                typ,flags,length,payload=struct.unpack_from('<HHII',record,position)
                assert length>=12 and length%4==0 and position+length<=size and payload==length-12
                if typ==0x4001:
                    assert not header and flags==1 and length==28
                    assert struct.unpack_from('<2I',record,position+20)==(600,600)
                    header=True
                position+=length
        offset+=size
    assert header and extent and depth==0 and struct.unpack_from('<2i',data,24)==(0,0)
    return .12

def record(capture_root):
    meta=json.loads((capture_root/'page-capture.json').read_text(encoding='utf-8-sig'))
    assert meta['sourceSha256']==sha(FIXTURE/'control.docx')
    assert meta['sourceUnchanged'] and meta['savedBefore'] and meta['savedAfter']
    cases=json.loads((FIXTURE/'cases.json').read_text())
    assert len(cases)==len(meta['captures'])==96
    output=[]
    for case,capture in zip(cases,meta['captures'],strict=True):
        assert capture['page']==case['page']+1
        assert capture['file']==f"page-{capture['page']}.emf"
        assert (capture['widthPt'],capture['heightPt'])==(612,792)
        path=capture_root/capture['file']
        assert sha(path)==capture['sha256'] and path.stat().st_size==capture['length']
        data=path.read_bytes();scale=page_mapping(data)
        lines=[r for r in inspect(data,include_italic=True) if r['text'].startswith('Aa')]
        assert [r['text'].strip() for r in lines]==case['labels']
        for line in lines:
            font=line['font']
            assert font['face']==case['family'] and font['weight']==400 and not font['italic']
            assert font['height']==-math.floor(case['size']/scale+.5)
            assert font['width']==font['escapement']==font['orientation']==0
            assert line['options']==4 and line['advanceDimensions']==1
            assert len(line['advances'])==len(line['text'])
        output.append(dict(**case,baselinesPt=[r['logicalOrigin'][1]*scale for r in lines],captureSha256=capture['sha256']))
    return dict(sourceSha256=sha(FIXTURE/'control.docx'),casesSha256=sha(FIXTURE/'cases.json'),
        captureMetadataSha256=sha(capture_root/'page-capture.json'),referenceBuild=meta['referenceBuild'],pages=96,
        readOnly=meta['readOnly'],sourceUnchanged=True,savedBefore=True,savedAfter=True,cases=output,
        scope='Bounded native Page.EnhMetaFileBits text origins; no glyph-raster or universal EMF mapping claim.')

def compare(reference,viewer):
    assert viewer['pages']==96 and len(viewer['lines'])==384
    rows=[]
    for case in reference['cases']:
        lines=[r for r in viewer['lines'] if r['page']==case['page'] and r['text'].lstrip('\ufffc').startswith('Aa')]
        assert [r['text'].lstrip('\ufffc') for r in lines]==case['labels']
        errors=[r['baseline']-n for r,n in zip(lines,case['baselinesPt'],strict=True)]
        relative=[e-errors[0] for e in errors]
        rows.append(dict(**case,errorsPt=errors,relativeErrorsPt=relative,viewerLines=[r for r in viewer['lines'] if r['page']==case['page']]))
    return dict(cases=rows,maxAbsoluteErrorPt=max(abs(e) for r in rows for e in r['errorsPt']),
        maxRelativeErrorPt=max(abs(e) for r in rows for e in r['relativeErrorsPt']))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root',type=Path);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--viewer',type=Path);parser.add_argument('--comparison',type=Path)
    args=parser.parse_args();reference=record(args.capture_root)
    args.output.write_text(json.dumps(reference,indent=2)+'\n')
    if args.viewer:
        result=compare(reference,json.loads(args.viewer.read_text()))
        if args.comparison:args.comparison.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({k:v for k,v in result.items() if k!='cases'}))
        for row in sorted(result['cases'],key=lambda r:max(abs(e) for e in r['relativeErrorsPt']),reverse=True)[:12]:
            print(row['family'],row['size'],row['multiple'],row['transition'],row['errorsPt'],row['relativeErrorsPt'])
