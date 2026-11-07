"""Original controls for body tables intersecting a top/bottom drawing band."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from top_bottom_flow_fixture import drawing, paragraph, make, W, WP, A, PIC, R

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/top-bottom-table'


def build():
    parts, body = make(15), []
    for index, count in enumerate([1, 3, 6]):
        body.append(paragraph(f'CASE {index}', page_break=index > 0))
        body.append(paragraph(size=19, before=10, drawings=drawing(index + 1, 26.8, 99.75)))
        rows = []
        for row in range(count):
            text = f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="12"/></w:rPr><w:t>ROW {index}-{row}</w:t></w:r></w:p>'
            rows.append('<w:tr><w:trPr><w:trHeight w:val="200" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' + text + '</w:tc></w:tr>')
        body.append('<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' + ''.join(rows) + '</w:tbl>')
        body.append(paragraph(f'FOLLOW {index}'))
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{"".join(body)}</w:body></w:document>'
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT / 'top-bottom-table.docx', 'w') as archive:
        for name, value in parts.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, value)


if __name__ == '__main__':
    build()
