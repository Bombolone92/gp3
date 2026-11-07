"""Original standalone DrawingML line controls; no corpus content or fonts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'tests/fixtures/flat-lines'
FOLDER.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'public/fixtures/numeric-page-fields.docx') as z:
    parts = {n: z.read(n) for n in ['[Content_Types].xml', '_rels/.rels', 'word/styles.xml', 'word/settings.xml', 'word/_rels/document.xml.rels']}
root = E.Element(tag('w:document'), nsmap=NS)
body = add(root, 'w:body')
# name, shape width/height in points, rotation, frame scale, inline
CASES = [('Horizontal', 108, 0, 0, 1, False), ('Vertical', 0, 108, 0, 1, False),
         ('Rotated horizontal', 108, 0, 2700000, 1, False), ('Rotated vertical', 0, 108, -2700000, 1, False),
         ('Scaled horizontal', 54, 0, 0, 2, False), ('Scaled vertical', 0, 54, 0, 2, False),
         ('Inline horizontal', 108, 0, 0, 1, True), ('Inline vertical', 0, 54, 0, 1, True)]
for i, (name, w, h, rotation, scale, inline) in enumerate(CASES):
    p = add(body, 'w:p'); pr = add(p, 'w:pPr')
    if i: add(pr, 'w:pageBreakBefore')
    add(pr, 'w:spacing', **{'w:before': 0, 'w:after': 0, 'w:line': 240, 'w:lineRule': 'auto'})
    r = add(p, 'w:r'); rp = add(r, 'w:rPr'); add(rp, 'w:rFonts', **{'w:ascii': 'Arial', 'w:hAnsi': 'Arial'}); add(rp, 'w:sz', **{'w:val': 24}); add(r, 'w:t', text=name)
    r = add(p, 'w:r'); drawing = add(r, 'w:drawing')
    frame = add(drawing, 'wp:inline' if inline else 'wp:anchor', distT=0, distB=0, distL=0, distR=0)
    if not inline:
        for k, v in dict(simplePos=0, relativeHeight=i+1, behindDoc=0, locked=0, layoutInCell=1, allowOverlap=1).items(): frame.set(k, str(v))
        add(frame, 'wp:simplePos', x=0, y=0)
        for axis, value in [('H', 144), ('V', 144)]: add(add(frame, 'wp:position'+axis, relativeFrom='page'), 'wp:posOffset', text=str(value*12700))
    add(frame, 'wp:extent', cx=w*12700*scale, cy=h*12700*scale)
    add(frame, 'wp:effectExtent', l=0, t=0, r=0, b=0)
    if not inline: add(frame, 'wp:wrapNone')
    add(frame, 'wp:docPr', id=i+1, name=name)
    shape = add(add(add(frame, 'a:graphic'), 'a:graphicData', uri=NS['wps']), 'wps:wsp')
    add(shape, 'wps:cNvCnPr'); props = add(shape, 'wps:spPr')
    xf = add(props, 'a:xfrm', rot=rotation); add(xf, 'a:off', x=0, y=0); add(xf, 'a:ext', cx=w*12700, cy=h*12700)
    add(add(props, 'a:prstGeom', prst='line'), 'a:avLst'); add(props, 'a:noFill')
    pen = add(props, 'a:ln', w=25400, cap='flat'); add(add(pen, 'a:solidFill'), 'a:srgbClr', val='E02030')
    add(shape, 'wps:bodyPr')
    p = add(body, 'w:p'); add(add(p, 'w:r'), 'w:t', text='Following paragraph')
sect = add(body, 'w:sectPr'); add(sect, 'w:pgSz', **{'w:w':12240, 'w:h':15840}); add(sect, 'w:pgMar', **{'w:top':1440,'w:left':1440,'w:right':1440,'w:bottom':1440,'w:header':0,'w:footer':0,'w:gutter':0})
parts['word/document.xml'] = E.tostring(root, encoding='UTF-8', xml_declaration=True, standalone=True)
parts['word/footer.xml'] = f'<w:ftr xmlns:w="{NS["w"]}"><w:p/></w:ftr>'.encode()
target = FOLDER / 'flat-lines.docx'
old = {}
if target.exists():
    with ZipFile(target) as z: old = {n: z.read(n) for n in z.namelist()}
if old != parts:
    with ZipFile(target, 'w', ZIP_DEFLATED) as z:
        for n,b in parts.items(): z.writestr(n,b)
