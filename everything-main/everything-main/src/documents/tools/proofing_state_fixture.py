"""Independent, hand-authored proofState controls; no document engine or fonts."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/proofing-state'

def generate(output=ROOT):
    output.mkdir(parents=True, exist_ok=True)
    for name, state, flagged in [('clean', 'clean', False), ('dirty', 'dirty', False), ('flagged', 'clean', True)]:
        start = '<w:proofErr w:type="spellStart"/>' if flagged else ''
        end = '<w:proofErr w:type="spellEnd"/>' if flagged else ''
        parts = {
            '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
            '_rels/.rels': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
            'word/document.xml': f'<w:document xmlns:w="{W}"><w:body><w:p>{start}<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr><w:t>jumpd</w:t></w:r>{end}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
            'word/_rels/document.xml.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>',
            'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:proofState w:spelling="{state}" w:grammar="{state}"/></w:settings>',
        }
        with ZipFile(output / f'proofing-{name}.docx', 'w', ZIP_DEFLATED) as archive:
            for part, data in parts.items():
                info = ZipInfo(part, (2026, 10, 10, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
                archive.writestr(info, data.encode('utf-8'))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-folder', type=Path, default=ROOT)
    generate(parser.parse_args().output_folder)
