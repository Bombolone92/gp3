"""Verify vertical origins in the independently authored bundled script controls."""
from pathlib import Path
import json
from record_script_position_metafiles import capture, verify_gdi, sha

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/bundled-script'

def main():
    reference=json.loads((FOLDER/'origin-reference.json').read_text())
    cases=json.loads((FOLDER/'cases.json').read_text())
    assert sha((FOLDER/'control.docx').read_bytes())==reference['sourceSha256']
    assert sha((FOLDER/'cases.json').read_bytes())==reference['casesSha256']
    assert len(cases)==len(reference['cases'])==3
    results=[]
    for case,old in zip(cases,reference['cases'],strict=True):
        data=(FOLDER/old['metafile']).read_bytes()
        assert sha(data)==old['metafileSha256']
        font=(ROOT/'public/fonts'/old['font']).read_bytes()
        assert sha(font)==old['fontSha256']
        native,descriptions=capture(data,case,quantized_frame=True)
        selected=verify_gdi(font,descriptions)
        results.append(dict(case,font=old['font'],fontSha256=sha(font),metafile=old['metafile'],
                            metafileSha256=sha(data),**native,reselectedFontTables=selected))
    out=dict(referenceBuild=reference['referenceBuild'],sourceSha256=reference['sourceSha256'],
             casesSha256=reference['casesSha256'],capture='Range.EnhMetaFileBits',cases=results)
    (FOLDER/'position-reference.json').write_text(json.dumps(out,indent=2)+'\n',newline='\n')
    print('Verified 36 bundled-font native vertical origins')

if __name__=='__main__': main()
