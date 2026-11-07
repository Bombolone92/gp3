"""Original scRGB/alpha controls assembled only from our authored XML fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    '<a:srgbClr val="CC3366"><a:alpha val="40000"/></a:srgbClr>',
    '<a:srgbClr val="CC3366"><a:alpha val="0"/></a:srgbClr>',
    '<a:srgbClr val="CC3366"><a:alpha val="100000"/></a:srgbClr>',
    '<a:srgbClr val="CC3366"><a:alpha val="80000"/><a:alphaMod val="50000"/></a:srgbClr>',
    '<a:srgbClr val="CC3366"><a:alpha val="80000"/><a:alphaOff val="-40000"/></a:srgbClr>',
    '<a:scrgbClr r="50000" g="20000" b="10000"/>',
    '<a:scrgbClr r="0" g="100000" b="50000"><a:alpha val="40000"/></a:scrgbClr>',
    '<a:srgbClr val="CC3366"><a:alpha val="80000"/><a:alphaOff val="40000"/><a:alphaMod val="50000"/></a:srgbClr>',
    '<a:srgbClr val="CC3366"><a:alpha val="80000"/><a:alphaMod val="50000"/><a:alphaOff val="40000"/></a:srgbClr>',
    '<a:schemeClr val="accent3"><a:alpha val="40000"/></a:schemeClr>',
    '<a:scrgbClr r="50000" g="20000" b="10000"><a:tint val="50000"/></a:scrgbClr>',
    '<a:scrgbClr r="50000" g="20000" b="10000"><a:alpha val="40000"/></a:scrgbClr>',
]
with ZipFile(ROOT / 'public/fixtures/shape-theme.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml']); body = root.find(tag('w:body'))
template = deepcopy(root.find('.//' + tag('wp:anchor')))
section = deepcopy(body.find(tag('w:sectPr'))); body.clear()
add(add(add(body, 'w:p'), 'w:r'), 'w:t', text='Shape alpha controls')
for i, color in enumerate(CASES):
    for background in [True, False]:
        frame = deepcopy(template); ident = 2 * i + (1 if background else 2)
        frame.set('relativeHeight', str(251658240 + ident * 1024))
        for axis, value in [('H', 60 + 260 * (i % 2)), ('V', 100 + 100 * (i // 2))]:
            frame.find(tag('wp:position' + axis) + '/' + tag('wp:posOffset')).text = str(value * 12700)
        pr = frame.find(tag('wp:docPr')); pr.set('id', str(ident)); pr.set('name', f'Case {i+1} ' + ('background' if background else 'foreground'))
        s = frame.find('.//' + tag('wps:wsp')); props = s.find(tag('wps:spPr'))
        for node in list(props):
            if E.QName(node).localname not in ['xfrm', 'prstGeom']: props.remove(node)
        fill = add(props, 'a:solidFill')
        fill.append(E.fromstring((f'<a:srgbClr xmlns:a="{NS["a"]}" val="305080"/>' if background else color.replace(' ', f' xmlns:a="{NS["a"]}" ', 1)).encode()))
        add(add(props, 'a:ln'), 'a:noFill')
        style = s.find(tag('wps:style'))
        for ref in style:
            for child in list(ref): ref.remove(child)
            ref.set('idx', 'none' if E.QName(ref).localname == 'fontRef' else '0')
            add(ref, 'a:scrgbClr', r=0, g=0, b=0)
        # CT_FontReference permits an omitted color (as in a no-font style).
        font = style.find(tag('a:fontRef')); font.remove(font[0])
        # Final case inherits a transparent scRGB theme placeholder instead.
        if i == 11 and not background:
            props.remove(fill)
            ref = style.find(tag('a:fillRef')); ref.set('idx', '1'); ref.remove(ref[0])
            ref.append(E.fromstring(color.replace(' ', f' xmlns:a="{NS["a"]}" ', 1).encode()))
        add(add(add(body, 'w:p'), 'w:r'), 'w:drawing').append(frame)
body.append(section)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(ROOT / 'public/fixtures/shape-alpha.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)

