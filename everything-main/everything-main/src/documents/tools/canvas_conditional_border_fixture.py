"""Handwritten XML probe of conditional tcBorders region boundaries."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as package_shell, W

CASES = [('first-row', 'firstRow', 0), ('headers', 'firstRow', 2),
         ('first-column', 'firstCol', 0), ('horizontal', 'band1Horz', 0),
         ('vertical', 'band1Vert', 0), ('direct-table', 'firstRow', 0)]
COLORS = {'top':'FF0000', 'left':'0000FF', 'bottom':'008000', 'right':'800080',
          'insideH':'FF8000', 'insideV':'00AAAA'}


def generate():
    root = Path(__file__).resolve().parents[1]
    parts = dict(package_shell)
    defaults = ('<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'
                '<w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>'
                '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>')
    borders = ''.join(f'<w:{side} w:val="single" w:sz="16" w:color="{color}"/>' for side,color in COLORS.items())
    styles = ''
    body = ''
    for name,region,headers in CASES:
        styles += (f'<w:style w:type="table" w:styleId="{name}"><w:name w:val="{name}"/>'
                   f'<w:tblStylePr w:type="{region}"><w:tcPr><w:tcBorders>{borders}'
                   '</w:tcBorders></w:tcPr></w:tblStylePr></w:style>')
        br = '<w:pageBreakBefore/>' if body else ''
        body += f'<w:p><w:pPr>{br}</w:pPr><w:r><w:t>{name}</w:t></w:r></w:p>'
        direct = '<w:tblBorders><w:top w:val="single" w:sz="32" w:color="000000"/></w:tblBorders>' if name == 'direct-table' else ''
        body += (f'<w:tbl><w:tblPr><w:tblStyle w:val="{name}"/>'
                 '<w:tblStyleRowBandSize w:val="2"/><w:tblStyleColBandSize w:val="2"/>'
                 f'<w:tblW w:w="9360" w:type="dxa"/>{direct}<w:tblLayout w:type="fixed"/>'
                 '<w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/>'
                 '<w:bottom w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>'
                 '<w:tblLook w:val="01E0"/></w:tblPr><w:tblGrid>' + '<w:gridCol w:w="2340"/>'*4 + '</w:tblGrid>')
        for r in range(4):
            header = '<w:tblHeader/>' if r < headers else ''
            body += f'<w:tr><w:trPr><w:trHeight w:val="800"/>{header}</w:trPr>'
            for c in range(4):
                body += (f'<w:tc><w:tcPr><w:tcW w:w="2340" w:type="dxa"/></w:tcPr>'
                         f'<w:p><w:r><w:t>R{r}C{c}</w:t></w:r></w:p></w:tc>')
            body += '</w:tr>'
        body += '</w:tbl><w:p/>'
    parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}">{defaults}{styles}</w:styles>'
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    path = root/'public/fixtures/conditional-table-borders.docx'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items(): z.writestr(name,data)
    print(path)


if __name__ == '__main__': generate()
