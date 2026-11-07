"""Independently authored picture-lock and rotated resize controls; original art."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from top_bottom_flow_fixture import make, drawing, paragraph, W, WP, A, PIC, R

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/image-resize'
CASES = [
    dict(id=1, name='Missing locks', lock=None, rotation=0),
    dict(id=2, name='Explicit unlocked', lock=False, rotation=0),
    dict(id=3, name='Outer lock', lock=True, rotation=0),
    dict(id=4, name='Inner lock', lock=True, inner=True, rotation=30),
    dict(id=5, name='Rotated unlocked', lock=False, rotation=30),
    dict(id=6, name='Quarter turn cropped flipped', lock=False, rotation=90, crop=True),
    dict(id=7, name='Inline unlocked', lock=False, rotation=0, inline=True),
    dict(id=8, name='Inline locked quarter turn', lock=True, rotation=90, inline=True),
    dict(id=9, name='Aligned unlocked', lock=False, rotation=0, aligned=True),
    dict(id=10, name='Aligned rotated unlocked', lock=False, rotation=30, aligned=True),
]

def build():
    from lxml import etree as E
    parts = make(15)
    body = []
    for case in CASES:
        body.append(paragraph(case['name'], page_break=case['id'] > 1))
        root = E.fromstring(f'<root xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}">{drawing(case["id"], 30, 60)}</root>')
        anchor = root.find(f'.//{{{WP}}}anchor')
        anchor.set('behindDoc', '0')
        wrap = anchor.find(f'{{{WP}}}wrapTopAndBottom')
        wrap.tag = f'{{{WP}}}wrapNone'
        if case.get('aligned'):
            for axis, alignment in [('H', 'right'), ('V', 'center')]:
                position = anchor.find(f'{{{WP}}}position{axis}')
                for node in list(position):
                    position.remove(node)
                if axis == 'V':
                    position.set('relativeFrom', 'page')
                E.SubElement(position, f'{{{WP}}}align').text = alignment
        if case.get('inline'):
            anchor.tag = f'{{{WP}}}inline'
            anchor.attrib.clear()
            for node in list(anchor):
                if E.QName(node).localname in ['simplePos', 'positionH', 'positionV', 'wrapNone']:
                    anchor.remove(node)
        if case['lock'] is not None:
            parent = root.find(f'.//{{{PIC}}}cNvPicPr') if case.get('inner') else root.find(f'.//{{{WP}}}cNvGraphicFramePr')
            E.SubElement(parent, f'{{{A}}}{"picLocks" if case.get("inner") else "graphicFrameLocks"}', noChangeAspect='1' if case['lock'] else '0')
        transform = root.find(f'.//{{{A}}}xfrm')
        transform.set('rot', str(case['rotation'] * 60000))
        if case.get('crop'):
            transform.set('flipH', '1')
            fill = root.find(f'.//{{{PIC}}}blipFill')
            fill.insert(1, E.Element(f'{{{A}}}srcRect', l='10000', t='5000', r='20000', b='0'))
        body.append(paragraph(drawings=E.tostring(root[0], encoding='unicode')))
        body.append(paragraph('Text remains editable after resizing.'))
    body.append('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"><w:body>{"".join(body)}</w:body></w:document>'
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT / 'control.docx', 'w') as archive:
        for name, value in parts.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, value)
    (OUT / 'cases.json').write_text(json.dumps(CASES, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    build()
