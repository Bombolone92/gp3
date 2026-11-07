"""Author independent font-embedding controls from reviewed OFL font assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/embedded-fonts'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
KEY = '{00112233-4455-6677-8899-AABBCCDDEEFF}'
FORMS = [('Regular', 'SourceSansPro-Regular.ttf', ''), ('Bold', 'SourceSansPro-Bold.ttf', '<w:b/>'),
         ('Italic', 'SourceSansPro-It.ttf', '<w:i/>'), ('BoldItalic', 'SourceSansPro-BoldIt.ttf', '<w:b/><w:i/>')]

def build(case, family, files, raw=False, empty_bold=False):
    parts, embeds, rels, body = {}, [], [], []
    for index, (form, file, style) in enumerate(files):
        data = bytearray((ROOT / 'public/fonts' / file).read_bytes())
        key = '{00000000-0000-0000-0000-000000000000}' if raw else KEY
        if not raw:
            octets = bytes.fromhex(KEY.strip('{}').replace('-', ''))[::-1]
            for i in range(32): data[i] ^= octets[i % 16]
        if empty_bold and form == 'Bold': data = bytearray()
        path = f'fonts/face{index}.{"ttf" if raw else "odttf"}'
        parts['word/' + path] = data
        embeds.append(f'<w:embed{form} r:id="font{index}" w:fontKey="{key}" w:subsetted="false"/>')
        rels.append(f'<Relationship Id="font{index}" Type="{R}/font" Target="{path}"/>')
    for n, (_, _, style) in enumerate(FORMS):
        text = f'{n+1} Hamburg AVATAR office Wide iii WWW 0123456789'
        body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{escape(family)}" w:hAnsi="{escape(family)}"/>{style}<w:sz w:val="28"/></w:rPr><w:t>{text}</w:t></w:r></w:p>')
    parts.update({
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Default Extension="ttf" ContentType="application/x-font-ttf"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{P}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{P}"><Relationship Id="fonts" Type="{R}/fontTable" Target="fontTable.xml"/></Relationships>',
        'word/fontTable.xml': f'<w:fonts xmlns:w="{W}" xmlns:r="{R}"><w:font w:name="{escape(family)}"><w:altName w:val="Courier New"/>{"".join(embeds)}</w:font></w:fonts>',
        'word/_rels/fontTable.xml.rels': f'<Relationships xmlns="{P}">{"".join(rels)}</Relationships>',
    })
    with ZipFile(OUT / f'{case}.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data.encode() if isinstance(data, str) else data)

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    build('four-faces', 'Codex Embedded Fixture', FORMS)
    build('installed-name', 'Arial', FORMS)
    build('second-family', 'Codex Embedded Fixture', [('Regular', 'BebasNeue-Regular.ttf', '')])
    build('empty-bold', 'Codex Embedded Fixture', FORMS[:2], empty_bold=True)
    build('raw-font', 'Codex Embedded Fixture', FORMS, raw=True)
