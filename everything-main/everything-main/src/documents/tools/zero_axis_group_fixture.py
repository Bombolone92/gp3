"""Independently authored zero-axis DrawingML group controls, without artwork."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/zero-axis-groups'
FOLDER.mkdir(parents=True, exist_ok=True)
emu = lambda pt: round(pt * 12700)
# Group extent, child-coordinate extent, child offset and line transform (pt).
cases = [
    ('vertical', (0,72), (0,72), (0,0), (0,0,0,72)),
    ('horizontal', (72,0), (72,0), (0,0), (0,0,72,0)),
    ('scaled-vertical', (0,144), (0,72), (0,0), (0,0,0,72)),
    ('scaled-horizontal', (144,0), (72,0), (0,0), (0,0,72,0)),
    ('zero-child-width', (36,72), (0,72), (0,0), (12,0,0,72)),
    ('zero-child-height', (72,36), (72,0), (0,0), (0,12,72,0)),
    ('collapsed-width', (0,72), (36,72), (0,0), (12,0,0,72)),
    ('collapsed-height', (72,0), (72,36), (0,0), (0,12,72,0)),
    ('offset-vertical', (0,72), (0,72), (10,20), (14,26,0,48)),
    ('offset-horizontal', (72,0), (72,0), (20,10), (26,14,48,0)),
    ('nested-vertical', (96,96), (96,96), (0,0), (0,0,0,72)),
    ('rotated-vertical', (0,72), (0,72), (0,0), (0,0,0,72)),
]

def group(parent, extent, child_extent, offset, *, root=False, at=(0,0), rotation=0):
    node = add(parent, 'wpg:wgp' if root else 'wpg:grpSp')
    add(node, 'wpg:cNvGrpSpPr')
    xf = add(add(node, 'wpg:grpSpPr'), 'a:xfrm', **({'rot': rotation} if rotation else {}))
    add(xf, 'a:off', x=emu(at[0]), y=emu(at[1]))
    add(xf, 'a:ext', cx=emu(extent[0]), cy=emu(extent[1]))
    add(xf, 'a:chOff', x=emu(offset[0]), y=emu(offset[1]))
    add(xf, 'a:chExt', cx=emu(child_extent[0]), cy=emu(child_extent[1]))
    return node

with ZipFile(ROOT / 'public/fixtures/numeric-page-fields.docx') as archive:
    parts = {n: archive.read(n) for n in ['[Content_Types].xml', '_rels/.rels', 'word/styles.xml', 'word/settings.xml', 'word/_rels/document.xml.rels']}
document = E.Element(tag('w:document'), nsmap=NS)
body = add(document, 'w:body')
paragraph = add(body, 'w:p'); add(add(paragraph, 'w:r'), 'w:t', text='Zero-axis group controls')
records = []
for i, (name, extent, child_extent, offset, line) in enumerate(cases):
    x, y = 72 + (i % 3) * 180, 72 + (i // 3) * 160
    color = f'{180+i*5:02X}{32+i*4:02X}{48+i*5:02X}'
    records.append(dict(name=name, x=x, y=y, color=color, extent=extent, childExtent=child_extent, childOffset=offset, line=line))
    run = add(paragraph, 'w:r')
    anchor = add(add(run, 'w:drawing'), 'wp:anchor', distT=0, distB=0, distL=0, distR=0,
                 simplePos=0, relativeHeight=i+1, behindDoc=0, locked=0, layoutInCell=1, allowOverlap=1)
    add(anchor, 'wp:simplePos', x=0, y=0)
    for axis, value in [('H', x), ('V', y)]:
        add(add(anchor, 'wp:position'+axis, relativeFrom='page'), 'wp:posOffset', text=str(emu(value)))
    add(anchor, 'wp:extent', cx=emu(extent[0]), cy=emu(extent[1]))
    add(anchor, 'wp:effectExtent', l=0, t=0, r=0, b=0)
    add(anchor, 'wp:wrapNone'); add(anchor, 'wp:docPr', id=i+1, name=name)
    data = add(add(anchor, 'a:graphic'), 'a:graphicData', uri=NS['wpg'])
    node = group(data, extent, child_extent, offset, root=True, rotation=5400000 if name=='rotated-vertical' else 0)
    if name == 'nested-vertical': node = group(node, (0,72), (0,72), (0,0), at=(18,12))
    shape = add(node, 'wps:wsp'); add(shape, 'wps:cNvCnPr')
    props = add(shape, 'wps:spPr'); xf = add(props, 'a:xfrm')
    add(xf, 'a:off', x=emu(line[0]), y=emu(line[1])); add(xf, 'a:ext', cx=emu(line[2]), cy=emu(line[3]))
    add(add(props, 'a:prstGeom', prst='line'), 'a:avLst'); add(props, 'a:noFill')
    add(add(add(props, 'a:ln', w=25400, cap='flat'), 'a:solidFill'), 'a:srgbClr', val=color)
    add(shape, 'wps:bodyPr')
sect = add(body, 'w:sectPr'); add(sect, 'w:pgSz', **{'w:w':12240,'w:h':15840})
add(sect, 'w:pgMar', **{'w:top':720,'w:left':720,'w:right':720,'w:bottom':720,'w:header':0,'w:footer':0,'w:gutter':0})
parts['word/document.xml'] = E.tostring(document, encoding='UTF-8', xml_declaration=True, standalone=True)
parts['word/footer.xml'] = f'<w:ftr xmlns:w="{NS["w"]}"><w:p/></w:ftr>'.encode()
target = ROOT / 'public/fixtures/zero-axis-groups.docx'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name, content in parts.items(): archive.writestr(name, content)
(FOLDER / 'cases.json').write_text(json.dumps(records, indent=2)+'\n', encoding='utf-8')
print(target)
