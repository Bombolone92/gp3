"""Independent original OOXML controls: floating pictures across hard breaks."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from top_bottom_flow_fixture import make, drawing, paragraph, W, WP, A, PIC, R

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/positioned-breaks'
NS = f'xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"'

def build():
    OUT.mkdir(exist_ok=True)
    for kind in ['page', 'column']:
        for base in ['paragraph', 'line']:
            parts = make(15)
            def panel(number):
                xml = drawing(number, 30, 12).replace('<wp:wrapTopAndBottom/>', '<wp:wrapNone/>')
                xml = xml.replace('relativeFrom="paragraph"', f'relativeFrom="{base}"')
                if number == 2:
                    xml = xml.replace('<wp:positionH relativeFrom="column"><wp:posOffset>0', '<wp:positionH relativeFrom="column"><wp:posOffset>1524000')
                return xml
            mark = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>'
            text = lambda s: f'<w:r>{mark}<w:t>{s}</w:t></w:r>'
            rich = panel(1) + text('Before break') + f'<w:r>{mark}<w:br w:type="{kind}"/></w:r>' + panel(2) + text('After break')
            body = paragraph('Healthy heading') + paragraph(drawings=rich) + paragraph('Healthy ending')
            columns = '<w:cols w:num="2" w:space="720"/>' if kind == 'column' else ''
            section = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="360" w:footer="360" w:gutter="0"/>' + columns + '</w:sectPr>'
            parts['word/document.xml'] = f'<w:document {NS}><w:body>{body}{section}</w:body></w:document>'
            with ZipFile(OUT / f'{kind}-{base}.docx', 'w') as archive:
                for name, data in parts.items():
                    entry = ZipInfo(name, (2026, 9, 30, 0, 0, 0)); entry.compress_type = ZIP_DEFLATED
                    archive.writestr(entry, data)

if __name__ == '__main__':
    build()
