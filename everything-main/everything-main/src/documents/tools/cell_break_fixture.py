"""Original native controls distinguishing inline cell breaks and paragraph breaks."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/cell-breaks'
out.mkdir(parents=True, exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root / 'public/fixtures/table-shading-scope.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
def p(text, props=''):
    return f'<w:p><w:pPr>{props}</w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'
for kind in ['line', 'page', 'column', 'empty-page', 'before-first', 'before-second']:
    if kind in ['line', 'page', 'column']:
        content = f'<w:p><w:r><w:t>Before</w:t><w:br w:type="{ "textWrapping" if kind == "line" else kind }"/><w:t>After</w:t></w:r></w:p>'
    elif kind == 'empty-page':
        content = p('Before') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + p('After')
    else:
        content = p('Before', '<w:pageBreakBefore/>' if kind == 'before-first' else '') + p('After', '<w:pageBreakBefore/>' if kind == 'before-second' else '')
    borders = ''.join(f'<w:{side} w:val="single" w:sz="8" w:color="203040"/>' for side in ['top','left','bottom','right','insideH','insideV'])
    cell = lambda text: f'<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>{text}</w:tc>'
    table = f'<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>{cell(content)}{cell(p("Other cell"))}</w:tr><w:tr>{cell(p("Next row"))}{cell(p("Other next row"))}</w:tr></w:tbl>'
    body = p('Cell break: ' + kind) + table + p('After table') + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'.encode()
    # Use a deterministic installed font and ordinary line metrics in every case.
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'.encode()
    with ZipFile(out / f'{kind}.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)
    print(out / f'{kind}.docx')
