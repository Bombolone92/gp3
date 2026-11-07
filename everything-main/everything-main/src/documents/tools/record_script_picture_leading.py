"""Validate native reference range positions and source/capture bindings."""
from pathlib import Path
from hashlib import sha256
import json
from zipfile import ZipFile
from xml.etree import ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/script-picture-leading'
def digest(path):return sha256(path.read_bytes()).hexdigest()
def record(folder=FOLDER):
    cases=json.loads((folder/'cases.json').read_text())
    capture=json.loads((folder/'native-range-capture.json').read_text(encoding='utf-8-sig'))
    assert capture['sourceSha256']==digest(folder/'controls.docx')
    assert len(capture['rows'])==len(cases)==36
    with ZipFile(folder/'controls.docx') as package:
        assert set(package.namelist())=={'[Content_Types].xml','_rels/.rels','word/document.xml','word/_rels/document.xml.rels','word/settings.xml','word/media/red.png'}
        ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
        root=ET.fromstring(package.read('word/document.xml'))
        paragraphs=root.find('w:body',ns).findall('w:p',ns)
        assert len(paragraphs)==108
        for i,case in enumerate(cases):
            p=paragraphs[3*i+1]
            spacing=p.find('w:pPr/w:spacing',ns)
            assert spacing.get('{'+ns['w']+'}line')==str(case['multiple'])
            assert spacing.get('{'+ns['w']+'}lineRule')=='auto'
            drawing=p.find('w:r/w:drawing/..',ns);props=drawing.find('w:rPr',ns)
            assert props.find('w:rFonts',ns).get('{'+ns['w']+'}ascii')==case['family']
            assert props.find('w:vertAlign',ns).get('{'+ns['w']+'}val')==case['script']
            assert props.find('w:sz',ns).get('{'+ns['w']+'}val')==str(case['size']*2)
            extent=drawing.find('w:drawing/wp:inline/wp:extent',ns)
            assert extent.attrib=={'cx':'457200','cy':'914400'}
    rows=[]
    for i,(case,native) in enumerate(zip(cases,capture['rows'])):
        assert native['name']==case['name'] and native['page']==i+1
        assert native['captionTop']==72 and native['pictureTop']==84
        assert native['afterHeight']==12 and native['afterRule']==4
        assert native['imageWidth']==36 and native['imageHeight']==72
        # Range.Information returns quantized line tops, not glyph origins.
        # Exact-line baseline behavior is established by the separate native
        # exact-font-baseline fixture. Keep that mapping and its limit explicit.
        rows.append(dict(**case,after=dict(x=native['afterX'],y=native['afterTop']+9.6),lineTop=native['afterTop']))
    for start in range(0,36,3):
        assert len({r['lineTop'] for r in rows[start:start+3]})==1
    return dict(capture=capture,nativeCaptureSha256=digest(folder/'native-range-capture.json'),casesSha256=digest(folder/'cases.json'),
                coordinateTolerancePt=.8,baselineMapping='12 pt exact line: top + 9.6 pt; independent exact-font-baseline reference control',cases=rows)
def main():
    out=record();(FOLDER/'reference.json').write_text(json.dumps(out,indent=2)+'\n',newline='\n')
    print('Recorded',len(out['cases']),'independent native inline-picture leading cases')
    for font in ['Arial','Trebuchet MS','Garamond']:
        rows=[r for r in out['cases'] if r['family']==font and not r['mixed'] and r['multiple']==259]
        print(font,[(r['script'],r['after']['y']) for r in rows])
if __name__=='__main__':main()
