"""Original controls isolating U+2028 font slots, hints and East Asian language."""
import argparse
import json
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
out = parser.parse_args().directory
out.mkdir(parents=True, exist_ok=True)
cases = []
for hint in ['default', 'eastAsia']:
    for east in ['Arial', 'MS Gothic', 'Times New Roman', 'Calibri']:
        cases.append(dict(label=f'C{len(cases):02}', ascii='Arial', hAnsi='Arial', eastAsia=east, cs='Arial', hint=hint))
for hint in ['default', 'eastAsia']:
    for language in ['ja-JP', 'zh-CN', 'zh-TW', 'ko-KR']:
        cases.append(dict(label=f'C{len(cases):02}', ascii='Arial', hAnsi='Arial', eastAsia='Arial', cs='Arial', hint=hint, language=language))
for family in ['Times New Roman', 'Courier New']:
    for complex_script in [False, True]:
        cases.append(dict(label=f'C{len(cases):02}', ascii='Arial', hAnsi=family, eastAsia='Arial', cs='Times New Roman', hint='default', complexScript=complex_script))


def run(text, case=None):
    case = case or dict(ascii='Arial', hAnsi='Arial', eastAsia='Arial', cs='Arial', hint='default')
    fonts = ' '.join(f'w:{key}={quoteattr(case[key])}' for key in ['ascii', 'hAnsi', 'eastAsia', 'cs', 'hint'])
    language = f'<w:lang w:val="en-US" w:eastAsia={quoteattr(case["language"])}/>' if 'language' in case else ''
    cs = '<w:cs/>' if case.get('complexScript') else ''
    return f'<w:r><w:rPr><w:rFonts {fonts}/><w:sz w:val="18"/><w:szCs w:val="18"/>{language}{cs}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def paragraph(text, extra='', first=False):
    mark = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
    return f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if first else ""}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>{mark}</w:pPr>{run(text)}{extra}</w:p>'


body = ''.join(paragraph('Start ' + case['label'], first=i > 0) + paragraph('Sample', run('\u2028', case)) + paragraph('Tail') for i, case in enumerate(cases))
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
with ZipFile(out / 'control.docx', 'w', ZIP_DEFLATED) as archive:
    for name, value in parts.items():
        info = ZipInfo(name, (2026, 9, 27, 12, 0, 0))
        info.create_system = 0
        info.external_attr = 0o600 << 16
        archive.writestr(info, ('<?xml version="1.0" encoding="UTF-8"?>' + value).encode(), compress_type=ZIP_DEFLATED)
(out / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
