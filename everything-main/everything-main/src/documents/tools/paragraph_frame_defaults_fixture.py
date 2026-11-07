"""Original minimal OOXML, independent of the editor's serializer."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'tests/fixtures/frame-default-compatibility'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'

CASES = [
    ('missing-horizontal', dict(vAnchor='page', x='0', y='1440')),
    ('missing-vertical', dict(hAnchor='page', x='2880', y='0')),
    ('missing-both', dict(x='0', y='0')),
    ('minimum-height', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', h='1440', wrap='notBeside')),
    ('explicit-auto', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', h='1440', hRule='auto', wrap='notBeside')),
    ('explicit-minimum', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', h='1440', hRule='atLeast', wrap='notBeside')),
    ('zero-exact', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', h='0', hRule='exact', wrap='notBeside')),
    ('zero-minimum', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', h='0', hRule='atLeast', wrap='notBeside')),
    ('short-minimum', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', h='120', wrap='notBeside')),
    ('absent-exact', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', hRule='exact', wrap='notBeside')),
    ('absent-minimum', dict(hAnchor='page', vAnchor='page', x='2880', y='1440', hRule='atLeast', wrap='notBeside')),
    ('absent-exact-narrow', dict(w='1440', hAnchor='page', vAnchor='page', x='2880', y='1440', hRule='exact', wrap='notBeside')),
    ('absent-minimum-wide', dict(w='3600', hAnchor='page', vAnchor='page', x='2880', y='1440', hRule='atLeast', wrap='notBeside')),
    ('zero-width-absent-exact', dict(w='0', hAnchor='page', vAnchor='page', x='2880', y='1440', hRule='exact', wrap='notBeside')),
    ('auto-width-absent-minimum', dict(w=None, hAnchor='page', vAnchor='page', x='2880', y='1440', hRule='atLeast', wrap='notBeside')),
]

def paragraph(text, properties=''):
    return f'<w:p><w:pPr>{properties}<w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'

def main():
    TARGET.mkdir(exist_ok=True)
    for name, overrides in CASES:
        attrs = {key: value for key, value in (dict(w='2400', wrap='none') | overrides).items() if value is not None}
        frame = '<w:framePr ' + ' '.join(f'w:{key}="{value}"' for key, value in attrs.items()) + '/>'
        body = paragraph('Before frame') + paragraph('Framed first line', frame) + paragraph('After frame')
        body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
        parts = {
            '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
            '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="document" Type="{OFFICE}officeDocument" Target="word/document.xml"/></Relationships>',
            'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{OFFICE}styles" Target="styles.xml"/></Relationships>',
            'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>',
            'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults></w:styles>',
        }
        parts = {part: value.encode() for part, value in parts.items()}
        path = TARGET / (name + '.docx')
        if path.exists():
            with ZipFile(path) as package:
                if {part: package.read(part) for part in package.namelist()} == parts:
                    continue
        with ZipFile(path, 'w', ZIP_DEFLATED) as package:
            for part, value in parts.items():
                package.writestr(part, value)
    (TARGET / 'cases.json').write_text(json.dumps(dict(CASES), indent=2) + '\n')
    print(f'Generated {len(CASES)} independent paragraph-frame default controls')

if __name__ == '__main__':
    main()
