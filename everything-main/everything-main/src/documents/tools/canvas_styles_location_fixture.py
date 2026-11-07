"""Original minimal OPC fixture; no document engine or third-party assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
from xml.etree import ElementTree as ET

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'

parts = {
    '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/format/styles2.xml" ContentType="{CT}styles+xml"/></Types>',
    '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="../format/styles2.xml"/></Relationships>',
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body><w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>Relationship based styles</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Styled cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
    'format/styles2.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/><w:rPr><w:i/></w:rPr><w:tcPr><w:shd w:val="clear" w:fill="DDEEFF"/></w:tcPr></w:style></w:styles>',
}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        with ZipFile(sys.argv[1]) as archive:
            assert set(archive.namelist()) == set(parts), 'Package part names changed'
            relationships = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
            assert len(relationships) == 1
            assert relationships[0].get('Target') == '../format/styles2.xml'
            styles = ET.fromstring(archive.read('format/styles2.xml'))
            body = styles.find(f'{{{W}}}style[@{{{W}}}styleId="Body"]')
            assert body.find(f'{{{W}}}rPr/{{{W}}}sz').get(f'{{{W}}}val') == '42'
            assert body.find(f'{{{W}}}rPr/{{{W}}}b') is not None
            grid = styles.find(f'{{{W}}}style[@{{{W}}}styleId="Grid"]')
            assert grid.find(f'{{{W}}}rPr/{{{W}}}i') is not None
            document = ET.fromstring(archive.read('word/document.xml'))
            assert [n.text for n in document.iter(f'{{{W}}}t')] == ['Relationship based styles', 'Styled cell']
        print('PASS relocated styles browser export:', sys.argv[1])
        sys.exit(0)
    target = Path(__file__).resolve().parents[1] / 'public/fixtures/styles-location.docx'
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for name, value in parts.items():
            archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + value)
    print(target)
