"""Independent OOXML controls for wrapping bands and following paragraphs."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from canvas_anchor_position_fixture import make, W, WP, A, PIC, R

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/top-bottom-flow'


def drawing(number, top, height):
    y, h = round(top * 12700), round(height * 12700)
    return f'''<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="19"/></w:rPr><w:drawing><wp:anchor simplePos="0" relativeHeight="{number}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1" distT="0" distB="0" distL="0" distR="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>{y}</wp:posOffset></wp:positionV><wp:extent cx="1270000" cy="{h}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/><wp:docPr id="{number}" name="Band {number}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Original panel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'''


def paragraph(text='', size=24, before=0, page_break=False, drawings=''):
    mark = f'<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{size}"/></w:rPr>'
    props = ('<w:pageBreakBefore/>' if page_break else '') + f'<w:spacing w:before="{before}" w:after="0" w:line="240" w:lineRule="auto"/>' + mark
    return f'<w:p><w:pPr>{props}</w:pPr>' + (f'<w:r>{mark}<w:t>{text}</w:t></w:r>' if text else '') + drawings + '</w:p>'


def build():
    parts = make(15)
    cases = []
    body = []
    for bands in [[], [(26.8, 99.75)], [(14.4, .1), (26.8, 99.75)], [(0, 40)], [(40, 40)], [(14.4, .1)]]:
        for empty in [True, False]:
            index = len(cases)
            cases.append(dict(index=index, bands=bands, emptyFollowing=empty))
            body.append(paragraph(f'CASE {index}', page_break=index > 0))
            drawings = ''.join(drawing(index * 10 + j + 1, top, height) for j, (top, height) in enumerate(bands))
            body.append(paragraph(size=19, before=10, drawings=drawings))
            body.append(paragraph('' if empty else f'SMALL {index}', size=16, before=2))
            body.append(paragraph(size=44, before=241))
            body.append(paragraph(f'FOLLOW {index}'))
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{"".join(body)}</w:body></w:document>'
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT / 'control.docx', 'w') as archive:
        for name, value in parts.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, value)
    (OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    build()
