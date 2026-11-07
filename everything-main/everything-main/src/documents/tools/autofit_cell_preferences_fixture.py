"""Original controls for content-aware reduction of preferred cell widths."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/autofit-cell-preferences'
FOLDER.mkdir(parents=True, exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
CASES = [(kind, merge, 'Left', 'Right') for kind in ['omitted', 'autofit', 'fixed'] for merge in [False, True]]
CASES += [('autofit', False, 'WWWWWWWW', 'R'), ('autofit', False, 'L', 'MMMMMMMM')]

def paragraph(text, page_break=False):
    return '<w:p><w:pPr>' + ('<w:pageBreakBefore/>' if page_break else '') + '<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>' + escape(text) + '</w:t></w:r></w:p>'

for mode in [12, 15]:
    with ZipFile(ROOT / 'public/fixtures/numeric-page-fields.docx') as z:
        parts = {name: z.read(name) for name in ['[Content_Types].xml', '_rels/.rels', 'word/styles.xml', 'word/settings.xml', 'word/_rels/document.xml.rels']}
    body = ''
    for index, (kind, merge, left, right) in enumerate(CASES):
        body += paragraph(f'AutoFit preference {index + 1}: {kind}, merge={merge}, {left}/{right}', index > 0)
        body += '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="7200"/>' + ('' if kind == 'omitted' else f'<w:tblLayout w:type="{kind}"/>')
        body += '<w:tblCellMar>' + ''.join(f'<w:{side} w:w="0" w:type="dxa"/>' for side in ['top', 'left', 'bottom', 'right']) + '</w:tblCellMar></w:tblPr>'
        body += '<w:tblGrid><w:gridCol w:w="4200"/><w:gridCol w:w="3000"/></w:tblGrid>'
        for row in range(2):
            body += '<w:tr><w:trPr><w:trHeight w:val="480" w:hRule="exact"/></w:trPr>'
            for col, width in enumerate([4800, 3600]):
                merged = ('<w:vMerge w:val="restart"/>' if row == 0 else '<w:vMerge/>') if merge and col else ''
                color = ['336699', 'CC6633'][col]
                body += f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{width}"/>{merged}<w:shd w:val="clear" w:fill="{color}"/></w:tcPr>'
                body += paragraph('' if merge and col and row else [left, right][col]) + '</w:tc>'
            body += '</w:tr>'
        body += '</w:tbl>' + paragraph('End')
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'.encode()
    parts['word/footer.xml'] = f'<w:ftr xmlns:w="{W}"><w:p/></w:ftr>'.encode()
    destination = FOLDER / f'autofit-cell-preferences-{mode}.docx'
    if destination.exists():
        with ZipFile(destination) as z:
            if parts == {name: z.read(name) for name in z.namelist()}: continue
    with ZipFile(destination, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)
