"""Original font-free thin-border controls around the native Y=309 boundary."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse
import json
from canvas_first_section_fixture import parts as base, W, R, CT


def generate(folder):
    folder.mkdir(parents=True, exist_ok=True)
    parts = dict(base)
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(
        '</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace(
        '</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
    paragraph = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'
    borders = ''.join(f'<w:{side} w:val="single" w:sz="2" w:color="000000"/>' for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
    margins = ''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top', 'left', 'bottom', 'right'])
    cases, body = [], []
    for index, delta in enumerate(range(-8, 9)):
        x, y = 360 + 1320 * (index % 4), 309 + delta + 1500 * (index // 4)
        cases.append(dict(id=index + 1, deltaTwips=delta, xTwips=x, yTwips=y, widthTwips=960, heightTwips=1200))
        body.append(f'<w:tbl><w:tblPr><w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="{x}" w:tblpY="{y}"/><w:tblW w:w="960" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="960"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1200" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="960" w:type="dxa"/></w:tcPr>{paragraph}</w:tc></w:tr></w:tbl>{paragraph}')
    geometry = '<w:pgSz w:w="5760" w:h="8640"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:sectPr>{geometry}</w:sectPr></w:body></w:document>'
    with ZipFile(folder / 'control.docx', 'w') as archive:
        for name, data in parts.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)
    (folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'tests/fixtures/border-fine-phase')
    generate(parser.parse_args().output)
