"""Original block-level bookmark fixtures, authored directly with stdlib OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import sys

ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS={'w':W}
def p(text):return '<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>'
START='<w:bookmarkStart w:id="7" w:name="WholeBlock"/>'
END='<w:bookmarkEnd w:id="7"/>'
def control(contents):return '<w:sdt><w:sdtPr><w:id w:val="41"/><w:temporary/><w:richText/></w:sdtPr><w:sdtEndPr/><w:sdtContent>'+contents+'</w:sdtContent></w:sdt>'
def table(contents):return '<w:tbl><w:tblPr><w:tblW w:w="5760" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5760"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="5760" w:type="dxa"/></w:tcPr>'+contents+'</w:tc></w:tr></w:tbl>'
def generate():
    for location in ['body','cell','table','final','merged']:
        contents=p('Control alpha')+p('Control beta')
        middle=control(START+contents+END)
        if location in ['cell','merged']:middle=table(p('Before cell control')+middle+p('After cell control'))
        if location=='merged':
            middle=middle.replace('<w:gridCol w:w="5760"/>','<w:gridCol w:w="1440"/><w:gridCol w:w="4320"/>').replace('<w:tcW w:w="5760"','<w:tcW w:w="4320"')
            middle=middle.replace('<w:tr>','<w:tr><w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/></w:tcPr>'+p('First cell')+'</w:tc>')
        if location=='table':middle=START+table(p('Before cell control')+control(contents)+p('After cell control'))+END
        body=p('Before block')+middle+('' if location=='final' else p('After block'))
        parts={
            '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
            '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
            'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
        }
        path=ROOT/'public'/'fixtures'/f'block-bookmark-{location}.docx'
        with ZipFile(path,'w',ZIP_DEFLATED) as archive:
            for name,xml in parts.items():archive.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
        print(path)

def verify(path):
    location=path.stem.removeprefix('block-bookmark-')
    assert location in ['body','cell','final','merged'], 'Expected an editing acceptance export'
    with ZipFile(ROOT/'public'/'fixtures'/path.name) as source,ZipFile(path) as exported:
        assert set(source.namelist())==set(exported.namelist())
        for name in source.namelist():
            if name!='word/document.xml':assert source.read(name)==exported.read(name),name
        root=ET.fromstring(exported.read('word/document.xml'))
    controls=root.findall('.//w:sdt',NS)
    assert len(controls)==(1 if location=='merged' else 0)
    if location=='merged':
        assert len(root.findall('.//w:tc',NS))==1
        assert root.find('.//w:gridSpan',NS).get('{'+W+'}val')=='2'
    text=[];markers={}
    def visit(node):
        local=node.tag.rsplit('}',1)[-1]
        if local in ['bookmarkStart','bookmarkEnd']:
            key=(node.get('{'+W+'}id'),local)
            assert key not in markers
            markers[key]=len(''.join(text))
            if local=='bookmarkStart':assert node.get('{'+W+'}name')=='WholeBlock'
        if local=='t':text.append(node.text or '')
        for child in node:visit(child)
        if local=='p':text.append('\n')
    visit(root.find('w:body',NS))
    assert set(markers)=={('7','bookmarkStart'),('7','bookmarkEnd')}
    start,end=markers['7','bookmarkStart'],markers['7','bookmarkEnd']
    assert ''.join(text)[start:end]==('Control alpha\nControl beta\n' if location=='merged' else 'CoXntrol alpha\nControl beta\n')
    print('PASS independent paragraph-break range, wrapper removal and unrelated parts:',path)

if __name__=='__main__':
    if sys.argv[1:]==['--check-exports']:
        for location in ['body','cell','merged']:
            paths=list((ROOT/'test-results').glob(f'block-bookmarks-*/block-bookmark-{location}.docx'))
            assert paths, f'Missing browser bookmark export: {location}'
            for path in paths:verify(path)
    elif len(sys.argv)>1:verify(Path(sys.argv[1]))
    else:generate()
