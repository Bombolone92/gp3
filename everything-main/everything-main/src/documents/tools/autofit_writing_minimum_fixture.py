"""Original, deterministic OOXML for empty-cell AutoFit writing minima."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from canvas_first_section_fixture import parts as base, W, R, CT

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/autofit-writing-minimum'
CASES = [dict(font=font, size=size, margin=margin)
         for font in ['Arial', 'Calibri'] for size in [4, 10, 24, 72]
         for margin in [0, 80, 160]]


def build(mode):
    parts = dict(base)
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
    parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>')
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/settings.xml" ContentType="{CT}settings+xml"/></Types>')
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
    body = []
    for i, c in enumerate(CASES):
        page_break = '<w:pageBreakBefore/>' if i and i % 4 == 0 else ''
        body.append(f'<w:p><w:pPr>{page_break}</w:pPr><w:r><w:t>Case {i+1}: {c["font"]}, {c["size"]}pt, {c["margin"]}twip margins</w:t></w:r></w:p>')
        body.append(f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:left w:w="{c["margin"]}" w:type="dxa"/><w:right w:w="{c["margin"]}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="1" w:type="dxa"/><w:shd w:val="clear" w:fill="008080"/></w:tcPr><w:p><w:pPr><w:rPr><w:rFonts w:ascii="{c["font"]}" w:hAnsi="{c["font"]}"/><w:sz w:val="{c["size"]*2}"/></w:rPr></w:pPr></w:p></w:tc></w:tr></w:tbl>')
    body.append('<w:p/><w:sectPr><w:pgSz w:w="7440" w:h="10080"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}</w:body></w:document>'
    with ZipFile(OUT / f'mode{mode}.docx', 'w') as z:
        for name, content in parts.items():
            entry = ZipInfo(name, (2026, 9, 27, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            z.writestr(entry, content)


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    for mode in [12, 15]:
        build(mode)
    (OUT / 'cases.json').write_text(json.dumps(CASES, indent=2) + '\n', encoding='utf8')
