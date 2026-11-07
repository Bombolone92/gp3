"""Verify independently authored mixed-size paragraph-chain native references."""
from pathlib import Path
import argparse,hashlib,json,math
from inspect_emf_text_records import inspect
from audit_font_wrap_device_origins import mapping
ROOT=Path(__file__).resolve().parents[1];FIXTURE=ROOT/'tests/fixtures/mixed-font-chain'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def record(capture_root):
    meta=json.loads((capture_root/'page-capture.json').read_text(encoding='utf-8-sig'))
    assert meta['sourceSha256']==sha(FIXTURE/'control.docx')
    assert meta['sourceUnchanged'] and meta['savedBefore'] and meta['savedAfter']
    cases=json.loads((FIXTURE/'cases.json').read_text());assert len(cases)==len(meta['captures'])==72
    output=[]
    for case,capture in zip(cases,meta['captures'],strict=True):
        assert capture['page']==case['page']+1 and capture['file']==f"page-{capture['page']}.emf"
        assert (capture['widthPt'],capture['heightPt'])==(612,792)
        path=capture_root/capture['file'];assert sha(path)==capture['sha256'] and path.stat().st_size==capture['length']
        data=path.read_bytes();scale=mapping(data,width_pt=612,height_pt=792)
        rows=[r for r in inspect(data,include_italic=True) if r['text'].startswith('Aa')]
        assert [r['text'].strip() for r in rows]==case['labels']
        for row,size in zip(rows,case['sizes'],strict=True):
            f=row['font'];assert f['face']==case['family'] and f['weight']==400 and not f['italic']
            assert f['height']==-math.floor(size/scale+.5)
            assert f['width']==f['escapement']==f['orientation']==0
            assert row['options']==4 and row['advanceDimensions']==1 and len(row['advances'])==len(row['text'])
        output.append(dict(**case,baselinesPt=[r['logicalOrigin'][1]*scale for r in rows],captureSha256=capture['sha256']))
    return dict(sourceSha256=sha(FIXTURE/'control.docx'),casesSha256=sha(FIXTURE/'cases.json'),
        captureMetadataSha256=sha(capture_root/'page-capture.json'),referenceBuild=meta['referenceBuild'],pages=72,labels=720,
        readOnly=meta['readOnly'],sourceUnchanged=True,savedBefore=True,savedAfter=True,cases=output,
        scope='Bounded native GDI label origins on Page.EnhMetaFileBits, not glyph-raster equivalence.')

def compare(reference,viewer):
    assert viewer['pages']==72 and len(viewer['lines'])==1056
    output=[]
    for case in reference['cases']:
        lines=[r for r in viewer['lines'] if r['page']==case['page']]
        fragments=[f for line in lines for f in line['fragments'] if f['text'] and f['text'].startswith('Aa')]
        assert [f['text'] for f in fragments]==case['labels']
        errors=[f['baseline']-n for f,n in zip(fragments,case['baselinesPt'],strict=True)]
        relative=[e-errors[0] for e in errors]
        output.append(dict(**case,errorsPt=errors,relativeErrorsPt=relative,viewerLines=lines))
    return dict(cases=output,maxAbsoluteErrorPt=max(abs(e) for c in output for e in c['errorsPt']),
        maxRelativeErrorPt=max(abs(e) for c in output for e in c['relativeErrorsPt']))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('capture_root',type=Path)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--viewer',type=Path);p.add_argument('--comparison',type=Path)
    a=p.parse_args();reference=record(a.capture_root);a.output.write_text(json.dumps(reference,indent=2)+'\n')
    if a.viewer:
        result=compare(reference,json.loads(a.viewer.read_text()))
        if a.comparison:a.comparison.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({k:v for k,v in result.items() if k!='cases'}))
        for row in sorted(result['cases'],key=lambda c:max(abs(e) for e in c['relativeErrorsPt']),reverse=True)[:12]:
            print(row['family'],row['multiple'],row['emptyCount'],row['markFamily'],row['errorsPt'])
