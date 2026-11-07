"""Original source and expected-cache controls for REF field refresh."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/reference-fields'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    for expected in [False, True]:
        def field(switches, value):
            text = value if expected else 'cache'
            return f'<w:p><w:fldSimple w:instr="REF Target {switches}"><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:fldSimple></w:p>'
        body = field(r'\p', 'below')
        body += '<w:p><w:bookmarkStart w:id="1" w:name="Target"/><w:r><w:t xml:space="preserve">  source text  </w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
        body += field('', '  source text  ') + field(r'\p', 'above') + field(r'\n', 'cache')
        parts = {
            '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
            '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
            'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr/></w:body></w:document>',
        }
        with ZipFile(OUT / ('expected.docx' if expected else 'source.docx'), 'w', ZIP_DEFLATED) as archive:
            for name, text in parts.items():
                info = ZipInfo(name, (2026, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
                archive.writestr(info, text.encode())


if __name__ == '__main__':
    build()
