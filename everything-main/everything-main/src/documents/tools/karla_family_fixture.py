"""Original four-face Karla controls, with no embedded fonts or corpus text."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/karla-family'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def generate():
    OUT.mkdir(parents=True, exist_ok=True)
    paragraphs, cases = [], []
    for label, bold, italic in [('Regular', False, False), ('Bold', True, False), ('Italic', False, True), ('Bold italic', True, True)]:
        for size in [10, 14]:
            for kern in [0, 2]:
                text = f'{label}: AVATAR To Wa, office flowing, café 0123456789.'
                props = '<w:rFonts w:ascii="Karla" w:hAnsi="Karla"/>' + ('<w:b/>' if bold else '') + ('<w:i/>' if italic else '') + f'<w:kern w:val="{kern}"/><w:sz w:val="{size*2}"/>'
                paragraphs.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="120"/><w:jc w:val="right"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
                cases.append(dict(text=text, bold=bold, italic=italic, size=size, kern=kern))
    section = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{"".join(paragraphs)}{section}</w:body></w:document>',
        'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    }
    with ZipFile(OUT / 'control.docx', 'w') as archive:
        for name, xml in parts.items():
            info = ZipInfo(name, (2026, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            archive.writestr(info, xml.encode())
    (OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    generate()
