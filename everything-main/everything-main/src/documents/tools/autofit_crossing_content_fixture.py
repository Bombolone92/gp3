"""Original OOXML controls isolating crossing-span content allocation."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from canvas_first_section_fixture import parts as base, W, R, CT

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-crossing-content'
CASES = [dict(length=n, margin=80, bottomFirst=False) for n in [0, 1, 2, 4, 6, 8, 10, 12, 14]]
CASES += [dict(length=n, margin=80, bottomFirst=True) for n in [0, 4, 8, 12]]
CASES += [dict(length=4, margin=m, bottomFirst=False) for m in [0, 40, 160]]


def build(name='control', available=6000):
    parts = dict(base)
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
    body = []

    def cell(text, width, span, color):
        merge = f'<w:gridSpan w:val="{span}"/>' if span > 1 else ''
        return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{merge}<w:shd w:val="clear" w:fill="{color}"/></w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>'

    for i, case in enumerate(CASES):
        page_break = '<w:pageBreakBefore/>' if i else ''
        body.append(f'<w:p><w:pPr>{page_break}</w:pPr><w:r><w:t>Crossing content {i + 1}</w:t></w:r></w:p>')
        m = case['margin']
        body.append(f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:left w:w="{m}" w:type="dxa"/><w:right w:w="{m}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + ''.join(f'<w:gridCol w:w="{v}"/>' for v in [1800, 1800, 600, 1800]) + '</w:tblGrid>')
        upper = '<w:tr>' + cell('M' * 20, 3000, 2, 'FFAAAA') + cell('', 600, 1, 'AAFFAA') + cell('Right words can wrap here', 2400, 1, 'AAAAFF') + '</w:tr>'
        lower = '<w:tr>' + cell('M' * case['length'], 1600, 1, 'FFFFAA') + cell('Across', 4400, 3, 'AAFFFF') + '</w:tr>'
        body.extend([lower, upper] if case['bottomFirst'] else [upper, lower])
        body.append('</w:tbl>')
    body.append(f'<w:p/><w:sectPr><w:pgSz w:w="{available + 1440}" w:h="10080"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
    OUT.mkdir(exist_ok=True)
    with ZipFile(OUT / f'{name}.docx', 'w') as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 9, 25, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
            info.create_system = 0
            z.writestr(info, data)
    (OUT / 'cases.json').write_text(json.dumps(CASES, indent=2) + '\n')


if __name__ == '__main__':
    build()
    build('wide', 8400)
