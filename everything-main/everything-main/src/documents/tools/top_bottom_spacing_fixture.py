"""Independent paragraph-before spacing controls across a thin wrapping band."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from top_bottom_flow_fixture import drawing, paragraph, make, W, WP, A, PIC, R

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/top-bottom-spacing'


def build():
    parts = make(15)
    body, cases = [], []
    for anchor_size in [19, 24]:
        for before in [0, 40, 120, 220, 360, 600]:
            index = len(cases)
            cases.append(dict(index=index, anchorHalfPoints=anchor_size, beforeTwips=before))
            body.append(paragraph(f'CASE {index}', page_break=index > 0))
            body.append(paragraph(size=anchor_size, before=10, drawings=drawing(index + 1, 14.4, .1)))
            body.append(paragraph(f'FOLLOW {index}', before=before))
            body.append(paragraph(f'NEXT {index}'))
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{"".join(body)}</w:body></w:document>'
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT / 'top-bottom-spacing.docx', 'w') as archive:
        for name, value in parts.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, value)
    (OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    build()
