"""Original temporary-control formatting probe, authored with stdlib OPC/XML.

The native reference retains this temporary rich-text wrapper when only its bold formatting
changes. It removes the wrapper when its text changes (Part 1 17.5.2.43).
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import sys

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='application/vnd.openxmlformats-officedocument.wordprocessingml.'
SOURCE=Path(__file__).resolve().parents[1]/'public/fixtures/temporary-control-formatting.docx'
def p(text): return '<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>'
def generate():
    control='<w:p><w:sdt><w:sdtPr><w:id w:val="41"/><w:temporary/><w:richText/></w:sdtPr><w:sdtEndPr/><w:sdtContent><w:r><w:t>Control alpha</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    parts={
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="'+CT+'document.main+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>'+p('Before block')+control+p('After block')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    }
    with ZipFile(SOURCE,'w',ZIP_DEFLATED) as z:
        for name,xml in parts.items(): z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
    print(SOURCE)
def verify(path):
    ns={'w':W}
    with ZipFile(SOURCE) as before,ZipFile(path) as after:
        assert set(before.namelist())==set(after.namelist())
        for name in before.namelist():
            if name!='word/document.xml': assert before.read(name)==after.read(name),name
        root=ET.fromstring(after.read('word/document.xml'))
    controls=root.findall('.//w:sdt',ns);assert len(controls)==1
    control=controls[0]
    assert control.find('w:sdtPr/w:id',ns).get('{'+W+'}val')=='41'
    assert control.find('w:sdtPr/w:temporary',ns) is not None
    assert control.find('w:sdtPr/w:richText',ns) is not None
    runs=control.findall('w:sdtContent/w:r',ns)
    assert [''.join(r.itertext()) for r in runs]==['Control',' alpha']
    assert runs[0].find('w:rPr/w:b',ns) is not None
    assert runs[1].find('w:rPr/w:b',ns) is None
    assert ''.join(root.itertext())=='Before blockControl alphaAfter block'
    print('PASS independently retained temporary wrapper and changed formatting:',path)
if __name__=='__main__':
    if len(sys.argv)>1:verify(sys.argv[1])
    else:generate()
