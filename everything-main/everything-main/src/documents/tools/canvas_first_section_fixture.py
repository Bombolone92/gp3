"""Original first-section probe, authored directly as OPC/XML with stdlib only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import sys

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
parts = {
    '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/></Types>',
    '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>First section origin</w:t></w:r></w:p><w:p><w:r><w:t>Café and Unicode 😀</w:t></w:r></w:p><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
if __name__ == '__main__':
    if len(sys.argv) > 1:
        with ZipFile(sys.argv[1]) as z:
            root = ET.fromstring(z.read('word/document.xml'))
            assert [t.text for t in root.iter(f'{{{W}}}type')] == [None]
            assert root.find(f'{{{W}}}body/{{{W}}}sectPr/{{{W}}}type').get(f'{{{W}}}val') == 'continuous'
            assert ''.join(n.text or '' for n in root.iter(f'{{{W}}}t')) == 'Edited First section originCafé and Unicode 😀'
            assert root.find(f'{{{W}}}body/{{{W}}}sectPr/{{{W}}}pgMar').get(f'{{{W}}}left') == '1440'
        print('PASS first-section browser export:', sys.argv[1])
    else:
        out = Path(__file__).resolve().parents[1] / 'public/fixtures/first-section.docx'
        with ZipFile(out, 'w', ZIP_DEFLATED) as z:
            for name, text in parts.items(): z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + text)
        print(out)
