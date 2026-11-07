"""Manually authored document-wide spelling-display controls, without font programs."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import argparse

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/hidden-spelling'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def generate(output=ROOT):
    cases = [('absent', None, False), ('implicit', '', True), ('one', '1', True),
             ('true', 'true', True), ('on', 'on', True), ('zero', '0', False),
             ('false', 'false', False), ('off', 'off', False)]
    for name, value, hidden in cases:
        flag = '' if value is None else '<w:hideSpellingErrors' + (f' w:val="{value}"' if value else '') + '/>'
        parts = {
            '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
            '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
            'word/_rels/document.xml.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>',
            'word/document.xml': f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr><w:t>Teh quick fox jumpd.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
            'word/settings.xml': f'<w:settings xmlns:w="{W}">{flag}</w:settings>',
        }
        output.mkdir(parents=True, exist_ok=True)
        with ZipFile(output / f'{name}.docx', 'w', ZIP_DEFLATED) as archive:
            for part, text in parts.items():
                info = ZipInfo(part, (2026, 10, 10, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
                archive.writestr(info, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + text)
    (output / 'cases.json').write_text(json.dumps([{'name': n, 'hidden': h} for n, _, h in cases], indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-folder', type=Path, default=ROOT)
    generate(parser.parse_args().output_folder)
