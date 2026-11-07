"""Independently specified hidden SEQ controls, using only the standard library."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/sequence-hidden'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
CASES = {
    'hidden': ['', r'\h', '', r'\h \c', '', r'\h \r 10', ''],
    'formatted': ['', r'\h \* roman', r'\* MERGEFORMAT \h', ''],
}


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, switches in CASES.items():
        fields = ''.join(f'<w:p><w:fldSimple w:instr="SEQ Figure {s}"><w:r><w:t>stale</w:t></w:r></w:fldSimple></w:p>' for s in switches)
        parts = {
            '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
            '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
            'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{fields}<w:sectPr/></w:body></w:document>',
        }
        with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as archive:
            for path, data in parts.items():
                info = ZipInfo(path, (2026, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
                archive.writestr(info, data.encode())


if __name__ == '__main__':
    build()
