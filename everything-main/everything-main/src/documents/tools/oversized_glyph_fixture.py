"""Original fixed-cell overflow controls, authored directly as OPC/XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts, W

root = Path(__file__).resolve().parents[1]
body = ''
cases = [(0,100),(-5,100),(5,100),(0,80),(0,120),(-5,80),(5,120),(31680,100),(0,600),(0,100),(0,100)]
for i, (spacing, scale) in enumerate(cases):
    if i == 7:
        body += '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>'
    body += '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>'
    body += ''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top','left','bottom','right'])
    body += '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="540"/><w:gridCol w:w="7380"/></w:tblGrid><w:tr>'
    for width, text, size in [(1440,f'G{i}',24),(540,'TT',114),(7380,f'Neighbor{i}',24)]:
        props = f'<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{size}"/>'
        align = 'left'
        if text == 'TT':
            props += f'<w:spacing w:val="{spacing}"/><w:w w:val="{scale}"/>'
            align = 'center' if i == 9 else 'right' if i == 10 else 'left'
        body += f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="{align}"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r></w:p></w:tc>'
    body += '</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="31680"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(root/'public/fixtures/oversized-glyph.docx', 'w', ZIP_DEFLATED) as z:
    for name, text in parts.items():
        z.writestr(name, text)
