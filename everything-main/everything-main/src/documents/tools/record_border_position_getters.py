"""Separate native COM getter values from the reference application's retained OOXML positions."""
from pathlib import Path
import argparse, json
from record_border_dense_phase import sha

def record(capture,folder):
    folder.mkdir(parents=True,exist_ok=True)
    sources=[]
    for name,fixture in [('axis','border-axis-phase'),('dense','border-dense-phase')]:
        source_folder=Path(__file__).resolve().parents[1]/'tests/fixtures'/fixture
        source=(source_folder/'control.docx').read_bytes()
        assert source==(capture/f'border-{name}-position-owned-20261002.docx').read_bytes()
        cases_bytes=(source_folder/'cases.json').read_bytes()
        cases=json.loads(cases_bytes)
        raw=(capture/f'{name}-metadata.json').read_bytes()
        metadata=json.loads(raw.decode('utf-8-sig'))
        assert metadata['sourceUnchanged'] and metadata['sourceSha256']==sha(source)
        assert metadata['savedBefore'] and metadata['savedAfter'] and metadata['characters']==''
        assert metadata['referenceBuild']=='16.0.20326' and len(metadata['tables'])==len(cases)
        for i,(native,c) in enumerate(zip(metadata['tables'],cases)):
            assert native['id']==i+1 and native['heightRule']==2 and native['wrapAround']==-1
            assert round(native['heightPt']*20-c['heightTwips'],5)==0
            assert round(native['xPt']*20-c['xTwips'],5)==-1
            assert round(native['yPt']*20-c['yTwips'],5)==-1
            assert int(native['memoryXTwips'])==c['xTwips'] and int(native['memoryYTwips'])==c['yTwips']
        file=f'native-{name}-metadata.json';(folder/file).write_bytes(raw)
        sources.append(dict(name=name,source=f'../{fixture}/control.docx',sourceSha256=sha(source),
                            cases=f'../{fixture}/cases.json',casesSha256=sha(cases_bytes),
                            metadata=file,metadataSha256=sha(raw),tables=len(cases)))
    result=dict(referenceBuild='16.0.20326',sources=sources,
                scope='188 read-only Rows position/height getters paired with WordOpenXML coordinates from unchanged originals.',
                limits=['Getter offsets do not justify changing logical OOXML coordinates.',
                        'Only empty, zero-margin single-cell floating tables with exact heights measured.',
                        'Borders 0.25 and 2.25 points; heights 6, 23.65, 23.95, 24.05 and 24.35 points.',
                        'No source save or view setter; only exact owned unchanged sources closed without saving.'])
    (folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Verified 188 native getter/XML pairs: getter -1 twip; memory XML unchanged; exact heights unchanged')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('capture',type=Path)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/border-position-getters')
    args=parser.parse_args();record(args.capture,args.output)
