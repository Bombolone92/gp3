"""Original OOXML evidence for unresolved AutoFit merged-span pressure."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as base, W, R, CT

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-span-pressure'
CASES = [(False, 1, False), (False, 2, True), (True, 1, False),
         (True, 2, True), (True, 4, True), (True, 1, True)]
BOTTOM = ['', 'I', 'Bottom', 'MMMM', 'MMMMMMMM', 'MMMMMMMMMMMM',
          'WWWWWWWWWWWW', 'iiiiiiiiiiii']


def build(name, modern, series=False):
    parts = dict(base)
    if modern:
        parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
    body = []
    for i, (pressure, repeat, cross) in enumerate([(True, 1, True)] * 8 if series else CASES):
        def cell(text, width, span, color):
            return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>' + (f'<w:gridSpan w:val="{span}"/>' if span > 1 else '') + f'<w:shd w:val="clear" w:fill="{color}"/></w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>'
        body.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if i else ""}</w:pPr><w:r><w:t>Case {i+1}</w:t></w:r></w:p>')
        body.append('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + ''.join(f'<w:gridCol w:w="{v}"/>' for v in [1800, 1800, 600, 1800]) + '</w:tblGrid>')
        for j in range(repeat):
            left = 'MMMMMMMMMMMMMMMMMMMM' if pressure and j == 0 else 'Left'
            body.append('<w:tr>' + cell(left, 3000, 2, 'FFAAAA') + cell('', 600, 1, 'AAFFAA') + cell('Right words can wrap here', 2400, 1, 'AAAAFF') + '</w:tr>')
        if cross:
            body.append('<w:tr>' + cell(BOTTOM[i] if series else 'Bottom', 1600, 1, 'FFFFAA') + cell('Across', 4400, 3, 'AAFFFF') + '</w:tr>')
        body.append('</w:tbl>')
    body.append('<w:p/><w:sectPr><w:pgSz w:w="7440" w:h="10080"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
    with ZipFile(FOLDER / f'{name}.docx', 'w', ZIP_DEFLATED) as z:
        for part, data in parts.items():
            z.writestr(part, data)


if __name__ == '__main__':
    FOLDER.mkdir(exist_ok=True)
    build('legacy', False)
    build('modern', True)
    build('series', True, True)
