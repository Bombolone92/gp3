"""Original controls for completed merged cells when the next row moves pages."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as base, W, R, CT
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/finished-merge-pagination'
folder.mkdir(exist_ok=True)
cases = []
for name, count, footer in [('empty-footer', 0, True), ('short-footer', 1, True), ('long-footer', 26, True), ('empty-no-footer', 0, False)]:
    parts = dict(base)
    def p(text):
        return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'
    def cell(text, merge=''):
        return f'<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/>{merge}</w:tcPr>{text}</w:tc>'
    owner = ''.join(p(f'Merge {i+1}') for i in range(count)) or p('')
    rows = '<w:tr>' + cell(p('Heading A')) + cell(owner, '<w:vMerge w:val="restart"/>') + cell(p('Heading B')) + '</w:tr>'
    rows += '<w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="atLeast"/></w:trPr>' + cell(p('Body A')) + cell(p(''), '<w:vMerge/>') + cell(p('Body B')) + '</w:tr>'
    table = '<w:tbl><w:tblPr><w:tblW w:w="5400" w:type="dxa"/><w:tblBorders>' + ''.join(f'<w:{edge} w:val="single" w:sz="4" w:color="000000"/>' for edge in ['top','left','bottom','right','insideH','insideV']) + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>' + ''.join(f'<w:{edge} w:w="60" w:type="dxa"/>' for edge in ['top','left','bottom','right']) + '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>' + rows + '</w:tbl>'
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
    if footer:
        parts['word/footer.xml'] = f'<w:ftr xmlns:w="{W}">{p("Footer")}</w:ftr>'
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="footer" Type="{R}/footer" Target="footer.xml"/></Relationships>')
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/footer.xml" ContentType="{CT}footer+xml"/></Types>')
    lead = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="4400" w:lineRule="exact"/></w:pPr><w:r><w:t>Before table</w:t></w:r></w:p>'
    sect = ('<w:footerReference w:type="default" r:id="footer"/>' if footer else '') + '<w:pgSz w:w="7200" w:h="8000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{lead}{table}{p("After table")}<w:sectPr>{sect}</w:sectPr></w:body></w:document>'
    with ZipFile(folder / f'{name}.docx', 'w', ZIP_DEFLATED) as z:
        for path, data in parts.items(): z.writestr(path, data)
    cases.append(dict(name=name, count=count, footer=footer))
(folder / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')
