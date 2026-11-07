"""Original AutoFit noWrap controls, assembled directly as OOXML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def p(text, page=False, size=24):
    return '<w:p><w:pPr>' + ('<w:pageBreakBefore/>' if page else '') + f'<w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{size}"/></w:rPr><w:t>' + escape(text) + '</w:t></w:r></w:p>'

body = ''
cases = [(kind, nowrap, layout, 2400) for layout in ['autofit', 'fixed']
         for kind in ['dxa', 'auto', 'pct'] for nowrap in [False, True]]
cases += [('dxa', nowrap, 'autofit', width) for width in [1200, 1800, 3600] for nowrap in [False, True]]
cases += [('dxa', nowrap, 'autofit', 2400) for size in [16, 32] for nowrap in [False, True]]
cases += [('dxa', nowrap, 'autofit', 2400) for nowrap in [False, True]]
cases += [('dxa', nowrap, 'autofit', 3600) for nowrap in [False, True]]
cases += [('dxa', nowrap, 'autofit', 3600) for nowrap in [False, True]]
for i, (kind, nowrap, layout, first_width) in enumerate(cases):
    body += p(f'Cell wrapping controls: {layout} {kind} {nowrap}', i > 0)
    body += f'<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="{first_width + 2400}"/><w:tblLayout w:type="' + layout + '"/><w:tblCellMar>'
    body += ''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top', 'left', 'bottom', 'right'])
    body += f'</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="{first_width}"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>'
    for j, text in enumerate(['One two three four five six seven eight', 'MMMMMMMMMMMMMMMMMMMMMMMM']):
        if i in [22, 23] and j == 1: text = 'Short'
        if i >= 24 and j == 1: text = 'M' * 40
        if i >= 26 and j == 0: text = 'M' * 20
        width = {'dxa': first_width, 'auto': 0, 'pct': 2500}[kind] if j == 0 else 2400
        celltype = kind if j == 0 else 'dxa'
        body += f'<w:tc><w:tcPr><w:tcW w:type="{celltype}" w:w="{width}"/>'
        body += '<w:shd w:val="clear" w:fill="' + ['336699', 'CC6633'][j] + '"/>'
        if j == 0: body += '<w:noWrap' + ('/>' if nowrap else ' w:val="0"/>')
        body += '</w:tcPr>' + p(text, size=16 if i in [18, 19] else 32 if i in [20, 21] else 24) + '</w:tc>'
    body += '</w:tr></w:tbl>'
body += p('') + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT / 'public/fixtures/merged-autofit.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(b'</Types>', b'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
parts['word/_rels/document.xml.rels'] = b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'.encode()
with ZipFile(ROOT / 'public/fixtures/table-no-wrap.docx', 'w', ZIP_DEFLATED) as z:
    for n, data in parts.items(): z.writestr(n, data)
