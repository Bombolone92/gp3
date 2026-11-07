"""Bind read-only native floating-table metadata to the unchanged dense source."""
from pathlib import Path
import argparse, json
from record_border_dense_phase import sha

def record(capture,folder):
    source=(folder/'control.docx').read_bytes()
    assert source==(capture/'border-dense-phase-owned-20261002.docx').read_bytes(), 'Source changed'
    cases_bytes=(folder/'cases.json').read_bytes()
    cases=json.loads(cases_bytes)
    raw=(capture/'table-metadata.json').read_bytes()
    metadata=json.loads(raw.decode('utf-8-sig'))
    assert metadata['savedBefore'] and metadata['savedAfter'] and metadata['characters']==''
    assert metadata['referenceBuild']=='16.0.20326' and len(metadata['tables'])==len(cases)==60
    observations=[]
    for native,c in zip(metadata['tables'],cases):
        assert native['id']==c['id'] and native['heightRule']==2 and native['wrapAround']==-1
        dx,dy=round(native['xPt']*20-c['xTwips'],5),round(native['yPt']*20-c['yTwips'],5)
        assert dx==dy==-1 and native['heightPt']*20==c['heightTwips']
        observations.append(dict(id=c['id'],xDeltaTwips=dx,yDeltaTwips=dy,heightPt=native['heightPt']))
    (folder/'native-table-metadata.json').write_bytes(raw)
    reference=dict(sourceSha256=sha(source),casesSha256=sha(cases_bytes),metadataSha256=sha(raw),
                   referenceBuild=metadata['referenceBuild'],sourceUnchanged=True,observations=observations,
                   scope='Read-only reference Rows.HorizontalPosition, VerticalPosition, Height, HeightRule and WrapAroundText.',
                   limits=['COM getter coordinates are not proof of visual border coordinates.',
                           'Only one border width and exact row height measured; no general layout correction inferred.',
                           'Exact owned empty source closed without saving; source bytes compared after close.'])
    (folder/'native-table-metadata-reference.json').write_text(json.dumps(reference,indent=2)+'\n')
    print('Verified sixty native positions: -1 twip on both axes; exact six-point height retained')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-dense-phase')
    args=parser.parse_args();record(args.capture,args.output)
