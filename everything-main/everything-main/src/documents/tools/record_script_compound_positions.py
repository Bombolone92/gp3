"""Validate the original script/small-cap source and bounded native capture."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import json,struct
from record_script_position_metafiles import capture,verify_gdi,sha
from script_vdmx_fixture import tables,checksum

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/script-compound-position'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def main():
    cases=json.loads((FOLDER/'cases.json').read_text());assert len(cases)==1
    case=cases[0];fonts=json.loads((FOLDER/'fonts.json').read_text())
    assert fonts==[case['family'].replace(' ','')+'.ttf']
    font=(FOLDER/fonts[0]).read_bytes();original=tables((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes());current=tables(font)
    assert checksum(font)==0xb1b0afba and set(current)==set(original)-{b'DSIG'}
    os2=bytearray(original[b'OS/2']);struct.pack_into('>h',os2,20,650);assert current[b'OS/2']==os2
    for tag in original:
        if tag not in [b'OS/2',b'name',b'head',b'DSIG']:assert current[tag]==original[tag]
    assert current[b'head'][:8]==original[b'head'][:8] and current[b'head'][12:]==original[b'head'][12:]
    with ZipFile(FOLDER/'controls.docx') as package:
        assert set(package.namelist())=={'[Content_Types].xml','_rels/.rels','word/document.xml'}
        paragraphs=ET.fromstring(package.read('word/document.xml')).find(W+'body').findall(W+'p')
    assert len(paragraphs)==len(case['rows'])+1 and ''.join(paragraphs[0].itertext())==case['family']
    for paragraph,row in zip(paragraphs[1:],case['rows'],strict=True):
        runs=paragraph.findall(W+'r');assert len(runs)==3
        assert [r.find(W+'t').text for r in runs]==['START ','test' if row['smallCaps'] else 'TEST',' END']
        for i,run in enumerate(runs):
            props=run.find(W+'rPr');assert props.find(W+'rFonts').attrib=={W+'ascii':case['family'],W+'hAnsi':case['family']}
            assert props.find(W+'sz').get(W+'val')==str(row['size']*2)
            assert (props.find(W+'smallCaps') is not None)==(i==1 and row['smallCaps'])
            assert (props.find(W+'vertAlign') is None) if i!=1 else props.find(W+'vertAlign').get(W+'val')==row['script']
    provenance=json.loads((FOLDER/'native-capture.json').read_text(encoding='utf-8-sig'))
    assert provenance['sourceUnchanged'] and provenance['readOnly'] and provenance['sourceSha256']==sha((FOLDER/'controls.docx').read_bytes())
    assert set(provenance['captures'])=={'native-font-1.emf'}
    data=(FOLDER/'native-font-1.emf').read_bytes();assert sha(data)==provenance['captures']['native-font-1.emf']
    native,descriptions=capture(data,case,quantized_frame=True)
    selected=verify_gdi(font,descriptions)
    for i in [0,4]:
        assert [r['risePt'] for r in native['rows'][i:i+2]]==[r['risePt'] for r in native['rows'][i+2:i+4]]
    names=['controls.docx','cases.json','fonts.json','native-capture.json','native-font-1.emf',fonts[0]]
    out=dict(referenceBuild=provenance['referenceBuild'],hashes={n:sha((FOLDER/n).read_bytes()) for n in names},
             baseFontSha256=sha((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes()),cases=[dict(case,**native,reselectedFontTables=selected)])
    (FOLDER/'reference.json').write_text(json.dumps(out,indent=2)+'\n',newline='\n')
    print('Verified eight compound script positions and unchanged baseline under small caps')
if __name__=='__main__':main()
