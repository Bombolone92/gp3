"""Independently authored OOXML control for native text-advance diagnostics.

No imported document, font program, image, or third-party engine is used.
"""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
TEXT = 'A calm morning brought clear skies. We walked along the river, counted the boats, and returned before the afternoon rain.'
CASES = [('Franklin Gothic Book', 10, False), ('Franklin Gothic Book', 10, True),
         ('Franklin Gothic Book', 11, False), ('Franklin Gothic Book', 12, False),
         ('Arial', 10, False), ('Noto Sans', 10, False)]


def fixture():
    paragraphs = []
    for family, size, split in CASES:
        chunks = TEXT.split(' ') if split else [TEXT]
        if split:
            chunks = [c + (' ' if i < len(chunks) - 1 else '') for i, c in enumerate(chunks)]
        properties = (f'<w:rPr><w:rFonts w:ascii="{family}" w:hAnsi="{family}"/>'
                      f'<w:sz w:val="{size * 2}"/><w:kern w:val="0"/></w:rPr>')
        runs = ''.join(f'<w:r>{properties}<w:t xml:space="preserve">{escape(c)}</w:t></w:r>' for c in chunks)
        paragraphs.append('<w:p><w:pPr><w:spacing w:before="0" w:after="240" '
                          'w:line="400" w:lineRule="exact"/></w:pPr>' + runs + '</w:p>')
    return {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{R}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{"".join(paragraphs)}<w:sectPr>'
        '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" '
        'w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>'
        '</w:sectPr></w:body></w:document>',
    }


def write_fixture(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, data in fixture().items():
            info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data.encode('utf-8'))


if __name__ == '__main__':
    write_fixture(Path(__file__).resolve().parents[1] / 'tests/fixtures/text-advance-control/control.docx')
